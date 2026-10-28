// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {KovaSaver, ISavingsVault} from "../src/KovaSaver.sol";

interface IDollar {
    function balanceOf(address) external view returns (uint256);
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}

interface ISetsAusd {
    function balanceOf(address) external view returns (uint256);
    function convertToAssets(uint256 shares) external view returns (uint256);
    function maxDeposit(address) external view returns (uint256);
    function maxRedeem(address) external view returns (uint256);
    function nonces(address) external view returns (uint256);
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}

/// Savings against Monad mainnet as it is now: real AUSD into Setsuna's setsAUSD vault through an
/// unchanged KovaSaver, and back. Ada signs twice and never holds MON; the relayer carries both
/// signatures, as Kova's API does. It needs the network, so it only runs when asked:
///
///   MONAD_FORK=1 forge test --match-contract KovaSaverSetsunaForkTest --ffi -vv
contract KovaSaverSetsunaForkTest is Test {
    address constant AUSD = 0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a;
    address constant SETS_AUSD = 0x551903E3687820A733FBe406DD33Fee8D12bd2F3;
    address constant ROUTER = 0x6131B5fae19EA4f9D964eAc0408E4408b66337b5;
    bytes32 constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    KovaSaver saver;
    ISetsAusd vault = ISetsAusd(SETS_AUSD);
    address relayer = makeAddr("relayer");
    address ada;
    uint256 adaKey;

    function test_savesAndWithdrawsRealAusdThroughSetsuna() public {
        if (!vm.envOr("MONAD_FORK", false)) vm.skip(true);
        vm.createSelectFork(vm.envOr("MONAD_RPC_URL", string("https://rpc.monad.xyz")));
        (ada, adaKey) = makeAddrAndKey("ada");
        saver = new KovaSaver(ISavingsVault(SETS_AUSD));
        buyDollars(2000 ether);
        uint256 held = IDollar(AUSD).balanceOf(ada);
        uint256 value = 10e6;
        assertGt(held, value, "Ada bought more than $10 of AUSD");
        assertGe(vault.maxDeposit(ada), value, "the vault has room for $10");

        // In: one signed receiveWithAuthorization naming KovaSaver, carried out by the relayer.
        uint256 validBefore = block.timestamp + 600;
        bytes32 nonce = keccak256("kova-savings-1");
        (uint8 v, bytes32 r, bytes32 s) = signReceive(value, validBefore, nonce);
        uint256 gas = gasleft();
        vm.prank(relayer);
        uint256 shares = saver.save(ada, value, 0, validBefore, nonce, v, r, s);
        emit log_named_uint("save gas (Ethereum's schedule, not Monad's)", gas - gasleft());

        assertEq(vault.balanceOf(ada), shares, "the shares are Ada's");
        assertEq(IDollar(AUSD).balanceOf(ada), held - value, "exactly the $10 Ada signed left");
        assertApproxEqRel(vault.convertToAssets(shares), value, 0.002e18, "worth the $10, less the swap");
        assertEq(IDollar(AUSD).balanceOf(address(saver)), 0, "KovaSaver keeps no dollars");
        assertEq(vault.balanceOf(address(saver)), 0, "KovaSaver keeps no shares");
        assertEq(vault.balanceOf(relayer), 0, "the relayer gets nothing");
        emit log_named_decimal_uint("savings worth", vault.convertToAssets(shares), 6);

        // Out: one EIP-2612 permit on the shares; the dollars can only go back to Ada.
        assertEq(vault.maxRedeem(ada), shares, "all of it can come out now");
        uint256 deadline = block.timestamp + 600;
        (v, r, s) = signPermit(shares, deadline);
        gas = gasleft();
        vm.prank(relayer);
        uint256 assets = saver.withdraw(ada, shares, deadline, v, r, s);
        emit log_named_uint("withdraw gas (Ethereum's schedule, not Monad's)", gas - gasleft());

        assertEq(vault.balanceOf(ada), 0, "no shares left");
        assertEq(IDollar(AUSD).balanceOf(ada), held - value + assets, "the dollars came home");
        assertGe(assets, value * 998 / 1000, "at most 0.2% lost to the two swaps");
        assertEq(IDollar(AUSD).balanceOf(relayer), 0, "the relayer gets nothing");
        assertEq(IDollar(AUSD).balanceOf(address(saver)), 0, "KovaSaver keeps no dollars");
        emit log_named_decimal_uint("AUSD back from $10", assets, 6);
    }

    function signReceive(uint256 value, uint256 validBefore, bytes32 nonce)
        internal
        view
        returns (uint8, bytes32, bytes32)
    {
        bytes32 structHash = keccak256(
            abi.encode(RECEIVE_WITH_AUTHORIZATION_TYPEHASH, ada, address(saver), value, 0, validBefore, nonce)
        );
        return vm.sign(adaKey, keccak256(abi.encodePacked("\x19\x01", IDollar(AUSD).DOMAIN_SEPARATOR(), structHash)));
    }

    function signPermit(uint256 shares, uint256 deadline) internal view returns (uint8, bytes32, bytes32) {
        bytes32 structHash =
            keccak256(abi.encode(PERMIT_TYPEHASH, ada, address(saver), shares, vault.nonces(ada), deadline));
        return vm.sign(adaKey, keccak256(abi.encodePacked("\x19\x01", vault.DOMAIN_SEPARATOR(), structHash)));
    }

    /// AUSD for Ada the way anyone gets it: MON swapped on a live KyberSwap route.
    function buyDollars(uint256 mon) internal {
        vm.deal(ada, mon);
        string[] memory cmd = new string[](3);
        cmd[0] = "bash";
        cmd[1] = "-c";
        cmd[2] = string.concat(
            "TOKEN_IN=0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE TOKEN_OUT=",
            vm.toString(AUSD),
            " bash script/kyber-swap.sh ",
            vm.toString(mon),
            " ",
            vm.toString(ada)
        );
        (, bytes memory swap) = abi.decode(vm.ffi(cmd), (uint256, bytes));
        vm.prank(ada);
        (bool ok,) = ROUTER.call{value: mon}(swap);
        assertTrue(ok, "MON for AUSD");
    }
}
