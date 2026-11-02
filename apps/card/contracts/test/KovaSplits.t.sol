// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {KovaSplits, KovaSplitter, ISplitDollar} from "../src/KovaSplits.sol";
import {TransferDollar} from "./KovaCashOut.t.sol";

contract KovaSplitsTest is Test {
    TransferDollar dollar;
    KovaSplits splits;

    uint256 shopKey = 0x5409;
    uint256 customerKey = 0xC057;
    address shop;
    address customer;
    address savings = address(0x5A4E);
    address partner = address(0x9A47);

    function setUp() public {
        vm.warp(1_760_000_000);
        shop = vm.addr(shopKey);
        customer = vm.addr(customerKey);
        dollar = new TransferDollar();
        splits = new KovaSplits(ISplitDollar(address(dollar)));
        dollar.mint(customer, 1_000e6);
    }

    function _rules(address[] memory to, uint16[] memory bps, uint256 deadline, uint256 key)
        internal
        view
        returns (bytes memory)
    {
        address owner = vm.addr(key);
        bytes32 structHash = keccak256(
            abi.encode(
                splits.RULES_TYPEHASH(),
                owner,
                keccak256(abi.encodePacked(to)),
                keccak256(abi.encodePacked(bps)),
                splits.nonces(owner),
                deadline
            )
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(key, keccak256(abi.encodePacked("\x19\x01", splits.DOMAIN_SEPARATOR(), structHash)));
        return abi.encodePacked(r, s, v);
    }

    function _tenAndFive() internal pure returns (address[] memory to, uint16[] memory bps) {
        to = new address[](2);
        bps = new uint16[](2);
        to[0] = address(0x5A4E);
        to[1] = address(0x9A47);
        bps[0] = 1000; // 10% to savings
        bps[1] = 500; // 5% to a partner
    }

    function _setUp() internal returns (KovaSplitter splitter) {
        (address[] memory to, uint16[] memory bps) = _tenAndFive();
        uint256 deadline = block.timestamp + 600;
        splitter = KovaSplitter(splits.setRules(shop, to, bps, deadline, _rules(to, bps, deadline, shopKey)));
    }

    function _authorize(address to, uint256 value, bytes32 nonce)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                dollar.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(),
                customer,
                to,
                value,
                block.timestamp - 1,
                block.timestamp + 600,
                nonce
            )
        );
        return vm.sign(customerKey, keccak256(abi.encodePacked("\x19\x01", dollar.DOMAIN_SEPARATOR(), structHash)));
    }

    function test_splitterAddressIsKnownBeforeItExists() public {
        address predicted = splits.splitterOf(shop);
        assertEq(predicted.code.length, 0);
        KovaSplitter splitter = _setUp();
        assertEq(address(splitter), predicted);
        (address owner, address[] memory to, uint16[] memory bps) = splitter.rules();
        assertEq(owner, shop);
        assertEq(to.length, 2);
        assertEq(bps[0], 1000);
    }

    function test_aSaleIsSplitInTheSameTransaction() public {
        KovaSplitter splitter = _setUp();
        bytes32 nonce = keccak256("charge");
        (uint8 v, bytes32 r, bytes32 s) = _authorize(address(splitter), 6_500_000, nonce);
        splitter.collect(customer, 6_500_000, block.timestamp - 1, block.timestamp + 600, nonce, v, r, s);
        assertEq(dollar.balanceOf(savings), 650_000);
        assertEq(dollar.balanceOf(partner), 325_000);
        assertEq(dollar.balanceOf(shop), 5_525_000);
        assertEq(dollar.balanceOf(address(splitter)), 0);
        assertTrue(dollar.authorizationState(customer, nonce));
    }

    function test_roundingGoesToTheShop() public {
        KovaSplitter splitter = _setUp();
        dollar.mint(address(splitter), 7); // 7 base units: 10% and 5% both round down to 0
        splitter.release();
        assertEq(dollar.balanceOf(shop), 7);
        assertEq(dollar.balanceOf(savings), 0);
    }

    function test_aTransferThatSkipsCollectIsStillSplitByRelease() public {
        KovaSplitter splitter = _setUp();
        bytes32 nonce = keccak256("front-run");
        (uint8 v, bytes32 r, bytes32 s) = _authorize(address(splitter), 10e6, nonce);
        // Someone submits the authorization straight to the token: the money waits in the splitter.
        dollar.transferWithAuthorization(
            customer, address(splitter), 10e6, block.timestamp - 1, block.timestamp + 600, nonce, v, r, s
        );
        vm.prank(address(0xBAD));
        splitter.release();
        assertEq(dollar.balanceOf(savings), 1e6);
        assertEq(dollar.balanceOf(partner), 0.5e6);
        assertEq(dollar.balanceOf(shop), 8.5e6);
    }

    function test_onlyTheShopCanChangeTheRules() public {
        KovaSplitter splitter = _setUp();
        (address[] memory to, uint16[] memory bps) = _tenAndFive();
        to[0] = address(0xBAD);
        uint256 deadline = block.timestamp + 600;
        bytes memory forged = _rules(to, bps, deadline, 0xBAD);
        vm.expectRevert(KovaSplits.BadSignature.selector);
        splits.setRules(shop, to, bps, deadline, forged);
        vm.prank(address(0xBAD));
        vm.expectRevert(KovaSplitter.NotAllowed.selector);
        splitter.configure(to, bps);
        // The shop itself, straight from its wallet, may.
        vm.prank(shop);
        splitter.configure(to, bps);
    }

    function test_aRulesSignatureWorksOnce() public {
        (address[] memory to, uint16[] memory bps) = _tenAndFive();
        uint256 deadline = block.timestamp + 600;
        bytes memory sig = _rules(to, bps, deadline, shopKey);
        splits.setRules(shop, to, bps, deadline, sig);
        vm.expectRevert(KovaSplits.BadSignature.selector);
        splits.setRules(shop, to, bps, deadline, sig);
    }

    function test_rulesCantTakeMoreThanEverything() public {
        address[] memory to = new address[](2);
        uint16[] memory bps = new uint16[](2);
        to[0] = savings;
        to[1] = partner;
        bps[0] = 6000;
        bps[1] = 5000;
        vm.prank(shop);
        vm.expectRevert(KovaSplitter.BadRules.selector);
        splits.setRulesDirect(to, bps);
    }

    function test_changingRulesSharesWhatsThereByTheOldOnesFirst() public {
        KovaSplitter splitter = _setUp();
        dollar.mint(address(splitter), 100e6);
        address[] memory none = new address[](0);
        uint16[] memory zero = new uint16[](0);
        vm.prank(shop);
        splits.setRulesDirect(none, zero);
        assertEq(dollar.balanceOf(savings), 10e6);
        assertEq(dollar.balanceOf(shop), 85e6);
        // With no shares, everything goes to the shop.
        dollar.mint(address(splitter), 4e6);
        splitter.release();
        assertEq(dollar.balanceOf(shop), 89e6);
    }

    function test_theImplementationIsNobodysSplitter() public {
        KovaSplitter impl = KovaSplitter(splits.implementation());
        vm.expectRevert(KovaSplitter.NotAllowed.selector);
        impl.initialize(address(this));
    }

    // KupiaSec's report (2 Nov 2026): one share AUSD won't send to used to stop every sale, block
    // the rules from changing and strand what was in the splitter. Now that share is held for its
    // address and everything else carries on.

    function test_aFrozenShareDoesntStopASale() public {
        KovaSplitter splitter = _setUp();
        dollar.freeze(partner, true);
        bytes32 nonce = keccak256("partner frozen");
        (uint8 v, bytes32 r, bytes32 s) = _authorize(address(splitter), 6_500_000, nonce);
        splitter.collect(customer, 6_500_000, block.timestamp - 1, block.timestamp + 600, nonce, v, r, s);
        assertEq(dollar.balanceOf(savings), 650_000);
        assertEq(dollar.balanceOf(shop), 5_525_000);
        // The partner's 5% waits here, held for the partner alone.
        assertEq(dollar.balanceOf(partner), 0);
        assertEq(splitter.owed(partner), 325_000);
        assertEq(splitter.totalOwed(), 325_000);
        assertEq(dollar.balanceOf(address(splitter)), 325_000);
    }

    function test_heldDollarsArentSharedOutAgain() public {
        KovaSplitter splitter = _setUp();
        dollar.freeze(partner, true);
        dollar.mint(address(splitter), 10e6);
        splitter.release();
        splitter.release(); // nothing new arrived, so nothing moves
        assertEq(dollar.balanceOf(shop), 8_500_000);
        assertEq(dollar.balanceOf(savings), 1_000_000);
        assertEq(splitter.owed(partner), 500_000);
        dollar.mint(address(splitter), 10e6);
        splitter.release();
        assertEq(dollar.balanceOf(shop), 17_000_000);
        assertEq(splitter.owed(partner), 1_000_000);
        assertEq(dollar.balanceOf(address(splitter)), 1_000_000);
    }

    function test_aFrozenShareDoesntStopTheShopChangingItsRules() public {
        KovaSplitter splitter = _setUp();
        dollar.freeze(partner, true);
        dollar.mint(address(splitter), 10e6);
        address[] memory to = new address[](1);
        uint16[] memory bps = new uint16[](1);
        to[0] = savings;
        bps[0] = 1000;
        uint256 deadline = block.timestamp + 600;
        splits.setRules(shop, to, bps, deadline, _rules(to, bps, deadline, shopKey));
        (, address[] memory shares,) = splitter.rules();
        assertEq(shares.length, 1);
        // What was here went out by the old rules, and the partner's part of it is still theirs.
        assertEq(dollar.balanceOf(shop), 8_500_000);
        assertEq(splitter.owed(partner), 500_000);
    }

    function test_heldDollarsGoOnlyToTheirAddressOnceItCanTakeThem() public {
        KovaSplitter splitter = _setUp();
        dollar.freeze(partner, true);
        dollar.mint(address(splitter), 10e6);
        splitter.release();
        // Still frozen: the try fails and the dollars stay held.
        vm.expectRevert(KovaSplitter.TransferFailed.selector);
        splitter.withdraw(partner);
        assertEq(splitter.owed(partner), 500_000);
        dollar.freeze(partner, false);
        vm.prank(address(0xBEEF)); // anyone may send them, and only to the partner
        splitter.withdraw(partner);
        assertEq(dollar.balanceOf(partner), 500_000);
        assertEq(dollar.balanceOf(address(0xBEEF)), 0);
        assertEq(splitter.owed(partner), 0);
        assertEq(splitter.totalOwed(), 0);
        assertEq(dollar.balanceOf(address(splitter)), 0);
        // Nothing left to send: a second call does nothing.
        splitter.withdraw(partner);
        assertEq(dollar.balanceOf(partner), 500_000);
    }

    function test_aFrozenShopWalletDoesntStopItsShares() public {
        KovaSplitter splitter = _setUp();
        dollar.freeze(shop, true);
        dollar.mint(address(splitter), 10e6);
        splitter.release();
        assertEq(dollar.balanceOf(savings), 1_000_000);
        assertEq(dollar.balanceOf(partner), 500_000);
        assertEq(splitter.owed(shop), 8_500_000);
    }

    function testFuzz_everyDollarIsPaidOrHeld(uint96 amount, bool savingsFrozen, bool partnerFrozen, bool shopFrozen)
        public
    {
        KovaSplitter splitter = _setUp();
        dollar.freeze(savings, savingsFrozen);
        dollar.freeze(partner, partnerFrozen);
        dollar.freeze(shop, shopFrozen);
        dollar.mint(address(splitter), amount);
        splitter.release();
        uint256 paid = dollar.balanceOf(savings) + dollar.balanceOf(partner) + dollar.balanceOf(shop);
        assertEq(paid + splitter.totalOwed(), amount);
        assertEq(dollar.balanceOf(address(splitter)), splitter.totalOwed());
        assertEq(splitter.owed(savings) + splitter.owed(partner) + splitter.owed(shop), splitter.totalOwed());
    }
}
