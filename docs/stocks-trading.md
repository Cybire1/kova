# Buying and selling xStocks in Kova

Status: being built (29 Oct 2026), switched off until `KOVA_STOCKS_TRADING=1`.

A Kova wallet swaps its dollars (AUSD) for an xStock on Monad, and back, with one signature each
way. Kova's relayer carries the signature and pays the gas. The stock lands in the wallet's own
address; Kova never holds it. Prices and routes come from KyberSwap, the router Kova's cash-outs
already use (`0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` on Monad). Live check on 29 Oct: $10 of
AUSD bought 0.0248 TSLAx, $100 bought 0.248 TSLAx; TSLAx supports EIP-2612 permit.

## The rules Kova follows (xStocks' issuer and the platforms that offer them)

Backed, the issuer, forbids its products to US citizens, US residents and anyone taxable in the
US (assets.backed.fi/geoblock). Kraken offers xStocks to retail in select countries, not the US,
UK, Canada or Australia (kraken.com/legal/xstocks); EEA clients need a questionnaire; STON.fi
blocks the US, EU/EEA, UK, Canada, Australia and others. Kova takes the strictest reading:

1. **Blocked countries** (by the visitor's IP country; an unknown country is blocked):
   - US and its territories: US, PR, GU, VI, AS, MP, UM
   - GB, CA, AU
   - EU and EEA: AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE,
     IS LI NO, and CH
   - Sanctioned: CU IR KP SY RU BY
2. **Self-certification**, signed by the wallet once (and again if the country changes): the
   exact text in `STOCK_ATTESTATION` below. Kept in the database with the country seen.
3. **Plain warnings** before every buy: risky, complex, you can lose money, not for beginners.
4. **No advice, and say what Kova is**: "Kova doesn't issue, sell or recommend stocks. This swaps
   your dollars for a token on Monad, issued by Backed." No "you should", no rankings, no "top
   picks", no performance claims.
5. **Limits**: at most $1,000 a buy; a quote holds 60 seconds; at most 1% below the quoted amount
   (`min_out` = quote × 0.99).

```text
STOCK_ATTESTATION (signed with personal_sign, the wallet address and date filled in):
Kova stock tokens
I confirm I am not a US citizen, US resident or US taxpayer, and I don't live in a country where xStocks are restricted.
I understand xStocks are tokens issued by Backed, not shares, that their price can fall, and that Kova gives no advice.
Wallet: {address}
Date: {YYYY-MM-DD}
```

## Contract: `KovaStocks` (apps/card/contracts/src/KovaStocks.sol)

`constructor(IAuthorizedDollar dollar, address router, address relayer)`. Immutable, no owner, holds
nothing between calls. Every write is `onlyRelayer`.

- `buyNonce(address stock, uint256 minOut, bytes32 ref) public pure returns (bytes32)` =
  `keccak256(abi.encode(stock, minOut, ref))`. The wallet's EIP-3009 `receiveWithAuthorization`
  (to = KovaStocks) uses this nonce, so the signature commits to which stock and the least it gets.
- `buy(Authorization auth, address stock, uint256 minOut, bytes32 ref, bytes swap)` where
  `Authorization { address owner; uint256 value; uint256 validAfter; uint256 validBefore; uint8 v; bytes32 r; bytes32 s; }`:
  receive `value` AUSD from `owner` with nonce `buyNonce(stock, minOut, ref)`; approve the router
  for exactly `value`; call the router with `swap`; the stock received (balance delta) must be
  `>= minOut`; send all of it to `owner`; send any AUSD left back to `owner`; reset approval to 0.
  Emits `Bought(address indexed owner, address indexed stock, uint256 dollars, uint256 shares, bytes32 ref)`.
- Selling: the wallet signs two things. An EIP-712 order on the KovaStocks domain
  (`name "KovaStocks"`, `version "1"`):
  `Sell(address owner,address stock,uint256 amount,uint256 minOut,uint256 deadline,bytes32 ref)`,
  and an EIP-2612 permit on the stock for KovaStocks, `value = amount`.
  `sell(SellOrder order, bytes orderSig, Permit permit, bytes swap)` where
  `SellOrder { address owner; address stock; uint256 amount; uint256 minOut; uint256 deadline; bytes32 ref; }`
  and `Permit { uint256 deadline; uint8 v; bytes32 r; bytes32 s; }`: check the order signature
  (ECDSA, EIP-712) and deadline, and that `ref` wasn't used (mark it used); `try` the permit
  (a front-run permit still set the allowance); `transferFrom` the owner `amount`; approve the
  router exactly; swap stock→AUSD; AUSD received `>= minOut`; send it all to `owner`; return any
  stock left to `owner`; reset approval. Emits
  `Sold(address indexed owner, address indexed stock, uint256 shares, uint256 dollars, bytes32 ref)`.
- `sellDigest(SellOrder)` view, for the API and tests.

Tests: unit tests with a mock router and mock tokens (only the owner gets the stock; a relayer
can't change stock or minOut; a used ref can't sell twice; shortfall reverts; nothing left in the
contract), and a fork test against Monad mainnet with a live KyberSwap route (like
`KovaCashOutFork.t.sol`): buy $10 of TSLAx and sell it back.

## API (apps/api)

Settings: `KOVA_STOCKS_TRADING=1` switches it on; `KOVA_STOCKS_CONTRACT` is the KovaStocks
address. Off, every route below answers `live: false` and the screens keep "Coming soon".

Country: from the client IP (the web vouches it with `x-kova-client-ip` + `KOVA_PROXY_SECRET`, as
for MoonPay top-ups; the app calls directly) with an offline IP-to-country table.

- `GET /v1/wallets/:address/stocks/access` →
  `{ object: "stock_access", live: boolean, country: string | null, allowed: boolean, reason: string | null, attested: boolean, attestation: string }`
  (`attestation` is the exact text to sign, filled in; `reason` is plain words, e.g. "Stock tokens
  aren't available in the United States.").
- `POST /v1/wallets/:address/stocks/attest` `{ message, signature }` → `{ attested: true }`.
- `POST /v1/wallets/:address/stocks/quote` `{ side: "buy" | "sell", symbol, amount }` (buy: dollars
  in base units, 6 decimals; sell: shares in base units, 18 decimals) →
  `{ object: "stock_quote", id, side, symbol, stock, amount_in, amount_out, min_out, price, expires_at, contract, ref,
     buy?: { nonce, valid_before }, sell?: { deadline } }`.
- `POST /v1/wallets/:address/stocks/buy` `{ quote_id, authorization: { value, valid_after, valid_before, nonce }, signature }`
  → `{ tx_hash, shares }`.
- `POST /v1/wallets/:address/stocks/sell` `{ quote_id, order_signature, permit: { deadline, signature } }` →
  `{ tx_hash, dollars }`.

Every write re-checks access (country, attestation), the quote's age and that a fresh route still
meets `min_out`, then relays with a gas cap, retrying a costly pool as cash-outs do.

## Screens

Web: the stock detail (`/wallet/stocks/[symbol]`) and the iPhone (`apps/mobile/src/app/stocks/buy.tsx`
and the stock detail). Buy and Sell open a sheet: eligibility (blocked country says why, plainly),
the one-time confirmation to sign, the amount ($ for buy, shares or "All" for sell), the live
quote with "at least" and the 60-second timer, the warnings, then Face ID. After: the shares in
your wallet, a link to the transaction. Copy follows rule 4 above.
