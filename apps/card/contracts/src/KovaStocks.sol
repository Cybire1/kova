// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

/// @notice The parts of AUSD (an EIP-3009 dollar) buying and selling stock tokens needs.
interface IAuthorizedDollar {
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
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
}

/// @notice The parts of a stock token (an xStock, with EIP-2612 permit) buying and selling needs.
interface IStockToken {
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external;
}

/// @title KovaStocks
/// @notice Swaps a Kova wallet's dollars (AUSD) for a stock token on Monad, and back, with one
/// signature each way, so nobody needs MON: Kova's relayer carries each signature out and pays
/// the gas. The stock lands in the wallet's own address; the contract never keeps any of it.
///
/// Buying: the wallet signs an EIP-3009 receiveWithAuthorization of its AUSD to this contract, and
/// the nonce it signs is `buyNonce(stock, minOut, ref)`: it commits to which stock and the least
/// it gets. Only this contract can carry that out (EIP-3009 requires the caller to be the payee).
/// The contract swaps the AUSD through one router fixed at deployment, sends every share the swap
/// returned to the wallet, and sends back any AUSD the swap didn't use. Fewer shares than `minOut`
/// reverts it all, and the AUSD never leaves the wallet.
///
/// Selling: the wallet signs an EIP-712 Sell order (which stock, how many, the least AUSD back, a
/// deadline and Kova's ref) and an EIP-2612 permit on the stock for this contract. The contract
/// checks the order, takes exactly `amount`, swaps it, and sends all the AUSD and any stock the
/// swap didn't use back to the wallet. Each ref sells once.
///
/// Only Kova's relayer carries trades out, so nobody can lift a signature from the mempool and
/// route its swap through a pool they moved. The router is approved for exactly what a trade
/// spends and the approval goes back to zero after it.
///
/// The contract holds nothing between calls and has no owner.
contract KovaStocks {
    IAuthorizedDollar public immutable dollar;
    address public immutable router;
    address public immutable relayer;

    bytes32 public constant SELL_TYPEHASH =
        keccak256("Sell(address owner,address stock,uint256 amount,uint256 minOut,uint256 deadline,bytes32 ref)");
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant NAME_HASH = keccak256("KovaStocks");
    bytes32 private constant VERSION_HASH = keccak256("1");
    /// The largest `s` a signature may carry (half the curve order), so each signature has one form.
    uint256 private constant HALF_ORDER = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    uint256 private immutable deployedChainId;
    bytes32 private immutable deployedDomainSeparator;

    /// Sell orders carried out, by wallet and Kova's ref: each sells once.
    mapping(address owner => mapping(bytes32 ref => bool)) public used;

    event Bought(address indexed owner, address indexed stock, uint256 dollars, uint256 shares, bytes32 ref);
    event Sold(address indexed owner, address indexed stock, uint256 shares, uint256 dollars, bytes32 ref);

    error OnlyRelayer();
    error BadStock();
    error BadSignature();
    error Expired();
    error AlreadyUsed();
    error SwapFailed(bytes reason);
    error Shortfall(uint256 got, uint256 needed);
    error TokenRefused();

    constructor(IAuthorizedDollar dollar_, address router_, address relayer_) {
        dollar = dollar_;
        router = router_;
        relayer = relayer_;
        deployedChainId = block.chainid;
        deployedDomainSeparator = _domainSeparator();
    }

    modifier onlyRelayer() {
        if (msg.sender != relayer) revert OnlyRelayer();
        _;
    }

    /// @notice A wallet's signed EIP-3009 receiveWithAuthorization of `value` AUSD to this contract.
    struct Authorization {
        address owner;
        uint256 value;
        uint256 validAfter;
        uint256 validBefore;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    /// @notice A wallet's signed order to sell `amount` of `stock` for at least `minOut` AUSD.
    struct SellOrder {
        address owner;
        address stock;
        uint256 amount;
        uint256 minOut;
        uint256 deadline;
        bytes32 ref;
    }

    /// @notice A wallet's EIP-2612 permit on the stock for this contract, for the order's `amount`.
    struct Permit {
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    /// @notice The nonce a wallet signs to buy at least `minOut` of `stock`, for Kova's quote `ref`.
    function buyNonce(address stock, uint256 minOut, bytes32 ref) public pure returns (bytes32) {
        return keccak256(abi.encode(stock, minOut, ref));
    }

    /// @notice The EIP-712 domain separator: name "KovaStocks", version "1", this chain, this contract.
    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return block.chainid == deployedChainId ? deployedDomainSeparator : _domainSeparator();
    }

    /// @notice The EIP-712 digest a wallet signs for a sell order.
    function sellDigest(SellOrder calldata order) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(SELL_TYPEHASH, order.owner, order.stock, order.amount, order.minOut, order.deadline, order.ref)
        );
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));
    }

    /// @notice Buys a stock with a wallet's signed AUSD. `swap` is the router call that turns this
    /// contract's AUSD into the stock, built with this contract as its sender and recipient.
    function buy(Authorization calldata auth, address stock, uint256 minOut, bytes32 ref, bytes calldata swap)
        external
        onlyRelayer
        returns (uint256 shares)
    {
        if (stock == address(dollar)) revert BadStock();
        uint256 dollarsBefore = dollar.balanceOf(address(this));
        // The nonce names the stock and the least it gets, so these can't differ from what was signed.
        _receive(auth, buyNonce(stock, minOut, ref));

        uint256 sharesBefore = IStockToken(stock).balanceOf(address(this));
        _swap(address(dollar), auth.value, swap);
        shares = IStockToken(stock).balanceOf(address(this)) - sharesBefore;
        if (shares < minOut) revert Shortfall(shares, minOut);
        _call(stock, abi.encodeCall(IStockToken.transfer, (auth.owner, shares)));

        // The approval capped the swap at `value`, so this is what it didn't use.
        uint256 dollarsBack = dollar.balanceOf(address(this)) - dollarsBefore;
        if (dollarsBack > 0) {
            _call(address(dollar), abi.encodeCall(IAuthorizedDollar.transfer, (auth.owner, dollarsBack)));
        }
        uint256 spent = auth.value > dollarsBack ? auth.value - dollarsBack : 0;
        emit Bought(auth.owner, stock, spent, shares, ref);
    }

    /// @notice Sells a wallet's stock for AUSD, as its signed order says. `swap` is the router call
    /// that turns this contract's stock into AUSD, built with this contract as its sender and
    /// recipient.
    function sell(SellOrder calldata order, bytes calldata orderSig, Permit calldata permit, bytes calldata swap)
        external
        onlyRelayer
        returns (uint256 dollars)
    {
        if (order.stock == address(dollar)) revert BadStock();
        if (block.timestamp > order.deadline) revert Expired();
        if (used[order.owner][order.ref]) revert AlreadyUsed();
        if (_recover(sellDigest(order), orderSig) != order.owner) revert BadSignature();
        used[order.owner][order.ref] = true;

        // A permit someone already used (by front-running this call) has still set the allowance.
        try IStockToken(order.stock)
            .permit(order.owner, address(this), order.amount, permit.deadline, permit.v, permit.r, permit.s) {}
            catch {}
        dollars = _sellShares(order, swap);
    }

    /// Takes the order's shares from the owner, swaps them, and sends the owner all the AUSD and
    /// any shares the swap didn't use.
    function _sellShares(SellOrder calldata order, bytes calldata swap) private returns (uint256 dollars) {
        IStockToken stock = IStockToken(order.stock);
        uint256 sharesBefore = stock.balanceOf(address(this));
        _call(order.stock, abi.encodeCall(IStockToken.transferFrom, (order.owner, address(this), order.amount)));

        uint256 dollarsBefore = dollar.balanceOf(address(this));
        _swap(order.stock, order.amount, swap);
        dollars = dollar.balanceOf(address(this)) - dollarsBefore;
        if (dollars < order.minOut) revert Shortfall(dollars, order.minOut);
        _call(address(dollar), abi.encodeCall(IAuthorizedDollar.transfer, (order.owner, dollars)));

        // The approval capped the swap at `amount`, so this is what it didn't use.
        uint256 sharesBack = stock.balanceOf(address(this)) - sharesBefore;
        if (sharesBack > 0) _call(order.stock, abi.encodeCall(IStockToken.transfer, (order.owner, sharesBack)));
        uint256 sold = order.amount > sharesBack ? order.amount - sharesBack : 0;
        emit Sold(order.owner, order.stock, sold, dollars, order.ref);
    }

    /// Takes the wallet's signed AUSD. Only this contract can: EIP-3009 requires the payee to call.
    function _receive(Authorization calldata auth, bytes32 nonce) private {
        dollar.receiveWithAuthorization(
            auth.owner, address(this), auth.value, auth.validAfter, auth.validBefore, nonce, auth.v, auth.r, auth.s
        );
    }

    /// Swaps up to `amount` of this contract's `tokenIn` through the router, then takes the
    /// router's approval back.
    function _swap(address tokenIn, uint256 amount, bytes calldata swap) private {
        _call(tokenIn, abi.encodeCall(IStockToken.approve, (router, amount)));
        (bool ok, bytes memory reason) = router.call(swap);
        if (!ok) revert SwapFailed(reason);
        _call(tokenIn, abi.encodeCall(IStockToken.approve, (router, 0)));
    }

    /// The signer of `digest`: a 65-byte (r, s, v) signature with `s` in the lower half and v 27
    /// or 28, so a signature has exactly one valid form. Never the zero address.
    function _recover(bytes32 digest, bytes calldata sig) private pure returns (address signer) {
        if (sig.length != 65) revert BadSignature();
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        if (uint256(s) > HALF_ORDER || (v != 27 && v != 28)) revert BadSignature();
        signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert BadSignature();
    }

    function _domainSeparator() private view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    /// A token call that must succeed, for tokens that return a bool and tokens that return nothing.
    function _call(address token, bytes memory data) private {
        (bool ok, bytes memory ret) = token.call(data);
        if (!ok || (ret.length > 0 && !abi.decode(ret, (bool)))) revert TokenRefused();
    }
}
