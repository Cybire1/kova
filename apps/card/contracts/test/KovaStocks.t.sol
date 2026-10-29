// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test, stdError} from "forge-std/Test.sol";
import {KovaStocks, IAuthorizedDollar} from "../src/KovaStocks.sol";

/// A plain mintable token with an allowance.
contract Token {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

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
        allowance[from][msg.sender] -= value;
        balanceOf[from] -= value;
        balanceOf[to] += value;
        return true;
    }
}

/// A dollar with EIP-3009 receiveWithAuthorization, as AUSD has (same typehash and rules).
contract ReceiveDollar is Token {
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
                keccak256(
                    abi.encode(RECEIVE_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce)
                )
            )
        );
        require(ecrecover(digest, v, r, s) == from, "bad signature");
        authorizationState[from][nonce] = true;
        balanceOf[from] -= value;
        balanceOf[to] += value;
    }
}

/// A stock token with EIP-2612 permit, as xStocks have.
contract PermitStock is Token {
    mapping(address => uint256) public nonces;
    bytes32 public constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
    bytes32 public immutable DOMAIN_SEPARATOR = keccak256(
        abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("Tesla xStock"),
            keccak256("1"),
            block.chainid,
            address(this)
        )
    );

    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
    {
        require(block.timestamp <= deadline, "permit expired");
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR,
                keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, nonces[owner]++, deadline))
            )
        );
        require(ecrecover(digest, v, r, s) == owner, "bad permit");
        allowance[owner][spender] = value;
    }
}

/// A swap router: takes `amountIn` of `tokenIn` from its caller and mints `amountOut` of `tokenOut`
/// to `to`.
contract SwapRouter {
    function swap(Token tokenIn, uint256 amountIn, Token tokenOut, uint256 amountOut, address to) external {
        require(tokenIn.transferFrom(msg.sender, address(this), amountIn));
        tokenOut.mint(to, amountOut);
    }
}

