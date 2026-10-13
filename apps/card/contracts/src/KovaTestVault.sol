// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

interface IERC20Min {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function balanceOf(address owner) external view returns (uint256);
}

/// @title KovaTestVault
/// @notice TESTNET ONLY. A plain ERC-4626 savings vault for test dollars, so savings can be tried
/// on Monad testnet. It earns nothing by itself: "test interest" is test dollars Kova's testnet
/// treasury adds with `addTestInterest`, which raises every saver's share price. On mainnet Kova
/// uses a real vault for AUSD instead.
///
/// Shares carry EIP-2612 permits, so KovaSaver can redeem them back to their owner.
contract KovaTestVault {
    string public constant name = "Kova Test Savings";
    string public constant symbol = "tSAVE";
    uint8 public constant decimals = 6;

    IERC20Min public immutable assetToken;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => uint256) public nonces;

    bytes32 public constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
    bytes32 private immutable domainSeparator;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares);
    event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares);
    event TestInterest(address indexed from, uint256 assets);

    error Expired();
    error BadSignature();
    error Allowance();
    error Balance();
    error TransferFailed();
    error Zero();

    constructor(IERC20Min asset_) {
        assetToken = asset_;
        domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    // ── ERC-4626 ─────────────────────────────────────────────────────────────────────────────────

    function asset() external view returns (address) {
        return address(assetToken);
    }

    function totalAssets() public view returns (uint256) {
        return assetToken.balanceOf(address(this));
    }

    /// One virtual share and one virtual unit of assets keep the first deposit from being gamed.
    function convertToShares(uint256 assets) public view returns (uint256) {
        return assets * (totalSupply + 1) / (totalAssets() + 1);
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        return shares * (totalAssets() + 1) / (totalSupply + 1);
    }

    function previewDeposit(uint256 assets) external view returns (uint256) {
        return convertToShares(assets);
    }

    function previewRedeem(uint256 shares) external view returns (uint256) {
        return convertToAssets(shares);
    }

    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        shares = convertToShares(assets);
        if (shares == 0) revert Zero();
        if (!assetToken.transferFrom(msg.sender, address(this), assets)) revert TransferFailed();
        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets) {
        if (msg.sender != owner) {
            uint256 allowed = allowance[owner][msg.sender];
            if (allowed < shares) revert Allowance();
            if (allowed != type(uint256).max) allowance[owner][msg.sender] = allowed - shares;
        }
        assets = convertToAssets(shares);
        if (assets == 0) revert Zero();
        _burn(owner, shares);
        if (!assetToken.transfer(receiver, assets)) revert TransferFailed();
        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }

    /// @notice Test interest: test dollars added to the vault, shared by every saver.
    function addTestInterest(uint256 assets) external {
        if (!assetToken.transferFrom(msg.sender, address(this), assets)) revert TransferFailed();
        emit TestInterest(msg.sender, assets);
    }

    // ── Shares: ERC-20 with EIP-2612 permits ─────────────────────────────────────────────────────

    function transfer(address to, uint256 value) external returns (bool) {
        _move(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed < value) revert Allowance();
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - value;
        _move(from, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return domainSeparator;
    }

    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
    {
        if (block.timestamp > deadline) revert Expired();
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                domainSeparator,
                keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, nonces[owner]++, deadline))
            )
        );
        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0) || signer != owner) revert BadSignature();
        allowance[owner][spender] = value;
        emit Approval(owner, spender, value);
    }

    function _move(address from, address to, uint256 value) private {
        if (balanceOf[from] < value) revert Balance();
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }

    function _mint(address to, uint256 value) private {
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }

    function _burn(address from, uint256 value) private {
        if (balanceOf[from] < value) revert Balance();
        balanceOf[from] -= value;
        totalSupply -= value;
        emit Transfer(from, address(0), value);
    }
}
