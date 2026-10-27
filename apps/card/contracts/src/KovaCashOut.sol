// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

/// @notice The parts of AUSD (an EIP-3009 dollar) a cash-out needs.
interface IAuthorizedDollar {
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
    ) external;
    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
}

/// @notice The parts of USDC a cash-out needs.
interface IPayoutToken {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
}

/// @title KovaCashOut
/// @notice Cashes a Kova wallet's AUSD out to naira with one signature. A cash-out partner (PAJ)
/// pays naira into a bank account for USDC sent to a one-time address on Monad; this contract turns
/// the wallet's AUSD into exactly that USDC and pays it, in one transaction.
///
/// The wallet signs an EIP-3009 transfer of its AUSD to this contract, and the nonce it signs is
/// `nonceFor(payTo, pay, ref)`: it commits to where the USDC goes and how much. Whoever carries the
/// signature out can only do what the wallet signed. The contract swaps the AUSD for USDC through
/// one router fixed at deployment, pays exactly `pay` to `payTo`, and sends everything else (AUSD the
/// swap didn't use, USDC beyond `pay`) back to the wallet. A swap that returns less than `pay`
/// reverts it all, and the AUSD never leaves the wallet.
///
/// Only Kova's relayer carries cash-outs out, so nobody can lift a signature from the mempool and
/// route its swap through a pool they moved. A signed transfer someone submits to AUSD on its own
/// lands its dollars here with no cash-out; `refund` sends them back.
///
/// The contract holds nothing between calls and has no owner.
contract KovaCashOut {
    IAuthorizedDollar public immutable dollar;
    IPayoutToken public immutable usdc;
    address public immutable router;
    address public immutable relayer;

    /// Cash-outs carried out or refunded, by wallet and the nonce it signed: each happens once.
    mapping(address owner => mapping(bytes32 nonce => bool)) public settled;

    event CashedOut(
        address indexed owner,
        address indexed payTo,
        bytes32 indexed ref,
        uint256 value,
        uint256 paid,
        uint256 dollarsBack,
        uint256 usdcBack
    );
    event Refunded(address indexed owner, bytes32 indexed ref, uint256 value);

    error OnlyRelayer();
    error AlreadySettled();
    error NotReceived();
    error SwapFailed(bytes reason);
    error Shortfall(uint256 got, uint256 needed);
    error TokenRefused();

    constructor(IAuthorizedDollar dollar_, IPayoutToken usdc_, address router_, address relayer_) {
        dollar = dollar_;
        usdc = usdc_;
        router = router_;
        relayer = relayer_;
    }

    modifier onlyRelayer() {
        if (msg.sender != relayer) revert OnlyRelayer();
        _;
    }

    /// @notice The nonce a wallet signs to cash out `pay` USDC to `payTo`, for Kova's cash-out `ref`.
    function nonceFor(address payTo, uint256 pay, bytes32 ref) public pure returns (bytes32) {
        return keccak256(abi.encode(payTo, pay, ref));
    }

    /// @notice A wallet's signed EIP-3009 transfer of `value` AUSD to this contract.
    struct Authorization {
        address owner;
        uint256 value;
        uint256 validAfter;
        uint256 validBefore;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    /// @notice Where the USDC goes, how much, and Kova's cash-out it is for.
    struct Payout {
        address payTo;
        uint256 pay;
        bytes32 ref;
    }

    /// @notice Carries out a wallet's signed cash-out. `swap` is the router call that turns this
    /// contract's AUSD into USDC, built with this contract as its sender and recipient.
    function cashOut(Authorization calldata auth, Payout calldata payout, bytes calldata swap) external onlyRelayer {
        bytes32 nonce = nonceFor(payout.payTo, payout.pay, payout.ref);
        if (settled[auth.owner][nonce]) revert AlreadySettled();
        settled[auth.owner][nonce] = true;

        uint256 dollarsBefore = dollar.balanceOf(address(this));
        dollar.transferWithAuthorization(
            auth.owner, address(this), auth.value, auth.validAfter, auth.validBefore, nonce, auth.v, auth.r, auth.s
        );
        uint256 got = _swap(auth.value, swap);
        if (got < payout.pay) revert Shortfall(got, payout.pay);
        _call(address(usdc), abi.encodeCall(IPayoutToken.transfer, (payout.payTo, payout.pay)));

        // The approval capped the swap at `value`, so this is what it didn't use.
        uint256 dollarsBack = dollar.balanceOf(address(this)) - dollarsBefore;
        if (dollarsBack > 0) {
            _call(address(dollar), abi.encodeCall(IAuthorizedDollar.transfer, (auth.owner, dollarsBack)));
        }
        uint256 usdcBack = got - payout.pay;
        if (usdcBack > 0) _call(address(usdc), abi.encodeCall(IPayoutToken.transfer, (auth.owner, usdcBack)));
        emit CashedOut(auth.owner, payout.payTo, payout.ref, auth.value, payout.pay, dollarsBack, usdcBack);
    }

    /// @notice Sends a wallet's AUSD back when its signed transfer reached this contract without its
    /// cash-out. Only for a transfer the wallet signed with this cash-out's nonce that was carried
    /// out, and only once. The relayer states the `value` the wallet signed.
    function refund(address owner, uint256 value, Payout calldata payout) external onlyRelayer {
        bytes32 nonce = nonceFor(payout.payTo, payout.pay, payout.ref);
        if (settled[owner][nonce]) revert AlreadySettled();
        if (!dollar.authorizationState(owner, nonce)) revert NotReceived();
        settled[owner][nonce] = true;
        _call(address(dollar), abi.encodeCall(IAuthorizedDollar.transfer, (owner, value)));
        emit Refunded(owner, payout.ref, value);
    }

    /// Swaps up to `value` of this contract's AUSD through the router; returns the USDC it got.
    function _swap(uint256 value, bytes calldata swap) private returns (uint256 got) {
        uint256 usdcBefore = usdc.balanceOf(address(this));
        _call(address(dollar), abi.encodeCall(IAuthorizedDollar.approve, (router, value)));
        (bool ok, bytes memory reason) = router.call(swap);
        if (!ok) revert SwapFailed(reason);
        _call(address(dollar), abi.encodeCall(IAuthorizedDollar.approve, (router, 0)));
        got = usdc.balanceOf(address(this)) - usdcBefore;
    }

    /// A token call that must succeed, for tokens that return a bool and tokens that return nothing.
    function _call(address token, bytes memory data) private {
        (bool ok, bytes memory ret) = token.call(data);
        if (!ok || (ret.length > 0 && !abi.decode(ret, (bool)))) revert TokenRefused();
    }
}
