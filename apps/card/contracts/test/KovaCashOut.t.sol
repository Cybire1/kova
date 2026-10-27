// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {KovaCashOut, IAuthorizedDollar, IPayoutToken} from "../src/KovaCashOut.sol";

/// A dollar with EIP-3009 transferWithAuthorization, as AUSD has (same typehash and rules).
contract TransferDollar {
    string public constant name = "AUSD";
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => mapping(bytes32 => bool)) public authorizationState;
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 public immutable DOMAIN_SEPARATOR = keccak256(
        abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("AUSD"),
            keccak256("1"),
            block.chainid,
            address(this)
        )
    );

    function mint(address to, uint256 value) external {
        balanceOf[to] += value;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        allowance[from][msg.sender] -= value;
        balanceOf[from] -= value;
        balanceOf[to] += value;
        return true;
    }

    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(block.timestamp > validAfter && block.timestamp < validBefore, "not valid now");
        require(!authorizationState[from][nonce], "used");
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR,
                keccak256(
                    abi.encode(TRANSFER_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce)
                )
            )
        );
        require(ecrecover(digest, v, r, s) == from, "bad signature");
        authorizationState[from][nonce] = true;
        balanceOf[from] -= value;
        balanceOf[to] += value;
    }
}

/// USDC: a plain token here.
contract PlainUsdc {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 value) external {
        balanceOf[to] += value;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        return true;
    }
}

/// A swap router: takes `amountIn` of the dollar from its caller and pays it `amountOut` USDC.
contract SwapRouter {
    TransferDollar immutable dollar;
    PlainUsdc immutable usdc;

    constructor(TransferDollar dollar_, PlainUsdc usdc_) {
        dollar = dollar_;
        usdc = usdc_;
    }

    function swap(uint256 amountIn, uint256 amountOut) external {
        dollar.transferFrom(msg.sender, address(this), amountIn);
        usdc.mint(msg.sender, amountOut);
    }

    function fail() external pure {
        revert("no route");
    }
}

