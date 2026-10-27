// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {KovaCashOut, IAuthorizedDollar, IPayoutToken} from "../src/KovaCashOut.sol";

interface ISigningDomain {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}

/// A cash-out against Monad mainnet as it is now: real AUSD, real USDC, and a live KyberSwap route
/// built for the contract. It needs the network, so it only runs when asked:
///
///   MONAD_FORK=1 forge test --match-contract KovaCashOutForkTest --ffi
contract KovaCashOutForkTest is Test {
    address constant AUSD = 0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a;
    address constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;
    address constant ROUTER = 0x6131B5fae19EA4f9D964eAc0408E4408b66337b5;
    bytes32 constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    KovaCashOut cashOut;
    address relayer = makeAddr("relayer");
    address paj = makeAddr("paj");
    address ada;
    uint256 adaKey;
    bytes32 ref = bytes32(uint256(0x0190f3a2b4c5d6e7f8091a2b3c4d5e6f));

    function test_cashesOutRealAusdThroughALiveRoute() public {
        if (!vm.envOr("MONAD_FORK", false)) vm.skip(true);
        vm.createSelectFork(vm.envOr("MONAD_RPC_URL", string("https://rpc1.monad.xyz")));
        (ada, adaKey) = makeAddrAndKey("ada");
        cashOut = new KovaCashOut(IAuthorizedDollar(AUSD), IPayoutToken(USDC), ROUTER, relayer);
        buyDollars(2000 ether);
        uint256 held = IAuthorizedDollar(AUSD).balanceOf(ada);
        assertGt(held, 10e6, "Ada bought enough AUSD to cash out $10");

        // Ada cashes out $10. Kova asks the partner for 0.1% under the live quote, as the API does.
        uint256 value = 10e6;
        (uint256 quoted, bytes memory swap) = liveRoute(value);
        uint256 pay = quoted * 9990 / 10000;
        uint256 validBefore = block.timestamp + 900;
        (uint8 v, bytes32 r, bytes32 s) = sign(value, validBefore, pay);

        vm.prank(relayer);
        cashOut.cashOut(
            KovaCashOut.Authorization(ada, value, 0, validBefore, v, r, s), KovaCashOut.Payout(paj, pay, ref), swap
        );

        assertEq(IPayoutToken(USDC).balanceOf(paj), pay, "the partner gets exactly the USDC Ada signed for");
        assertEq(IAuthorizedDollar(AUSD).balanceOf(ada), held - value, "the swap used the $10 Ada signed");
        assertGt(IPayoutToken(USDC).balanceOf(ada), 0, "the USDC beyond the payment came home");
        assertEq(IAuthorizedDollar(AUSD).balanceOf(address(cashOut)), 0);
        assertEq(IPayoutToken(USDC).balanceOf(address(cashOut)), 0);
        emit log_named_decimal_uint("quoted USDC", quoted, 6);
        emit log_named_decimal_uint("paid to the partner", pay, 6);
        emit log_named_decimal_uint("USDC back to Ada", IPayoutToken(USDC).balanceOf(ada), 6);
    }

    /// KyberSwap's route for `value` AUSD, built for the contract (script/kyber-swap.sh).
    function liveRoute(uint256 value) internal returns (uint256 quoted, bytes memory swap) {
        return route(value, address(cashOut), "");
    }

    /// AUSD for Ada the way anyone gets it: MON swapped on the same market. (AUSD's storage isn't
    /// a plain balance mapping, so forge's `deal` can't write it.)
    function buyDollars(uint256 mon) internal {
        vm.deal(ada, mon);
        (, bytes memory swap) = route(
            mon,
            ada,
            "TOKEN_IN=0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE TOKEN_OUT=0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a "
        );
        vm.prank(ada);
        (bool ok,) = ROUTER.call{value: mon}(swap);
        assertTrue(ok, "MON for AUSD");
    }

    function route(uint256 amountIn, address sender, string memory tokens)
        internal
        returns (uint256 quoted, bytes memory swap)
    {
        string[] memory cmd = new string[](3);
        cmd[0] = "bash";
        cmd[1] = "-c";
        cmd[2] = string.concat(tokens, "bash script/kyber-swap.sh ", vm.toString(amountIn), " ", vm.toString(sender));
        return abi.decode(vm.ffi(cmd), (uint256, bytes));
    }

    /// Ada's signed transfer of `value` to the contract, its nonce naming the partner and `pay`.
    function sign(uint256 value, uint256 validBefore, uint256 pay) internal view returns (uint8, bytes32, bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
                ada,
                address(cashOut),
                value,
                0,
                validBefore,
                cashOut.nonceFor(paj, pay, ref)
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", ISigningDomain(AUSD).DOMAIN_SEPARATOR(), structHash));
        return vm.sign(adaKey, digest);
    }
}
