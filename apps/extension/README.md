# Kova for Chrome

Give every site a budget, not your wallet.

Kova for Chrome is a wallet websites can use (EIP-1193, announced with EIP-6963, so wallet pickers
list "Kova" on their own). Connecting a site only shows it the wallet's address. A site that wants to
be paid gets its own **spending key** with a limit, a day or a week, that Monad enforces through the
KovaCard contract. A bad site can spend its budget, never the balance.

## What it does

- **Connect.** A site that asks to connect opens Kova's window: it sees the address and balance,
  nothing more. Disconnect it from the popup, or the site can revoke it (`wallet_revokePermissions`).
- **A budget at the first payment.** The first time a site asks to be paid, Kova's window shows what
  it asks and offers $5, $20, $50 or any amount, a day or a week. The extension makes a key, Kova
  keeps the terms, and the wallet switches it on at mykova.app/extension, with its passkey or Google.
  The wallet's own key never comes here.
- **Pay from the budget.** A site's AUSD transfer (`eth_sendTransaction` to AUSD's `transfer`) is
  paid by the site's own key after one click (the budget window is that click the first time), gasless: Kova checks the budget and prepares the
  KovaCard payment, the extension rebuilds it and refuses any field that differs from what the
  person approved, the key signs, Kova cosigns and sends it.
- **Pay per use (x402).** A page that answers `402` with a `PAYMENT-REQUIRED` header is paid from
  the site's budget: under the site's line without asking, above it after a click. The page loads
  again with `PAYMENT-SIGNATURE`. Kova pays the site from its float (the API's `KOVA_X402_PAYER_KEY`),
  in AUSD or USDC, and the budget pays Kova in AUSD. A site paid in AUSD can have Kova collect the
  payment on Monad (`POST /v1/x402/collect`), since Monad's x402 facilitator takes USDC only. Monad
  only: x402 sites on other networks aren't paid yet.
- **Freeze.** Each site's switch freezes it with its own key, at once; Freeze all stops every site.
  Only the wallet (passkey) unfreezes or removes. The web wallet's and the app's Keys screens list
  these sites too, under Websites.
- **Refused:** permits and other typed data, `eth_sign`, and any transaction that isn't a plain
  AUSD transfer. Reads (`eth_call`, `eth_getBalance`, …) go straight to Monad. Sign-in messages
  (`personal_sign`) are signed by the wallet on mykova.app, after it shows the message.

## Layout

| Path | What it is |
|---|---|
| `src/background` | The service worker: site keys (`sites.ts`), the provider's methods (`provider.ts`), x402 (`x402.ts`), Kova's windows and mykova.app's answers (`approvals.ts`). |
| `src/content` | `inpage.ts`, the provider in the page (MAIN world); `bridge.ts`, which carries its requests and shows Kova's notes on the page. |
| `src/ui` | The popup (`popup.tsx`) and Kova's own windows (`prompt.tsx`). |
| `src/shared` | Config, types, the API client and the payment check (`kova.ts`). |
| `manifest.json` | MV3. Its `key` fixes the extension's ID, `aoaggfomejplfmnipidhdobmekaeogha`, which mykova.app answers (apps/web `lib/extension.ts`). |

## Build and load

```bash
pnpm --filter @kova/extension build     # dist/ and kova-chrome-0.1.0.zip, for Monad mainnet
pnpm --filter @kova/extension test      # the payment check and what a site may ask to pay
pnpm --filter @kova/extension typecheck
```

Load it from `chrome://extensions` (Developer mode → Load unpacked → `apps/extension/dist`).
For the test network and a local mykova.app:

```bash
KOVA_NETWORK=testnet KOVA_WEB=http://localhost:3014 node build.mjs
```

## Try it

mykova.app/chrome (apps/web `app/chrome`) is a site like any other: connect, a 10¢ tip (the first
payment, so the budget window), and a 1¢ x402 article (`/chrome/article`). Both pay the web app's
`KOVA_TRY_PAY_TO`; unset, the page says the demo payments are off.

## Before it's live

- Deploy the API (site keys, `self-freeze`, `x402`) and the web app (`/extension`).
- For x402: set `KOVA_X402_PAYER_KEY` on the API and fund that address with a little USDC and AUSD.
- For the try page: set `KOVA_TRY_PAY_TO` on the web app, to a Kova wallet that isn't the one testing.
  Kova refills its USDC by swapping the AUSD it's paid, in batches.
- The Chrome Web Store assigns its own ID: add it to the web app's `NEXT_PUBLIC_KOVA_EXTENSION_IDS`.