contract KovaCashOutTest is Test {
    TransferDollar dollar;
    PlainUsdc usdc;
    SwapRouter router;
    KovaCashOut cashOut;
    uint256 adaKey = 0xA11CE;
    address ada;
    address relayer = address(0xBEEF);
    address paj = address(0xFA11);
    bytes32 ref = bytes32(uint256(0x0190f3a2b4c5d6e7f8091a2b3c4d5e6f));
    uint256 validBefore;

    function setUp() public {
        vm.warp(1_800_000_000);
        validBefore = block.timestamp + 900;
        dollar = new TransferDollar();
        usdc = new PlainUsdc();
        router = new SwapRouter(dollar, usdc);
        cashOut =
            new KovaCashOut(IAuthorizedDollar(address(dollar)), IPayoutToken(address(usdc)), address(router), relayer);
        ada = vm.addr(adaKey);
        dollar.mint(ada, 100e6);
    }

    /// Ada signs a transfer of `value` to the contract, its nonce naming `payTo` and `pay`.
    function sign(uint256 value, address payTo, uint256 pay) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                dollar.DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        dollar.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(),
                        ada,
                        address(cashOut),
                        value,
                        0,
                        validBefore,
                        cashOut.nonceFor(payTo, pay, ref)
                    )
                )
            )
        );
        return vm.sign(adaKey, digest);
    }

    function run(uint256 value, address payTo, uint256 pay, bytes memory swap, uint8 v, bytes32 r, bytes32 s) internal {
        vm.prank(relayer);
        cashOut.cashOut(
            KovaCashOut.Authorization(ada, value, 0, validBefore, v, r, s), KovaCashOut.Payout(payTo, pay, ref), swap
        );
    }

    function swapping(uint256 amountIn, uint256 amountOut) internal pure returns (bytes memory) {
        return abi.encodeCall(SwapRouter.swap, (amountIn, amountOut));
    }

    function test_paysThePartnerExactlyWithOneSignature() public {
        (uint8 v, bytes32 r, bytes32 s) = sign(10e6, paj, 9.99e6);
        // The swap uses 9.995 of the 10 dollars and returns 9.9932 USDC.
        run(10e6, paj, 9.99e6, swapping(9.995e6, 9.9932e6), v, r, s);

        assertEq(usdc.balanceOf(paj), 9.99e6, "the partner gets exactly what the wallet signed");
        assertEq(dollar.balanceOf(ada), 90.005e6, "the dollars the swap didn't use come home");
        assertEq(usdc.balanceOf(ada), 0.0032e6, "and so does the USDC beyond the payment");
        assertEq(dollar.balanceOf(address(cashOut)), 0);
        assertEq(usdc.balanceOf(address(cashOut)), 0);
        assertEq(dollar.allowance(address(cashOut), address(router)), 0);
        assertTrue(cashOut.settled(ada, cashOut.nonceFor(paj, 9.99e6, ref)));
    }

    function test_aSwapThatComesUpShortMovesNothing() public {
        (uint8 v, bytes32 r, bytes32 s) = sign(10e6, paj, 9.99e6);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(KovaCashOut.Shortfall.selector, 9.98e6, 9.99e6));
        cashOut.cashOut(
            KovaCashOut.Authorization(ada, 10e6, 0, validBefore, v, r, s),
            KovaCashOut.Payout(paj, 9.99e6, ref),
            swapping(10e6, 9.98e6)
        );

        assertEq(dollar.balanceOf(ada), 100e6);
        assertFalse(dollar.authorizationState(ada, cashOut.nonceFor(paj, 9.99e6, ref)));
    }

    function test_aFailedSwapMovesNothing() public {
        (uint8 v, bytes32 r, bytes32 s) = sign(10e6, paj, 9.99e6);
        vm.prank(relayer);
        vm.expectRevert();
        cashOut.cashOut(
            KovaCashOut.Authorization(ada, 10e6, 0, validBefore, v, r, s),
            KovaCashOut.Payout(paj, 9.99e6, ref),
            abi.encodeCall(SwapRouter.fail, ())
        );
        assertEq(dollar.balanceOf(ada), 100e6);
    }

    function test_theSignatureDecidesWhereTheMoneyGoes() public {
        (uint8 v, bytes32 r, bytes32 s) = sign(10e6, paj, 9.99e6);
        address elsewhere = address(0xBAD);
        vm.prank(relayer);
        vm.expectRevert("bad signature");
        cashOut.cashOut(
            KovaCashOut.Authorization(ada, 10e6, 0, validBefore, v, r, s),
            KovaCashOut.Payout(elsewhere, 9.99e6, ref),
            swapping(10e6, 9.9932e6)
        );

        vm.prank(relayer);
        vm.expectRevert("bad signature");
        cashOut.cashOut(
            KovaCashOut.Authorization(ada, 10e6, 0, validBefore, v, r, s),
            KovaCashOut.Payout(paj, 1e6, ref),
            swapping(10e6, 9.9932e6)
        );
        assertEq(dollar.balanceOf(ada), 100e6);
    }

    function test_theRouterCantTakeMoreThanWasSigned() public {
        (uint8 v, bytes32 r, bytes32 s) = sign(10e6, paj, 9.99e6);
        vm.prank(relayer);
        vm.expectRevert();
        cashOut.cashOut(
            KovaCashOut.Authorization(ada, 10e6, 0, validBefore, v, r, s),
            KovaCashOut.Payout(paj, 9.99e6, ref),
            swapping(10e6 + 1, 20e6)
        );
        assertEq(dollar.balanceOf(ada), 100e6);
    }

    function test_onlyTheRelayerCarriesItOut() public {
        (uint8 v, bytes32 r, bytes32 s) = sign(10e6, paj, 9.99e6);
        vm.expectRevert(KovaCashOut.OnlyRelayer.selector);
        cashOut.cashOut(
            KovaCashOut.Authorization(ada, 10e6, 0, validBefore, v, r, s),
            KovaCashOut.Payout(paj, 9.99e6, ref),
            swapping(10e6, 9.9932e6)
        );
    }

    function test_aCashOutHappensOnce() public {
        (uint8 v, bytes32 r, bytes32 s) = sign(10e6, paj, 9.99e6);
        run(10e6, paj, 9.99e6, swapping(10e6, 9.9932e6), v, r, s);
        vm.prank(relayer);
        vm.expectRevert(KovaCashOut.AlreadySettled.selector);
        cashOut.cashOut(
            KovaCashOut.Authorization(ada, 10e6, 0, validBefore, v, r, s),
            KovaCashOut.Payout(paj, 9.99e6, ref),
            swapping(10e6, 9.9932e6)
        );
        assertEq(usdc.balanceOf(paj), 9.99e6);
    }

    function test_refundsATransferSubmittedOnItsOwn() public {
        (uint8 v, bytes32 r, bytes32 s) = sign(10e6, paj, 9.99e6);
        bytes32 nonce = cashOut.nonceFor(paj, 9.99e6, ref);
        // Someone lifts the signature and submits it to the dollar directly.
        dollar.transferWithAuthorization(ada, address(cashOut), 10e6, 0, validBefore, nonce, v, r, s);
        assertEq(dollar.balanceOf(address(cashOut)), 10e6);

        // The cash-out itself can't run now, and nobody but the relayer can refund.
        vm.prank(relayer);
        vm.expectRevert(bytes("used"));
        cashOut.cashOut(
            KovaCashOut.Authorization(ada, 10e6, 0, validBefore, v, r, s),
            KovaCashOut.Payout(paj, 9.99e6, ref),
            swapping(10e6, 9.9932e6)
        );
        vm.expectRevert(KovaCashOut.OnlyRelayer.selector);
        cashOut.refund(ada, 10e6, KovaCashOut.Payout(paj, 9.99e6, ref));

        vm.prank(relayer);
        cashOut.refund(ada, 10e6, KovaCashOut.Payout(paj, 9.99e6, ref));
        assertEq(dollar.balanceOf(ada), 100e6);
        assertEq(dollar.balanceOf(address(cashOut)), 0);

        vm.prank(relayer);
        vm.expectRevert(KovaCashOut.AlreadySettled.selector);
        cashOut.refund(ada, 10e6, KovaCashOut.Payout(paj, 9.99e6, ref));
    }

    function test_noRefundForATransferThatNeverHappened() public {
        vm.prank(relayer);
        vm.expectRevert(KovaCashOut.NotReceived.selector);
        cashOut.refund(ada, 10e6, KovaCashOut.Payout(paj, 9.99e6, ref));
    }
}
