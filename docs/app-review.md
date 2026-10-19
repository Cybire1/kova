# App Review: TestFlight notes

What to put in App Store Connect → TestFlight → Test Information → **Beta App Review Information**.

Production builds now target Monad mainnet (chain 143), mainnet AUSD, and the mainnet API.
The notes below describe the older testnet build 8. Do not reuse the test-dollar claim or demo
credentials for a mainnet submission: the demo account is available only on the testnet API.

- **Sign-in required:** on.
- **User name / Password:** `KOVA_DEMO_USERNAME` / `KOVA_DEMO_PASSWORD` from the API's environment
  (Railway `api` service, environment `monad`; locally `apps/api/.env.monad`). Never commit them.
- **Contact:** your name, email and phone.

## Review notes (paste as is)

Kova is a dollar wallet and a shop till in one app, on Monad testnet. Everything in this build
uses test dollars; no real money moves.

A Kova wallet is normally a passkey (Face ID makes it). So you don't need one, use the demo
account:

1. Open Kova and tap "I already have Kova".
2. Tap "Sign in with a demo account" and enter the username and password above.

You'll be in Sam's wallet, with test dollars, people who have paid Sam, a shop and a Kova Card.

What to try:
- Home: balance, Send (pick a person under "Send again"), Request, Add money.
- Pay: any Kova payment QR. To make one, open "Sam's Weaves" on Home, tap Charge, enter an
  amount; the till shows a QR another phone can pay. Or open a shop link like
  mykova.app/s/sams-weaves in Safari and order.
- Card: Sam's Kova Card. Freeze and unfreeze it, change its daily limit, change its PIN. These are
  real changes on Monad testnet. Tapping a card to pay needs a physical Kova Card (an NFC chip),
  which a review device won't have; the till shows "Tap a Kova Card" and reads it with the
  iPhone's NFC reader. Everything else about the card works without one.
- Shop: "Sam's Weaves" on Home opens the till: Charge (keypad, items or barcode scan), Orders
  (one waiting to be handed over), Stall (items, open/closed, share link) and Today's sales.
- Travel: search flights or hotels (sandbox fares).

Why the app asks for:
- Camera: to scan payment QR codes and product barcodes, and to photograph items for the shop.
- NFC: to read a Kova Card when linking it to a wallet and when taking a card payment at the till.
- Face ID: to approve payments (the demo account skips it).
