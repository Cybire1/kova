# Crypto deposits into Kova

Implemented and activated 18 October 2026 for the web wallet and iOS build 14. **The Relay key is configured on the mainnet API; authenticated quotes and tracking are verified. A funded settlement check remains.**

Users open **Add money → Deposit crypto**, choose a network/token, enter the amount, preview the conversion, and copy or scan the deposit address. Monad/MON is the default. Relay converts the deposit into AUSD on Monad and delivers it directly to the Kova wallet. Kova never credits a balance from a quote: the normal on-chain AUSD balance remains authoritative.

A MON transfer to the ordinary Kova wallet address remains MON. Both clients read the native balance directly from Monad and show a separate MON card beneath **Available to spend**. **Convert to dollars** opens an amount and fee preview, reserves MON for gas, and requires explicit confirmation before the user's own wallet sends MON to a validated Relay deposit address. Relay delivers AUSD back to that same wallet. The receive screen points external crypto deposits to the automatic conversion flow.

Conversion quotes expire after two minutes. Before sending, the client checks the wallet, native token, chain, exact input, refund address, balance and displayed gas limit. Local passkey accounts sign a native transaction; Google wallets use a separately scoped provider transaction path, with account and chain checks. Ordinary AUSD payments continue through the relayer. Quote previews never sign or move funds.

The client saves conversion recovery details per wallet before broadcasting, then saves the source transaction hash. Progress survives navigation and reloads, even after the MON leaves. Tracking matches the exact source hash, rather than a previous successful transfer at a reusable address. Definite pre-broadcast failures permit a fresh preview; an uncertain broadcast stays visible and cannot be sent again from the conversion form. Success requires Relay's actual AUSD result, and the spendable balance is still read on-chain. A funded conversion has not yet been exercised by this release's automated checks.

## Routes and asset checks

