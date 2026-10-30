// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {KovaRepeat, IRepeatDollar} from "../src/KovaRepeat.sol";
import {Dollar} from "./KovaCard.t.sol";

contract KovaRepeatTest is Test {
    Dollar dollar;
    KovaRepeat repeat;

    uint256 payerKey = 0xA11CE;
    address payer;
    address landlord = address(0x1A4D);

    uint96 constant RENT = 50e6;
    uint32 constant WEEK = 7 days;

    function setUp() public {
        vm.warp(1_760_000_000);
        payer = vm.addr(payerKey);
        dollar = new Dollar();
        repeat = new KovaRepeat(IRepeatDollar(address(dollar)));
        dollar.mint(payer, 500e6);
    }

    function _sign(bytes32 structHash, uint256 key) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(key, keccak256(abi.encodePacked("\x19\x01", repeat.DOMAIN_SEPARATOR(), structHash)));
        return abi.encodePacked(r, s, v);
    }

    function _permit(uint256 value) internal view returns (KovaRepeat.Permit memory) {
        uint256 deadline = block.timestamp + 600;
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                dollar.DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                        payer,
                        address(repeat),
                        value,
                        dollar.nonces(payer),
                        deadline
                    )
                )
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(payerKey, digest);
        return KovaRepeat.Permit(value, deadline, v, r, s);
    }

    function _start(uint40 startAt, uint32 times) internal returns (uint256) {
        uint256 deadline = block.timestamp + 600;
        bytes32 structHash = keccak256(
            abi.encode(
                repeat.PLAN_TYPEHASH(), payer, landlord, RENT, WEEK, startAt, times, repeat.nonces(payer), deadline
            )
        );
        return repeat.start(
            payer, landlord, RENT, WEEK, startAt, times, deadline, _sign(structHash, payerKey), _permit(RENT * times)
        );
    }

    function test_theFirstPaymentGoesNowWhenItsDue() public {
        uint256 id = _start(uint40(block.timestamp), 4);
        assertEq(dollar.balanceOf(landlord), RENT);
        KovaRepeat.Plan memory p = repeat.planOf(id);
        assertEq(p.left, 3);
        assertEq(p.next, block.timestamp + WEEK);
    }

    function test_neverEarlyNeverTwice() public {
        uint256 id = _start(uint40(block.timestamp), 4);
        vm.expectRevert(KovaRepeat.NotDue.selector);
        repeat.collect(id);
        vm.warp(block.timestamp + WEEK);
        repeat.collect(id);
        vm.expectRevert(KovaRepeat.NotDue.selector);
        repeat.collect(id);
        assertEq(dollar.balanceOf(landlord), 2 * RENT);
    }

    function test_neverMoreTimesThanThePlanSays() public {
        uint256 id = _start(uint40(block.timestamp), 2);
        vm.warp(block.timestamp + WEEK);
        repeat.collect(id);
        vm.warp(block.timestamp + WEEK);
        vm.expectRevert(KovaRepeat.Finished.selector);
        repeat.collect(id);
        assertEq(dollar.balanceOf(landlord), 2 * RENT);
    }

    function test_missedWeeksAreSkippedNotCollectedInABurst() public {
        uint256 id = _start(uint40(block.timestamp), 10);
        vm.warp(block.timestamp + 3 * WEEK + 1 days);
        repeat.collect(id);
        vm.expectRevert(KovaRepeat.NotDue.selector);
        repeat.collect(id);
        assertEq(dollar.balanceOf(landlord), 2 * RENT);
        assertEq(repeat.planOf(id).next, 1_760_000_000 + 4 * WEEK);
    }

    function test_aLaterStartWaitsForItsDay() public {
        uint256 id = _start(uint40(block.timestamp + 2 days), 3);
        assertEq(dollar.balanceOf(landlord), 0);
        assertFalse(repeat.due(id));
        vm.warp(block.timestamp + 2 days);
        assertTrue(repeat.due(id));
        repeat.collect(id);
        assertEq(dollar.balanceOf(landlord), RENT);
    }

    function test_aShortWalletStillStartsThePlanAndPaysLater() public {
        // Everything but $10 leaves the wallet: the first $50 can't go yet.
        _drain(dollar.balanceOf(payer) - 10e6);
        uint256 id = _start(uint40(block.timestamp), 2);
        assertEq(dollar.balanceOf(landlord), 0);
        assertEq(repeat.planOf(id).left, 2);
        assertTrue(repeat.due(id));
        // Money arrives; the keeper collects.
        dollar.mint(payer, RENT);
        repeat.collect(id);
        assertEq(dollar.balanceOf(landlord), RENT);
        assertEq(repeat.planOf(id).left, 1);
    }

    function _drain(uint256 value) internal {
        // The mock has no transfer: spend it through a permit to a sink.
        uint256 deadline = block.timestamp + 600;
        address sink = address(0x51CC);
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                dollar.DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                        payer,
                        sink,
                        value,
                        dollar.nonces(payer),
                        deadline
                    )
                )
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(payerKey, digest);
        dollar.permit(payer, sink, value, deadline, v, r, s);
        vm.prank(sink);
        dollar.transferFrom(payer, sink, value);
    }

    function test_thePayerCanStopIt() public {
        uint256 id = _start(uint40(block.timestamp), 4);
        uint256 deadline = block.timestamp + 600;
        bytes32 structHash = keccak256(abi.encode(repeat.STOP_TYPEHASH(), payer, id, repeat.nonces(payer), deadline));
        repeat.stop(id, deadline, _sign(structHash, payerKey));
        vm.warp(block.timestamp + WEEK);
        vm.expectRevert(KovaRepeat.Finished.selector);
        repeat.collect(id);
    }

    function test_onlyThePayerSignsAStop() public {
        uint256 id = _start(uint40(block.timestamp), 4);
        uint256 deadline = block.timestamp + 600;
        bytes32 structHash = keccak256(abi.encode(repeat.STOP_TYPEHASH(), payer, id, repeat.nonces(payer), deadline));
        bytes memory forged = _sign(structHash, 0xBAD);
        vm.expectRevert(KovaRepeat.BadSignature.selector);
        repeat.stop(id, deadline, forged);
    }

    function test_thePayeeCanStopReceivingIt() public {
        uint256 id = _start(uint40(block.timestamp), 4);
        vm.prank(address(0xBAD));
        vm.expectRevert(KovaRepeat.NotAllowed.selector);
        repeat.stopDirect(id);
        vm.prank(landlord);
        repeat.stopDirect(id);
        assertTrue(repeat.planOf(id).stopped);
    }

    function test_aPlanSignatureWorksOnce() public {
        uint256 deadline = block.timestamp + 600;
        bytes32 structHash = keccak256(
            abi.encode(
                repeat.PLAN_TYPEHASH(),
                payer,
                landlord,
                RENT,
                WEEK,
                uint40(block.timestamp + 1 days),
                uint32(3),
                uint256(0),
                deadline
            )
        );
        bytes memory sig = _sign(structHash, payerKey);
        KovaRepeat.Permit memory none = KovaRepeat.Permit(0, 0, 0, 0, 0);
        repeat.start(payer, landlord, RENT, WEEK, uint40(block.timestamp + 1 days), 3, deadline, sig, none);
        vm.expectRevert(KovaRepeat.BadSignature.selector);
        repeat.start(payer, landlord, RENT, WEEK, uint40(block.timestamp + 1 days), 3, deadline, sig, none);
    }

    function test_rejectsNonsensePlans() public {
        uint256 deadline = block.timestamp + 600;
        KovaRepeat.Permit memory none = KovaRepeat.Permit(0, 0, 0, 0, 0);
        vm.expectRevert(KovaRepeat.BadPlan.selector);
        repeat.start(payer, landlord, RENT, 60, uint40(block.timestamp), 3, deadline, "", none); // every minute
        vm.expectRevert(KovaRepeat.BadPlan.selector);
        repeat.start(payer, payer, RENT, WEEK, uint40(block.timestamp), 3, deadline, "", none); // to yourself
    }
}
