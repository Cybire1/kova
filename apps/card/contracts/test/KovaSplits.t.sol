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
}
