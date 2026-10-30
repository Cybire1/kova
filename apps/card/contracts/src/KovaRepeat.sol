// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

/// @notice The parts of AUSD (an EIP-2612 dollar) repeat payments need.
interface IRepeatDollar {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external;
}

/// @title KovaRepeat
/// @notice Repeat payments for Kova wallets on Monad: rent, school fees, a wage every Friday.
///
/// The payer signs one `Plan`: who gets paid, how much each time, how often, from when, and how
/// many times at most. Each payment can then be collected once it falls due (Kova's keeper does it,
/// paying the gas), never early, never more than the plan's amount, never more often, never more
/// times. A payment that's missed (the wallet was short) is skipped, not doubled up later. The
/// payer can stop a plan at any time, by signature (relayed, no gas) or from their own wallet, and
/// the payee can stop receiving it. Kova never holds anyone's money.
contract KovaRepeat {
    struct Plan {
        address payer;
        address payee;
        uint96 amount;
        uint32 every;
        uint40 next;
        uint32 left;
        bool stopped;
    }

    struct Permit {
        uint256 value;
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    IRepeatDollar public immutable token;
    uint256 public count;
    mapping(uint256 id => Plan) private _plans;
    /// @notice Per-payer counter: each plan or stop signature works once.
    mapping(address payer => uint256) public nonces;

    uint32 public constant MIN_EVERY = 1 hours;

    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant PLAN_TYPEHASH = keccak256(
        "Plan(address payer,address payee,uint96 amount,uint32 every,uint40 start,uint32 times,uint256 nonce,uint256 deadline)"
    );
    bytes32 public constant STOP_TYPEHASH = keccak256("Stop(address payer,uint256 id,uint256 nonce,uint256 deadline)");

    bytes32 private immutable _domainSeparator;
    uint256 private immutable _chainId;

    uint256 private constant HALF_N = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    event PlanStarted(
        uint256 indexed id,
        address indexed payer,
        address indexed payee,
        uint96 amount,
        uint32 every,
        uint40 start,
        uint32 times
    );
    event PlanPaid(uint256 indexed id, address indexed payer, address indexed payee, uint96 amount, uint32 left);
    event PlanStopped(uint256 indexed id, address by);

    error Expired();
    error BadSignature();
    error BadPlan();
    error NotDue();
    error Finished();
    error NotAllowed();
    error TransferFailed();

    constructor(IRepeatDollar token_) {
        token = token_;
        _chainId = block.chainid;
        _domainSeparator = _buildDomainSeparator();
    }

    /// @notice Starts a plan from the payer's signed `Plan`. `permit` lets this contract draw what
    /// the plan can ever take; a permit already used or front-run is skipped (the allowance is what
    /// matters). If the first payment is due now, it's paid in the same transaction when the wallet
    /// can cover it.
    function start(
        address payer,
        address payee,
        uint96 amount,
        uint32 every,
        uint40 startAt,
        uint32 times,
        uint256 deadline,
        bytes calldata signature,
        Permit calldata permit
    ) external returns (uint256 id) {
        if (block.timestamp > deadline) revert Expired();
        if (payee == address(0) || payee == payer || amount == 0 || every < MIN_EVERY || times == 0) revert BadPlan();
        uint256 nonce = nonces[payer]++;
        bytes32 structHash =
            keccak256(abi.encode(PLAN_TYPEHASH, payer, payee, amount, every, startAt, times, nonce, deadline));
        if (_recover(_hashTypedData(structHash), signature) != payer) revert BadSignature();
        if (permit.deadline != 0) {
            try token.permit(payer, address(this), permit.value, permit.deadline, permit.v, permit.r, permit.s) {}
                catch {}
        }
        id = ++count;
        _plans[id] = Plan(payer, payee, amount, every, startAt, times, false);
        emit PlanStarted(id, payer, payee, amount, every, startAt, times);
        // Due now: pay the first one straight away. If the wallet can't cover it yet, the plan still
        // starts, and the keeper collects it once it can.
        if (startAt <= block.timestamp) {
            try this.collect(id) {} catch {}
        }
    }

    /// @notice Pays a plan's due payment. Anyone may call; it only ever pays what the plan says, when it says.
    function collect(uint256 id) external {
        _collect(id);
    }

    /// @notice Stops a plan for good, signed by the payer and relayed by anyone.
    function stop(uint256 id, uint256 deadline, bytes calldata signature) external {
        if (block.timestamp > deadline) revert Expired();
        Plan storage p = _plans[id];
        if (p.payer == address(0)) revert BadPlan();
        uint256 nonce = nonces[p.payer]++;
        bytes32 structHash = keccak256(abi.encode(STOP_TYPEHASH, p.payer, id, nonce, deadline));
        if (_recover(_hashTypedData(structHash), signature) != p.payer) revert BadSignature();
        p.stopped = true;
        emit PlanStopped(id, p.payer);
    }

    /// @notice Stops a plan from the payer's or the payee's own wallet.
    function stopDirect(uint256 id) external {
        Plan storage p = _plans[id];
        if (msg.sender != p.payer && msg.sender != p.payee) revert NotAllowed();
        p.stopped = true;
        emit PlanStopped(id, msg.sender);
    }

    function planOf(uint256 id) external view returns (Plan memory) {
        return _plans[id];
    }

    /// @notice Whether a plan has a payment to collect right now.
    function due(uint256 id) external view returns (bool) {
        Plan memory p = _plans[id];
        return p.payer != address(0) && !p.stopped && p.left > 0 && block.timestamp >= p.next;
    }

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return block.chainid == _chainId ? _domainSeparator : _buildDomainSeparator();
    }

    function _collect(uint256 id) private {
        Plan storage p = _plans[id];
        if (p.payer == address(0)) revert BadPlan();
        if (p.stopped || p.left == 0) revert Finished();
        if (block.timestamp < p.next) revert NotDue();
        // The next one is a whole period after this one's slot; slots missed while the wallet was
        // short are skipped, never collected in a burst.
        uint256 behind = (block.timestamp - p.next) / p.every;
        p.next = uint40(uint256(p.next) + (behind + 1) * p.every);
        p.left -= 1;
        if (!token.transferFrom(p.payer, p.payee, p.amount)) revert TransferFailed();
        emit PlanPaid(id, p.payer, p.payee, p.amount, p.left);
    }

    function _hashTypedData(bytes32 structHash) private view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));
    }

    function _buildDomainSeparator() private view returns (bytes32) {
        return
            keccak256(
                abi.encode(DOMAIN_TYPEHASH, keccak256("Kova Repeat"), keccak256("1"), block.chainid, address(this))
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
