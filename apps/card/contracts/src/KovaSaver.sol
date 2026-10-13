// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

/// @notice The parts of AUSD (an EIP-3009 dollar) savings needs.
interface IAuthorizedToken {
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
    ) external;
    function approve(address spender, uint256 value) external returns (bool);
}

/// @notice The parts of an ERC-4626 vault (with EIP-2612 permit on its shares) savings needs.
interface ISavingsVault {
    function asset() external view returns (address);
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets);
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external;
}

/// @title KovaSaver
/// @notice Moves a Kova wallet's dollars into and out of a savings vault with one signature, so
/// nobody needs MON: Kova's relayer carries each signature out and pays the gas.
///
/// In: the wallet signs an EIP-3009 receiveWithAuthorization naming this contract. Only this
/// contract can carry that out (EIP-3009 requires the caller to be the payee), and it deposits the
/// dollars in the wallet's own name, so the shares can't go anywhere else.
///
/// Out: the wallet signs an EIP-2612 permit on its vault shares for this contract, which redeems
/// them straight back to the same wallet. Whoever relays it, the dollars only go home.
///
/// The contract holds nothing between calls and has no owner.
contract KovaSaver {
    ISavingsVault public immutable vault;
    IAuthorizedToken public immutable token;

    event Saved(address indexed owner, uint256 assets, uint256 shares);
    event Withdrawn(address indexed owner, uint256 shares, uint256 assets);

    constructor(ISavingsVault vault_) {
        vault = vault_;
        token = IAuthorizedToken(vault_.asset());
        token.approve(address(vault_), type(uint256).max);
    }

    /// @notice Into savings: `value` of the owner's dollars, as the owner signed.
    function save(
        address owner,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (uint256 shares) {
        token.receiveWithAuthorization(owner, address(this), value, validAfter, validBefore, nonce, v, r, s);
        shares = vault.deposit(value, owner);
        emit Saved(owner, value, shares);
    }

    /// @notice Out of savings: `shares` of the owner's, back to the owner.
    function withdraw(address owner, uint256 shares, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
        returns (uint256 assets)
    {
        // A permit someone already used (by front-running this call) has still set the allowance.
        try vault.permit(owner, address(this), shares, deadline, v, r, s) {} catch {}
        assets = vault.redeem(shares, owner, owner);
        emit Withdrawn(owner, shares, assets);
    }
}
