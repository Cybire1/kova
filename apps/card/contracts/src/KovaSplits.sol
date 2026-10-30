// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

/// @notice The parts of AUSD (an EIP-3009 dollar) a split needs.
interface ISplitDollar {
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
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address owner) external view returns (uint256);
}

/// @title KovaSplitter
/// @notice One shop's splits: every dollar that reaches this address is shared out by the shop's
/// rules (up to five shares, in basis points) and the rest goes to the shop's own wallet.
///
/// A shop with splits takes payments at its splitter instead of its wallet. Kova's relayer submits
/// the customer's signed transfer through `collect`, so the payment and the split happen in one
/// transaction on Monad; dollars that arrive any other way are shared out by `release`, which
/// anyone may call. Either way they can only go where the shop's rules say. The rules change only
/// with the shop's signature (through KovaSplits) or from the shop's own wallet.
contract KovaSplitter {
    uint256 public constant MAX_SHARES = 5;
    uint256 private constant WHOLE = 10_000;

    ISplitDollar public immutable token;
    address public immutable factory;

    address public owner;
    address[] private _to;
    uint16[] private _bps;

    event Configured(address indexed owner, address[] to, uint16[] bps);
    event Released(uint256 amount, uint256 kept);
    event SharePaid(address indexed to, uint256 amount);

    error NotAllowed();
    error AlreadySetUp();
    error BadRules();
    error TransferFailed();

    constructor(ISplitDollar token_, address factory_) {
        token = token_;
        factory = factory_;
        // The implementation itself is never anyone's splitter.
        owner = address(0xdead);
    }

    /// @notice Sets the shop this splitter pays. Once, by KovaSplits, as it creates the clone.
    function initialize(address owner_) external {
        if (msg.sender != factory) revert NotAllowed();
        if (owner != address(0)) revert AlreadySetUp();
        owner = owner_;
    }

    /// @notice Replaces the shares. What's already here is shared out by the old rules first.
    function configure(address[] calldata to, uint16[] calldata bps) external {
        if (msg.sender != factory && msg.sender != owner) revert NotAllowed();
        if (to.length != bps.length || to.length > MAX_SHARES) revert BadRules();
        uint256 total;
        for (uint256 i; i < to.length; i++) {
            if (to[i] == address(0) || to[i] == owner || to[i] == address(this) || bps[i] == 0) revert BadRules();
            total += bps[i];
        }
        if (total > WHOLE) revert BadRules();
        release();
        _to = to;
        _bps = bps;
        emit Configured(owner, to, bps);
    }

    /// @notice A customer's payment, split as it lands: submits their signed transfer to this
    /// address (it can only be for this splitter, since the signature names it), then shares it out.
    function collect(
        address from,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        token.transferWithAuthorization(from, address(this), value, validAfter, validBefore, nonce, v, r, s);
        release();
    }

    /// @notice Shares out everything here, by the rules; the rest goes to the shop.
    function release() public {
        uint256 amount = token.balanceOf(address(this));
        if (amount == 0) return;
        uint256 sent;
        for (uint256 i; i < _to.length; i++) {
            uint256 share = (amount * _bps[i]) / WHOLE;
            if (share == 0) continue;
            sent += share;
            if (!token.transfer(_to[i], share)) revert TransferFailed();
            emit SharePaid(_to[i], share);
        }
        if (amount > sent && !token.transfer(owner, amount - sent)) revert TransferFailed();
        emit Released(amount, amount - sent);
    }

    /// @notice The shop, and who gets what (basis points: 1000 is 10%).
    function rules() external view returns (address shop, address[] memory to, uint16[] memory bps) {
        return (owner, _to, _bps);
    }
}

