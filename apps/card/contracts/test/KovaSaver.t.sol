// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {KovaSaver, ISavingsVault} from "../src/KovaSaver.sol";
import {KovaTestVault, IERC20Min} from "../src/KovaTestVault.sol";

/// A dollar with EIP-3009 receiveWithAuthorization, as AUSD has (same typehash and rules).
contract AuthDollar {
    string public constant name = "AUSD";
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => mapping(bytes32 => bool)) public authorizationState;
    bytes32 public constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
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
        if (allowance[from][msg.sender] != type(uint256).max) allowance[from][msg.sender] -= value;
        balanceOf[from] -= value;
        balanceOf[to] += value;
        return true;
    }

    function receiveWithAuthorization(
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
        require(to == msg.sender, "caller must be the payee");
        require(block.timestamp > validAfter && block.timestamp < validBefore, "not valid now");
        require(!authorizationState[from][nonce], "used");
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR,
                keccak256(abi.encode(RECEIVE_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce))
            )
        );
        require(ecrecover(digest, v, r, s) == from, "bad signature");
        authorizationState[from][nonce] = true;
        balanceOf[from] -= value;
        balanceOf[to] += value;
    }
}

contract KovaSaverTest is Test {
    AuthDollar dollar;
    KovaTestVault vault;
    KovaSaver saver;
    uint256 adaKey = 0xA11CE;
    address ada;
    address relayer = address(0xBEEF);

    function setUp() public {
        vm.warp(1_800_000_000);
        dollar = new AuthDollar();
        vault = new KovaTestVault(IERC20Min(address(dollar)));
        saver = new KovaSaver(ISavingsVault(address(vault)));
        ada = vm.addr(adaKey);
        dollar.mint(ada, 100e6);
    }

    function signReceive(uint256 value, bytes32 nonce) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                dollar.DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        dollar.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), ada, address(saver), value, 0, block.timestamp + 600, nonce
                    )
                )
            )
        );
        return vm.sign(adaKey, digest);
    }

    function signSharePermit(uint256 shares, uint256 deadline) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                vault.DOMAIN_SEPARATOR(),
                keccak256(abi.encode(vault.PERMIT_TYPEHASH(), ada, address(saver), shares, vault.nonces(ada), deadline))
            )
        );
        return vm.sign(adaKey, digest);
    }

    function save(uint256 value, bytes32 nonce) internal returns (uint256) {
        (uint8 v, bytes32 r, bytes32 s) = signReceive(value, nonce);
        vm.prank(relayer);
        return saver.save(ada, value, 0, block.timestamp + 600, nonce, v, r, s);
    }

    function test_savesInTheOwnersNameWithOneSignature() public {
        uint256 shares = save(40e6, bytes32(uint256(1)));
        assertEq(vault.balanceOf(ada), shares);
        assertEq(vault.convertToAssets(shares), 40e6);
        assertEq(dollar.balanceOf(ada), 60e6);
        assertEq(dollar.balanceOf(address(saver)), 0);
    }

    function test_aSignatureCantBeUsedTwice() public {
        bytes32 nonce = bytes32(uint256(2));
        (uint8 v, bytes32 r, bytes32 s) = signReceive(10e6, nonce);
        saver.save(ada, 10e6, 0, block.timestamp + 600, nonce, v, r, s);
        vm.expectRevert(bytes("used"));
        saver.save(ada, 10e6, 0, block.timestamp + 600, nonce, v, r, s);
    }

    function test_testInterestRaisesTheSharePrice() public {
        uint256 shares = save(50e6, bytes32(uint256(3)));
        dollar.mint(address(this), 5e6);
        dollar.approve(address(vault), 5e6);
        vault.addTestInterest(5e6);
        assertApproxEqAbs(vault.convertToAssets(shares), 55e6, 2);
    }

    function test_withdrawsOnlyBackToTheOwner() public {
        uint256 shares = save(30e6, bytes32(uint256(4)));
        uint256 deadline = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = signSharePermit(shares, deadline);
        vm.prank(relayer);
        uint256 assets = saver.withdraw(ada, shares, deadline, v, r, s);
        assertEq(vault.balanceOf(ada), 0);
        assertEq(dollar.balanceOf(ada), 70e6 + assets);
        assertEq(dollar.balanceOf(relayer), 0);
    }

    function test_aFrontRunPermitStillWithdraws() public {
        uint256 shares = save(20e6, bytes32(uint256(5)));
        uint256 deadline = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = signSharePermit(shares, deadline);
        vault.permit(ada, address(saver), shares, deadline, v, r, s); // someone used it first
        saver.withdraw(ada, shares, deadline, v, r, s);
        assertEq(vault.balanceOf(ada), 0);
    }

    function test_cantWithdrawWithoutTheOwnersPermit() public {
        uint256 shares = save(20e6, bytes32(uint256(6)));
        vm.expectRevert(KovaTestVault.Allowance.selector);
        saver.withdraw(ada, shares, block.timestamp + 600, 27, bytes32(0), bytes32(0));
    }
}
