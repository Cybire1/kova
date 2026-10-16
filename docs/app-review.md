# App Review: TestFlight notes

What to put in App Store Connect → TestFlight → **Test Information**.

## Beta App Information

- **Beta App Description** (paste as is):

  ```text
  Kova is a dollar wallet and a shop till in one app, on Monad.

  - Send dollars to anyone by name, QR code or link. It arrives in about a second, with no fee.
  - Pay any Kova shop by scanning its QR code.
  - Run your own shop: take payments at the till, manage orders and items, and see today's sales.
  - Kova Card: set a daily limit, freeze it, or change its PIN.

  This beta runs on Monad testnet with test dollars only; no real money moves. Your wallet is a passkey made with Face ID, so there's no password or seed phrase.

  To send feedback, take a screenshot in the app, or email us.
  ```

- **Feedback Email:** the founder's email.
- **Marketing URL:** https://mykova.app
- **Privacy Policy URL:** https://mykova.app/privacy
- **License Agreement:** leave empty (Apple's standard one applies).

## Beta App Review Information

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

## Before the next build

The demo account lives on the **testnet** API, and the code defaults to mainnet. TestFlight builds
use the `testflight` profile in `apps/mobile/eas.json`, which sets `EXPO_PUBLIC_KOVA_NETWORK=testnet`
and `EXPO_PUBLIC_KOVA_MONAD_API_URL=https://api-monad.up.railway.app`; without them the reviewer's
demo sign-in fails.

```bash
cd apps/mobile
npx eas-cli build -p ios --profile testflight
npx eas-cli submit -p ios --profile production --latest
```
