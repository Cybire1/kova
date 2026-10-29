// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {KovaStocks, IAuthorizedDollar, IStockToken} from "../src/KovaStocks.sol";

interface ISigningDomain {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function nonces(address owner) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

/// Buying and selling a stock token against Monad mainnet as it is now: real AUSD, real TSLAx, and
/// live KyberSwap routes built for the contract. It needs the network, so it only runs when asked:
///
///   MONAD_FORK=1 forge test --match-contract KovaStocksForkTest --ffi -vv
contract KovaStocksForkTest is Test {
    address constant AUSD = 0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a;
    address constant TSLAX = 0x8aD3c73F833d3F9A523aB01476625F269aEB7Cf0;
    address constant ROUTER = 0x6131B5fae19EA4f9D964eAc0408E4408b66337b5;
    bytes32 constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    KovaStocks stocks;
    address relayer = makeAddr("relayer");
    address ada;
    uint256 adaKey;

    uint256 held;

    function test_buysTenDollarsOfTeslaAndSellsItBack() public {
        if (!vm.envOr("MONAD_FORK", false)) vm.skip(true);
        vm.createSelectFork(vm.envOr("MONAD_RPC_URL", string("https://rpc.monad.xyz")));
        (ada, adaKey) = makeAddrAndKey("ada");
        stocks = new KovaStocks(IAuthorizedDollar(AUSD), ROUTER, relayer);
        buyDollars(2000 ether);
        held = IAuthorizedDollar(AUSD).balanceOf(ada);
        assertGt(held, 10e6, "Ada bought enough AUSD to buy $10 of stock");

        uint256 shares = buyTesla(10e6);
        sellTesla(shares);
    }

    /// A live route is quoted on Monad as it is now, a few dozen blocks past the fork, and a pool
    /// that moved in between can fail its hop. The API takes a fresh route and asks again; so does
    /// this test, up to three times, with a fresh signature each time.
    uint256 constant TRIES = 3;

    /// Buys `value` dollars of TSLAx, at least 1% under the live quote, as the API asks.
    function buyTesla(uint256 value) internal returns (uint256 shares) {
        for (uint256 i = 1;; i++) {
            bytes32 ref = keccak256(abi.encode("buy", i));
            (uint256 quoted, bytes memory swap) = route(value, address(stocks), AUSD, TSLAX);
            uint256 minOut = quoted * 99 / 100;
            uint256 validBefore = block.timestamp + 60;
            (uint8 v, bytes32 r, bytes32 s) = signBuy(value, validBefore, stocks.buyNonce(TSLAX, minOut, ref));

            vm.prank(relayer);
            uint256 gasBefore = gasleft();
            try stocks.buy(
                KovaStocks.Authorization(ada, value, 0, validBefore, v, r, s), TSLAX, minOut, ref, swap
            ) returns (
                uint256 got
            ) {
                emit log_named_uint("buy gas", gasBefore - gasleft());
                shares = got;
                assertGe(shares, minOut);
                emit log_named_decimal_uint("TSLAx quoted", quoted, 18);
                break;
            } catch (bytes memory reason) {
                retryOrFail(reason, i);
            }
        }
        assertEq(IStockToken(TSLAX).balanceOf(ada), shares, "every share is Ada's");
        assertEq(IAuthorizedDollar(AUSD).balanceOf(ada), held - value, "the swap used the $10 Ada signed");
        assertHoldsNothing();
        emit log_named_decimal_uint("dollars in", value, 6);
        emit log_named_decimal_uint("TSLAx bought", shares, 18);
    }

    /// Sells all `shares` back, at least 1% under a live quote, with an order and a permit.
    function sellTesla(uint256 shares) internal {
        uint256 dollarsBefore = IAuthorizedDollar(AUSD).balanceOf(ada);
        uint256 dollars;
        for (uint256 i = 1;; i++) {
            (uint256 quoted, bytes memory swap) = route(shares, address(stocks), TSLAX, AUSD);
            KovaStocks.SellOrder memory order = KovaStocks.SellOrder(
                ada, TSLAX, shares, quoted * 99 / 100, block.timestamp + 60, keccak256(abi.encode("sell", i))
            );
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(adaKey, stocks.sellDigest(order));
            bytes memory orderSig = abi.encodePacked(r, s, v);
            KovaStocks.Permit memory permit = signPermit(shares, order.deadline);
            assertEq(ISigningDomain(TSLAX).allowance(ada, address(stocks)), 0, "Ada never approved the contract");

            vm.prank(relayer);
            uint256 gasBefore = gasleft();
            try stocks.sell(order, orderSig, permit, swap) returns (uint256 got) {
                emit log_named_uint("sell gas", gasBefore - gasleft());
                dollars = got;
                assertGe(dollars, order.minOut);
                assertTrue(stocks.used(ada, order.ref));
                emit log_named_decimal_uint("dollars quoted back", quoted, 6);
                break;
            } catch (bytes memory reason) {
                retryOrFail(reason, i);
            }
        }
        assertEq(IStockToken(TSLAX).balanceOf(ada), 0, "Ada sold every share");
        assertEq(IAuthorizedDollar(AUSD).balanceOf(ada), dollarsBefore + dollars, "the dollars came home");
        assertHoldsNothing();
        emit log_named_decimal_uint("dollars back", dollars, 6);
    }

    /// A route that failed its swap is tried again with a fresh one; any other failure is the test's.
    function retryOrFail(bytes memory reason, uint256 tried) internal {
        if (bytes4(reason) != KovaStocks.SwapFailed.selector || tried == TRIES) {
            assembly {
                revert(add(reason, 32), mload(reason))
            }
        }
        emit log_named_uint("a stale route failed its swap; fresh route, try", tried + 1);
    }

    function assertHoldsNothing() internal view {
        assertEq(IAuthorizedDollar(AUSD).balanceOf(address(stocks)), 0, "no dollars left in the contract");
        assertEq(IStockToken(TSLAX).balanceOf(address(stocks)), 0, "no shares left in the contract");
    }

    /// AUSD for Ada the way anyone gets it: MON swapped on the same market. (AUSD's storage isn't
    /// a plain balance mapping, so forge's `deal` can't write it.)
    function buyDollars(uint256 mon) internal {
        vm.deal(ada, mon);
        (, bytes memory swap) = route(mon, ada, 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE, AUSD);
        vm.prank(ada);
        (bool ok,) = ROUTER.call{value: mon}(swap);
        assertTrue(ok, "MON for AUSD");
    }

    /// KyberSwap's live route for `amountIn` of `tokenIn` to `tokenOut`, built for `sender` as the
    /// router's caller and recipient (script/kyber-swap.sh).
    function route(uint256 amountIn, address sender, address tokenIn, address tokenOut)
        internal
        returns (uint256 quoted, bytes memory swap)
    {
        string[] memory cmd = new string[](3);
        cmd[0] = "bash";
        cmd[1] = "-c";
        cmd[2] = string.concat(
            "TOKEN_IN=",
            vm.toString(tokenIn),
            " TOKEN_OUT=",
            vm.toString(tokenOut),
            " bash script/kyber-swap.sh ",
            vm.toString(amountIn),
            " ",
            vm.toString(sender)
        );
        return abi.decode(vm.ffi(cmd), (uint256, bytes));
    }

    /// Ada's signed receive of `value` by the contract, its nonce naming the stock and the floor.
    function signBuy(uint256 value, uint256 validBefore, bytes32 nonce)
        internal
        view
        returns (uint8, bytes32, bytes32)
    {
        bytes32 structHash = keccak256(
            abi.encode(RECEIVE_WITH_AUTHORIZATION_TYPEHASH, ada, address(stocks), value, 0, validBefore, nonce)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", ISigningDomain(AUSD).DOMAIN_SEPARATOR(), structHash));
        return vm.sign(adaKey, digest);
    }

    /// Ada's EIP-2612 permit on TSLAx for the contract.
    function signPermit(uint256 value, uint256 deadline) internal view returns (KovaStocks.Permit memory) {
        bytes32 structHash = keccak256(
            abi.encode(PERMIT_TYPEHASH, ada, address(stocks), value, ISigningDomain(TSLAX).nonces(ada), deadline)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", ISigningDomain(TSLAX).DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(adaKey, digest);
        return KovaStocks.Permit(deadline, v, r, s);
    }
}