The catalogue reads Relay's live `/chains` endpoint, caches it for 60 seconds, and offers every enabled network with deposit-address support (53 on 28 Oct 2026). Monad, Base, Ethereum, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche, Solana, Tron, Bitcoin and Arc come first; the rest follow A to Z. Inputs must appear in that network's `solverCurrencies` and be either on Kova's token allowlist (dollar coins, ETH, WETH and the majors) or the EVM network's own coin. When a network lists one coin twice (Arc's USDC is its own coin and an ERC-20 view of the same balance), Kova offers the network's own. Supported source tokens vary by network; the UI never advertises a token on every EVM chain.

Every quote pins destination chain **143** and the AUSD contract **`0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a`**, validates recipient, origin chain/token/decimals/amount, destination token/decimals, deposit address, request ID and minimum output before returning instructions. Amounts use integer base units. Inputs cannot change the destination or Kova's fee. Slippage is capped at 50 basis points. Kova adds no application fee.

Open deposit addresses can be reused **only for the displayed token/network route**. Each deposit can create a different Relay request ID. Prices and fees update at deposit time; expected AUSD and minimum AUSD in the preview describe the current quote, not a future guarantee. The sending wallet/exchange charges its own network fee. Amounts at or below $0.05 are not swept by Relay; route costs can require larger amounts.

EVM refunds default to the user's Kova address, which the same wallet controls on EVM chains. Users can change it under Refund & token details. Refunds remain on the origin network and may not appear in Kova's Monad AUSD balance. Non-EVM sources require a personal refund wallet on that network. Exchange users are instructed to choose a personal wallet for refunds. No automatic-refund-to-sender placeholder is used. Relay verifies the native refund address when quoting; Kova checks its network format first.

## Tracking and recovery

- `GET /v1/wallets/:address/chain-deposit-sources`
- `POST /v1/wallets/:address/chain-deposit-quote` with `{ chain_id, token, amount, refund_to }`
- `GET /v1/wallets/:address/chain-deposits`

Tracking uses **`GET /requests/v3` filtered by recipient and Monad AUSD**, rather than the quote-time request ID. Regenerated requests and later deposits are tracked separately. The API verifies the returned recipient and destination again. The UI polls without overlapping requests, refreshes the wallet after success, reports refunds/failures distinctly, and shows a reconnect message if tracking fails. No estimate is displayed as an actual received amount. Activity is recovered from Relay after reopening the screen, without a local address cache.

Changing network, token, amount or refund wallet removes the old QR immediately. Changing wallets remounts the flow and invalidates in-flight quote responses. The UI shows only successful actual-route AUSD amounts as received. A recovery link opens `https://relay.link/withdraw` when a deposit needs attention.

## Configure and release

1. Create a Relay developer API key through [the official developer dashboard](https://dashboard.relay.link/). Put **`RELAY_API_KEY` only on Railway's `api` service in `monad-mainnet`**. Never put it in an `EXPO_PUBLIC_*` or `NEXT_PUBLIC_*` variable. Relay's current `/requests/v3` requires this key; the integration deliberately does not use the deprecated `/requests/v2` API, which retires 24 November 2026.
2. `KOVA_NETWORK=mainnet`; `KOVA_CHAIN_DEPOSITS=1` (default) on the API. Setting the latter to `0` pauses new instructions and hides the entry. Tracking remains available for existing deposits while paused.
3. Web/native entry flags default to enabled, but the entry is shown only when the server reports it available. `NEXT_PUBLIC_KOVA_CHAIN_DEPOSITS=0` / `EXPO_PUBLIC_KOVA_CHAIN_DEPOSITS=0` can hide it in a build. No key, testnet or disabled Monad closes the feature before displaying an address.
4. Deploy the API and web. Ship the native changes through a new signed iOS build; existing TestFlight build 11 does not contain this screen revision.
5. With the key configured, repeat quotes for each offered source and make a small, explicitly approved funded deposit. Verify the source transaction, actual AUSD transfer into the wallet on Monad, refreshed spendable balance, repeat deposits and refunds. No funds were sent during implementation.

Existing Aurora service helpers and the bank-account partner's legacy routing remain separate. The new client flow does not use Aurora. NEAR 1Click's token list was rechecked on 18 October: Monad listed MON, USDC and USDT0, without AUSD, so simply enabling the old Aurora feature would not solve AUSD settlement.

## Verification performed

- API routing tests cover mainnet/pause/key gates, allowed solver tokens, disabled Monad, exact 18-decimal MON, amount bounds, refund requirements, wrong recipients/tokens/networks/decimals, missing addresses, slippage, provider failures and regenerated-deposit tracking.
- Web interaction tests cover MON defaults, refund defaults, non-EVM refunds, stale quotes, wallet changes, provider errors and paused deposits.
- Live, **unfunded** provider quotes returned deposit addresses and Monad AUSD outputs for MON, Base/Ethereum/Arbitrum/Optimism/Polygon/BNB/Avalanche USDC, Tron USDT and Bitcoin BTC. Non-EVM `user` must be an origin-native address; `recipient` is always the Kova EVM wallet. Unauthenticated Solana deposit-address creation returned `UNAUTHORIZED`; recheck with the approved Relay key before treating Solana as validated.

Primary provider references: [Deposit addresses](https://docs.relay.link/features/deposit-addresses), [quote API](https://docs.relay.link/references/api/get-quote-v2), [requests v3](https://docs.relay.link/references/api/get-requests). Deposit addresses currently depend on the provider's HTTPS response; Relay does not yet expose deterministic deposit-address verification to integrators.

## Release evidence (18 October 2026)

- API deployment `b0fdbec9-518a-4cf3-b279-6cbac2d829ee` adds the final authenticated tracking readiness check. The mainnet health endpoint remains healthy on chain 143 with the expected AUSD contract; database OK and watcher lag 4 blocks at the release check.
- Web deployment `cf4edb1d-2078-42e9-ae4e-9b65ecfcb02c` succeeded. Both direct API and web proxy report `live:false, tracking:false` while the Relay key is missing; attempting a quote returns HTTP 409 without a deposit address.
- iOS **0.1.0 build 14**, EAS build `18dae0ad-bc82-436a-927b-c424af4a31a8`, finished. TestFlight submission `0d54eb5e-919e-476e-a237-65cc9efd78a8` finished. Apple's processing and public beta-group availability were not independently verified.
- Build 12 exposed an unused optional Apple-authentication dependency's entitlement mismatch with the existing profile. The native module is now excluded through Expo's documented iOS autolinking configuration; introspection confirms no Apple sign-in entitlement. Google OAuth uses the existing browser flow. Build 13's archive upload failed; excluding `.git` (without a trailing slash, as EAS's explicit Git special case requires) reduced the replacement archive. Build 14 incorporates the fixes.
- 43 selected API tests and 22 web tests passed. API and web production builds, mobile typecheck/lint (8 existing warnings, no errors), and the final Hermes iOS export passed.
- Deployed web UI reviewed with **fixture responses only** at 320, 390 and 1440 px: no overflow or browser errors; MON default, quote instructions, non-EVM refund requirement and invalidation of stale addresses verified. This is visual/interaction evidence, not funded settlement evidence.
- Pending: an explicitly approved funded settlement/refund check. Neither ordinary MON transfers to the wallet nor preview estimates are credited as AUSD.

Activation verified: the supplied key was accepted by Relay's authenticated `/requests/v3` endpoint, installed only on Railway's `api` service in `monad-mainnet` through standard input, and the service redeployed. The live API now reports `live:true, tracking:true`. Live API quotes returned HTTP 200 and valid AUSD deposit instructions for MON on Monad; USDC on Base, Ethereum, Arbitrum, Optimism, Polygon, BNB, Avalanche and Solana; USDT on Tron; and BTC on Bitcoin. Deposit tracking returned HTTP 200 with a readable request list. No funds were transferred. The key is not stored in repository files or client bundles.

## Direct MON visibility and conversion release — 18 October 2026

- Web deployment `92353023-ee62-4fd8-a6f3-99dfbd8596d3` succeeded on `mykova.app`.
- iOS version **0.1.0 (16)** built successfully (`f86a5c36-9e46-498f-aa72-29749e266cb0`); TestFlight submission `cc1a217f-29cf-4cd5-b903-c91d9ddc28cd` finished. The downloaded IPA contains the MON card, conversion approval, saved-progress code and mainnet API URL; it excludes the testnet API URL. Public beta group availability is not independently verified.
- 24 shared signing/conversion tests and 28 web tests pass. Mobile typecheck and lint pass with eight pre-existing warnings. The web production build and iOS Hermes export pass.
- Local and deployed-production UI checks at 320, 390 and 1440 px verify MON visibility, conversion estimates, no horizontal overflow, saved progress after MON leaves, and the receive-screen deposit link, with no page errors. These checks use simulated balances and never sign or transfer funds.
- A real mainnet quote for **10 MON** returned **0.185143 AUSD** at the time of checking. A live RPC estimate produced a buffered gas limit of 25,200 and a maximum network fee around 0.00514 MON. Prices and fees vary. No funds were transferred during this verification, so funded settlement remains unverified.