/// @title KovaSplits
/// @notice Makes each shop's KovaSplitter (a minimal clone at an address fixed by the shop's
/// wallet, known before it exists) and sets its rules from the shop's signature, so a shop with
/// no MON can set up splits: Kova's relayer submits the signed rules and pays the gas.
contract KovaSplits {
    address public immutable implementation;
    ISplitDollar public immutable token;

    /// @notice Per-shop counter: each rules signature works once.
    mapping(address owner => uint256) public nonces;

    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant RULES_TYPEHASH =
        keccak256("Rules(address owner,address[] to,uint16[] bps,uint256 nonce,uint256 deadline)");

    bytes32 private immutable _domainSeparator;
    uint256 private immutable _chainId;

    uint256 private constant HALF_N = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    event SplitterCreated(address indexed owner, address splitter);
    event RulesSet(address indexed owner, address indexed splitter, address[] to, uint16[] bps);

    error Expired();
    error BadSignature();

    constructor(ISplitDollar token_) {
        token = token_;
        implementation = address(new KovaSplitter(token_, address(this)));
        _chainId = block.chainid;
        _domainSeparator = _buildDomainSeparator();
    }

    /// @notice Where a shop's payments go once it has splits, whether or not the splitter exists yet.
    function splitterOf(address owner) public view returns (address) {
        bytes32 hash = keccak256(
            abi.encodePacked(bytes1(0xff), address(this), bytes32(uint256(uint160(owner))), keccak256(_cloneCode()))
        );
        return address(uint160(uint256(hash)));
    }

    /// @notice Sets a shop's shares from its signed `Rules`, making its splitter if it's the first time.
    function setRules(
        address owner,
        address[] calldata to,
        uint16[] calldata bps,
        uint256 deadline,
        bytes calldata signature
    ) external returns (address splitter) {
        if (block.timestamp > deadline) revert Expired();
        uint256 nonce = nonces[owner]++;
        bytes32 structHash = keccak256(
            abi.encode(
                RULES_TYPEHASH,
                owner,
                keccak256(abi.encodePacked(to)),
                keccak256(abi.encodePacked(bps)),
                nonce,
                deadline
            )
        );
        if (_recover(_hashTypedData(structHash), signature) != owner) revert BadSignature();
        splitter = _ensure(owner);
        KovaSplitter(splitter).configure(to, bps);
        emit RulesSet(owner, splitter, to, bps);
    }

    /// @notice The same, called by the shop's own wallet.
    function setRulesDirect(address[] calldata to, uint16[] calldata bps) external returns (address splitter) {
        splitter = _ensure(msg.sender);
        KovaSplitter(splitter).configure(to, bps);
        emit RulesSet(msg.sender, splitter, to, bps);
    }

    /// @notice Makes a shop's splitter (anyone may; it can only ever pay that shop and its shares).
    function create(address owner) external returns (address) {
        return _ensure(owner);
    }

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return block.chainid == _chainId ? _domainSeparator : _buildDomainSeparator();
    }

    function _ensure(address owner) private returns (address splitter) {
        splitter = splitterOf(owner);
        if (splitter.code.length > 0) return splitter;
        bytes memory code = _cloneCode();
        bytes32 salt = bytes32(uint256(uint160(owner)));
        assembly {
            splitter := create2(0, add(code, 0x20), mload(code), salt)
        }
        require(splitter != address(0), "create2");
        KovaSplitter(splitter).initialize(owner);
        emit SplitterCreated(owner, splitter);
    }

    /// @dev EIP-1167 minimal proxy pointing at the implementation.
    function _cloneCode() private view returns (bytes memory) {
        return abi.encodePacked(
            hex"3d602d80600a3d3981f3363d3d373d3d3d363d73", implementation, hex"5af43d82803e903d91602b57fd5bf3"
        );
    }

    function _hashTypedData(bytes32 structHash) private view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));
    }

    function _buildDomainSeparator() private view returns (bytes32) {
        return
            keccak256(
                abi.encode(DOMAIN_TYPEHASH, keccak256("Kova Splits"), keccak256("1"), block.chainid, address(this))
            );
    }

    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address) {
        if (signature.length != 65) return address(0);
        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        uint8 v = uint8(signature[64]);
        if (v < 27) v += 27;
        if (uint256(s) > HALF_N || (v != 27 && v != 28)) return address(0);
        return ecrecover(digest, v, r, s);
    }
}
