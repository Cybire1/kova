# Card and bank top-ups with MoonPay

MoonPay sells no dollar on Monad, so Kova asks it for USDC on Base and has it paid to the wallet's
own deposit address. Relay turns that into AUSD on Monad, the same route as any deposit from Base
(`docs/multichain-deposits.md`). Kova never touches the money: MoonPay's hosted widget takes the card,
Apple Pay or bank payment, checks the buyer, and pays out.

- Code: `apps/api/src/services/moonpay.ts`, served by `GET /v1/wallets/:address/top-up` (Card or bank
  on the web and in the app). With MoonPay's two keys set it uses MoonPay; without them, Ramp.
- Every link is signed with the secret key (required when the address is set) and tied to the IP
  that asked for it (`allowedIpAddress`, required to go live), so a link that pays into one wallet
  can't be passed to someone else. The web vouches for each visitor's IP with `KOVA_PROXY_SECRET`
  (set it on both the web and the API); the app calls the API directly.
- Coverage on 28 Oct 2026 (`GET api.moonpay.com/v3/countries`): buying is allowed in Nigeria, the
  US (not New York for USDC on Base), the UK, the EU, Kenya, Ghana and South Africa. 33 fiat
  currencies, including naira (from ₦20,000) and dollars (from $20).

## Turning it on

1. Make a MoonPay account at dashboard.moonpay.com and copy the keys from Developers.
2. In Railway, on the API service (monad-mainnet): `MOONPAY_PUBLISHABLE_KEY` and `MOONPAY_SECRET_KEY`.
   `pk_test_`/`sk_test_` open MoonPay's sandbox (USDC on Base has no test mode, so the sandbox
   checks the widget and signing only); `pk_live_`/`sk_live_` are real purchases.
3. Deploy the API. Card or bank opens MoonPay at once.

## Going live with MoonPay

- MoonPay approves live keys after its business checks.
- IP matching: tell the MoonPay integration contact once tested, so they switch enforcement on.
  Known edge: an iPhone with iCloud Private Relay opens the checkout from an Apple address in the
  app's in-app browser, which won't match; MoonPay skips IP enforcement only when the link omits
  `allowedIpAddress`. Opening the checkout in the app's own web view (WKWebView) avoids it.