contract KovaStocksTest is Test {
    ReceiveDollar dollar;
    PermitStock tsla;
    PermitStock nvda;
    SwapRouter router;
    KovaStocks stocks;
    uint256 adaKey = 0xA11CE;
    address ada;
    address relayer = address(0xBEEF);
    bytes32 ref = bytes32(uint256(0x0190f3a2b4c5d6e7f8091a2b3c4d5e6f));
    uint256 validBefore;
    uint256 deadline;

    uint256 constant N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    function setUp() public {
        vm.warp(1_800_000_000);
        validBefore = block.timestamp + 60;
        deadline = block.timestamp + 60;
        dollar = new ReceiveDollar();
        tsla = new PermitStock();
        nvda = new PermitStock();
        router = new SwapRouter();
        stocks = new KovaStocks(IAuthorizedDollar(address(dollar)), address(router), relayer);
        ada = vm.addr(adaKey);
        dollar.mint(ada, 100e6);
    }

    // ---- Buying ----

    /// Ada signs a receive of `value` by the contract, its nonce naming `stock` and `minOut`.
    function signBuy(uint256 value, address stock, uint256 minOut) internal view returns (uint8, bytes32, bytes32) {
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                dollar.DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        dollar.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(),
                        ada,
                        address(stocks),
                        value,
                        0,
                        validBefore,
                        stocks.buyNonce(stock, minOut, ref)
                    )
                )
            )
        );
        return vm.sign(adaKey, digest);
    }

    function auth(uint256 value, uint8 v, bytes32 r, bytes32 s)
        internal
        view
        returns (KovaStocks.Authorization memory)
    {
        return KovaStocks.Authorization(ada, value, 0, validBefore, v, r, s);
    }

    function buying(uint256 dollarsIn, Token stock, uint256 sharesOut) internal view returns (bytes memory) {
        return abi.encodeCall(SwapRouter.swap, (dollar, dollarsIn, stock, sharesOut, address(stocks)));
    }

    function assertHoldsNothing() internal view {
        assertEq(dollar.balanceOf(address(stocks)), 0, "no dollars left in the contract");
        assertEq(tsla.balanceOf(address(stocks)), 0, "no shares left in the contract");
        assertEq(dollar.allowance(address(stocks), address(router)), 0, "no dollar approval left");
        assertEq(tsla.allowance(address(stocks), address(router)), 0, "no stock approval left");
    }

    function test_buySendsEveryShareToTheOwnerAndTheUnusedDollarsBack() public {
        (uint8 v, bytes32 r, bytes32 s) = signBuy(10e6, address(tsla), 0.0245e18);
        // The swap uses 9.99 of the 10 dollars and returns 0.0248 shares.
        vm.expectEmit(address(stocks));
        emit KovaStocks.Bought(ada, address(tsla), 9.99e6, 0.0248e18, ref);
        vm.prank(relayer);
        uint256 shares = stocks.buy(auth(10e6, v, r, s), address(tsla), 0.0245e18, ref, buying(9.99e6, tsla, 0.0248e18));

        assertEq(shares, 0.0248e18);
        assertEq(tsla.balanceOf(ada), 0.0248e18, "every share the swap returned is Ada's");
        assertEq(dollar.balanceOf(ada), 90.01e6, "the dollars the swap didn't use came home");
        assertHoldsNothing();
    }

    function test_aBuySignatureWorksOnce() public {
        (uint8 v, bytes32 r, bytes32 s) = signBuy(10e6, address(tsla), 0.0245e18);
        vm.prank(relayer);
        stocks.buy(auth(10e6, v, r, s), address(tsla), 0.0245e18, ref, buying(10e6, tsla, 0.0248e18));

        vm.prank(relayer);
        vm.expectRevert(bytes("used"));
        stocks.buy(auth(10e6, v, r, s), address(tsla), 0.0245e18, ref, buying(10e6, tsla, 0.0248e18));
        assertEq(dollar.balanceOf(ada), 90e6);
        assertEq(tsla.balanceOf(ada), 0.0248e18);
    }

    function test_theRelayerCantChangeTheStockTheFloorOrTheAmount() public {
        (uint8 v, bytes32 r, bytes32 s) = signBuy(10e6, address(tsla), 0.0245e18);

        vm.startPrank(relayer);
        vm.expectRevert(bytes("bad signature"));
        stocks.buy(auth(10e6, v, r, s), address(nvda), 0.0245e18, ref, buying(10e6, nvda, 1e18));

        vm.expectRevert(bytes("bad signature"));
        stocks.buy(auth(10e6, v, r, s), address(tsla), 0, ref, buying(10e6, tsla, 1));

        vm.expectRevert(bytes("bad signature"));
        stocks.buy(auth(20e6, v, r, s), address(tsla), 0.0245e18, ref, buying(20e6, tsla, 0.05e18));
        vm.stopPrank();

        assertEq(dollar.balanceOf(ada), 100e6);
    }

    function test_aBuyThatComesUpShortMovesNothing() public {
        (uint8 v, bytes32 r, bytes32 s) = signBuy(10e6, address(tsla), 0.0245e18);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(KovaStocks.Shortfall.selector, 0.0244e18, 0.0245e18));
        stocks.buy(auth(10e6, v, r, s), address(tsla), 0.0245e18, ref, buying(10e6, tsla, 0.0244e18));

        assertEq(dollar.balanceOf(ada), 100e6);
        assertFalse(dollar.authorizationState(ada, stocks.buyNonce(address(tsla), 0.0245e18, ref)));
    }

    function test_sharesSentElsewhereDontCount() public {
        (uint8 v, bytes32 r, bytes32 s) = signBuy(10e6, address(tsla), 0.0245e18);
        bytes memory toThief = abi.encodeCall(SwapRouter.swap, (dollar, 10e6, tsla, 0.0248e18, address(0xBAD)));
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(KovaStocks.Shortfall.selector, 0, 0.0245e18));
        stocks.buy(auth(10e6, v, r, s), address(tsla), 0.0245e18, ref, toThief);
        assertEq(dollar.balanceOf(ada), 100e6);
    }

    function test_theRouterCantTakeMoreDollarsThanWereSigned() public {
        (uint8 v, bytes32 r, bytes32 s) = signBuy(10e6, address(tsla), 0.0245e18);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(KovaStocks.SwapFailed.selector, stdError.arithmeticError));
        stocks.buy(auth(10e6, v, r, s), address(tsla), 0.0245e18, ref, buying(10e6 + 1, tsla, 1e18));
        assertEq(dollar.balanceOf(ada), 100e6);
    }

    function test_buyingTheDollarItselfIsRefused() public {
        (uint8 v, bytes32 r, bytes32 s) = signBuy(10e6, address(dollar), 0);
        vm.prank(relayer);
        vm.expectRevert(KovaStocks.BadStock.selector);
        stocks.buy(auth(10e6, v, r, s), address(dollar), 0, ref, "");
    }

    function test_onlyTheRelayerBuys() public {
        (uint8 v, bytes32 r, bytes32 s) = signBuy(10e6, address(tsla), 0.0245e18);
        vm.expectRevert(KovaStocks.OnlyRelayer.selector);
        stocks.buy(auth(10e6, v, r, s), address(tsla), 0.0245e18, ref, buying(10e6, tsla, 0.0248e18));
    }

    // ---- Selling ----

    function order(uint256 amount, uint256 minOut) internal view returns (KovaStocks.SellOrder memory) {
        return KovaStocks.SellOrder(ada, address(tsla), amount, minOut, deadline, ref);
    }

    function signOrder(uint256 key, KovaStocks.SellOrder memory o) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, stocks.sellDigest(o));
        return abi.encodePacked(r, s, v);
    }

    function signPermit(uint256 amount) internal view returns (KovaStocks.Permit memory) {
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                tsla.DOMAIN_SEPARATOR(),
                keccak256(abi.encode(tsla.PERMIT_TYPEHASH(), ada, address(stocks), amount, tsla.nonces(ada), deadline))
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(adaKey, digest);
        return KovaStocks.Permit(deadline, v, r, s);
    }

    function selling(uint256 sharesIn, uint256 dollarsOut) internal view returns (bytes memory) {
        return abi.encodeCall(SwapRouter.swap, (tsla, sharesIn, dollar, dollarsOut, address(stocks)));
    }

    function sell(KovaStocks.SellOrder memory o, bytes memory sig, KovaStocks.Permit memory p, bytes memory swap)
        internal
        returns (uint256)
    {
        vm.prank(relayer);
        return stocks.sell(o, sig, p, swap);
    }

    function test_theSellDigestIsTheEip712OneTheWalletSigns() public view {
        KovaStocks.SellOrder memory o = order(0.0248e18, 9.8e6);
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("KovaStocks"),
                keccak256("1"),
                block.chainid,
                address(stocks)
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "Sell(address owner,address stock,uint256 amount,uint256 minOut,uint256 deadline,bytes32 ref)"
                ),
                o.owner,
                o.stock,
                o.amount,
                o.minOut,
                o.deadline,
                o.ref
            )
        );
        assertEq(stocks.DOMAIN_SEPARATOR(), domain);
        assertEq(stocks.sellDigest(o), keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
    }

    function test_sellSendsTheDollarsAndUnusedSharesToTheOwner() public {
        tsla.mint(ada, 0.0248e18);
        KovaStocks.SellOrder memory o = order(0.0248e18, 9.8e6);
        // The swap uses all but 0.0001 of the shares and returns 9.85 dollars.
        vm.expectEmit(address(stocks));
        emit KovaStocks.Sold(ada, address(tsla), 0.0247e18, 9.85e6, ref);
        uint256 dollars = sell(o, signOrder(adaKey, o), signPermit(0.0248e18), selling(0.0247e18, 9.85e6));

        assertEq(dollars, 9.85e6);
        assertEq(dollar.balanceOf(ada), 109.85e6, "every dollar the swap returned is Ada's");
        assertEq(tsla.balanceOf(ada), 0.0001e18, "the shares the swap didn't use came home");
        assertEq(tsla.allowance(ada, address(stocks)), 0, "the permit was used up exactly");
        assertTrue(stocks.used(ada, ref));
        assertHoldsNothing();
    }

    function test_aSellWithTheWrongSignatureIsRefused() public {
        tsla.mint(ada, 0.0248e18);
        KovaStocks.SellOrder memory o = order(0.0248e18, 9.8e6);
        KovaStocks.Permit memory p = signPermit(0.0248e18);
        bytes memory swap = selling(0.0248e18, 9.85e6);

        // Someone else signed it.
        bytes memory bobs = signOrder(0xB0B, o);
        vm.expectRevert(KovaStocks.BadSignature.selector);
        sell(o, bobs, p, swap);

        // The relayer lowered the floor Ada signed.
        bytes memory sig = signOrder(adaKey, o);
        KovaStocks.SellOrder memory lowered = order(0.0248e18, 1);
        vm.expectRevert(KovaStocks.BadSignature.selector);
        sell(lowered, sig, p, swap);

        // Not 65 bytes, a bad v, the malleable twin (n - s, flipped v), and garbage that recovers no one.
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(adaKey, stocks.sellDigest(o));
        vm.expectRevert(KovaStocks.BadSignature.selector);
        sell(o, abi.encodePacked(r, s), p, swap);
        vm.expectRevert(KovaStocks.BadSignature.selector);
        sell(o, abi.encodePacked(r, s, v - 27), p, swap);
        vm.expectRevert(KovaStocks.BadSignature.selector);
        sell(o, abi.encodePacked(r, bytes32(N - uint256(s)), v == 27 ? uint8(28) : uint8(27)), p, swap);
        vm.expectRevert(KovaStocks.BadSignature.selector);
        sell(o, abi.encodePacked(bytes32(0), bytes32(uint256(1)), uint8(27)), p, swap);

        assertEq(tsla.balanceOf(ada), 0.0248e18);
        assertFalse(stocks.used(ada, ref));
    }

    function test_aRefSellsOnce() public {
        tsla.mint(ada, 0.05e18);
        KovaStocks.SellOrder memory o = order(0.0248e18, 9.8e6);
        bytes memory sig = signOrder(adaKey, o);
        sell(o, sig, signPermit(0.0248e18), selling(0.0248e18, 9.85e6));

        KovaStocks.Permit memory again = signPermit(0.0248e18);
        vm.expectRevert(KovaStocks.AlreadyUsed.selector);
        sell(o, sig, again, selling(0.0248e18, 9.85e6));
        assertEq(tsla.balanceOf(ada), 0.0252e18);
    }

    function test_anExpiredOrderIsRefused() public {
        tsla.mint(ada, 0.0248e18);
        KovaStocks.SellOrder memory o = order(0.0248e18, 9.8e6);
        bytes memory sig = signOrder(adaKey, o);
        KovaStocks.Permit memory p = signPermit(0.0248e18);
        vm.warp(deadline + 1);
        vm.expectRevert(KovaStocks.Expired.selector);
        sell(o, sig, p, selling(0.0248e18, 9.85e6));
        assertEq(tsla.balanceOf(ada), 0.0248e18);
    }

    function test_aFrontRunPermitStillSells() public {
        tsla.mint(ada, 0.0248e18);
        KovaStocks.SellOrder memory o = order(0.0248e18, 9.8e6);
        KovaStocks.Permit memory p = signPermit(0.0248e18);
        // Someone lifts the permit from the mempool and submits it first.
        tsla.permit(ada, address(stocks), 0.0248e18, p.deadline, p.v, p.r, p.s);

        sell(o, signOrder(adaKey, o), p, selling(0.0248e18, 9.85e6));
        assertEq(dollar.balanceOf(ada), 109.85e6);
        assertEq(tsla.balanceOf(ada), 0);
        assertHoldsNothing();
    }

    function test_aSellThatComesUpShortMovesNothing() public {
        tsla.mint(ada, 0.0248e18);
        KovaStocks.SellOrder memory o = order(0.0248e18, 9.8e6);
        bytes memory sig = signOrder(adaKey, o);
        KovaStocks.Permit memory p = signPermit(0.0248e18);
        bytes memory swap = selling(0.0248e18, 9.7e6);
        vm.expectRevert(abi.encodeWithSelector(KovaStocks.Shortfall.selector, 9.7e6, 9.8e6));
        sell(o, sig, p, swap);
        assertEq(tsla.balanceOf(ada), 0.0248e18);
        assertFalse(stocks.used(ada, ref));
    }

    function test_onlyTheRelayerSells() public {
        tsla.mint(ada, 0.0248e18);
        KovaStocks.SellOrder memory o = order(0.0248e18, 9.8e6);
        bytes memory sig = signOrder(adaKey, o);
        KovaStocks.Permit memory p = signPermit(0.0248e18);
        vm.expectRevert(KovaStocks.OnlyRelayer.selector);
        stocks.sell(o, sig, p, selling(0.0248e18, 9.85e6));
    }
}
