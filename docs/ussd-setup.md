# USSD provider setup

## Africa’s Talking sandbox

- Provider dashboard: `https://account.africastalking.com/apps/sandbox`.
- Backend environment: Railway `monad`, service `api`.
- Backend network: Monad testnet, chain ID `10143`.
- Allocated sandbox channel: `53916` under the shared `*384#` service code, confirmed in
  the provider dashboard on 2026-10-19. Dial `*384*53916#` in the web simulator.
- Callback: `https://api-monad.up.railway.app/v1/ussd/<secret>`.
- `KOVA_USSD_CALLBACK_SECRET` is stored in Railway. Do not commit or publish the full URL.
- `KOVA_USSD_CODE` is set to `*384*53916#`.

The callback can respond to requests without SMS credentials. An unregistered phone gets
the existing instruction to set up a Kova pocket. This does not establish a usable payment
pocket or activate live USSD.

The sandbox application's SMS credentials (`AT_USERNAME=sandbox`, `AT_API_KEY`) were
authenticated against the provider's application endpoint and saved in Railway on 2026-10-19.
The provider initially rejected the newly generated key; it accepted it after the documented
five-minute activation window. No SMS was sent during this read-only credential check.

The testnet pocket encryption key is stored in Railway and `KOVA_USSD_ENABLED=1` is enabled
only in the `monad` environment. The live readiness endpoint reports `network: testnet`,
`mode: sandbox`, `enabled: true`, and `dial: *384*53916#`.

### Test the simulator beta

1. Open [USSD setup](https://web-monad.up.railway.app/wallet/ussd) and create or open a test
   wallet on that website. Its passkeys belong to the test website; the current iOS app uses
   mainnet.
2. Enter the same phone number registered in the provider simulator, including its country
   code. Choose a PIN and daily spending limit, then approve setup with the wallet.
3. Read the verification code in the simulator's SMS inbox and enter it on the setup page.
4. Use **Get free test dollars** to receive up to $5 of test AUSD. Return to USSD settings,
   choose $4, review the transfer and confirm it to fund the pocket.
5. Dial `*384*53916#` in the simulator. Option 1 checks the pocket balance after its PIN.
6. Open [Ada's test bakery](https://web-monad.up.railway.app/s/adas-bakery-a2cf), order a
   croissant ($3.25 at verification), and keep the checkout open. Under **Pay by USSD**, copy
   its 6-digit code. In the simulator choose option 2, enter the code, check the shop and
   amount, then enter the PIN. The checkout should update to its paid receipt.
7. Check the pocket history and explorer receipt. Return any remaining test dollars through
   USSD settings. The owning wallet approves recovery without the USSD PIN.

Messages stay in the provider simulator and settlement uses Monad testnet. An actual
provider SMS/OTP cycle and funded test payment still need the human tester to complete these
steps; automated checks do not claim to have performed that funded provider test.

The SMS sender now rejects missing credentials, mainnet use of sandbox credentials,
malformed provider responses, and individual recipient rejections even with HTTP success.
Verification codes and provider response bodies are never logged. Callback handling checks
the assigned service code and request size/shape, rate-limits a phone, compares secrets in
constant time, and redacts the callback secret from request logs.

Validation on 2026-10-19: 134 API tests passed against an isolated local Postgres database
(14 pre-existing end-to-end tests skipped); 42 web tests passed. API/web production builds
and mobile typecheck passed; mobile lint had zero errors and eight existing warnings.
Railway testnet API deployment `15f0cb0f-9873-465a-b6cd-f439a6cae46a` and web deployment
`4cd2d4f4-403f-4fe0-b6a8-30d4116e02be` succeeded. Deployed callback checks confirmed a
response for the allocated code and rejection of incorrect secrets, incorrect service codes
and malformed text. Health remained testnet/10143 with a healthy database. No SMS or
payment transaction was sent during these checks. Isolated-browser fixture checks covered
setup, OTP entry and active-pocket screens on phone and desktop without horizontal overflow
or runtime errors. The database tests used simulated chain receipts and SMS responses to
exercise PIN/OTP concurrency, spending reservations, exact checkout codes, idempotency,
unknown-broadcast reconciliation, and recovery while USSD spending is paused.
Pending receipts are also checked in the background every 10 seconds, so confirmation and
receipt delivery do not depend on the user keeping the website open. The deployed resend
form remains open during background polling, and new-wallet onboarding is enabled on the
test website's passkey domain.

Signed pocket changes use v2 messages bound to the chain and wallet. PIN changes include a
commitment to the PIN and a secret random nonce; the nonce is sent only to the API over HTTPS.
Pending source hashes are persisted before broadcast, and pending dollars stay reserved
until receipts are checked. Mainnet USSD requires a future iOS build using this v2 client;
mainnet build 17 predates these new USSD approvals.

## Cashing out by USSD

The phone can turn its pocket's dollars into naira with **5 Cash out**: amount, the naira it comes
to, then the PIN. The naira goes only to the one bank or mobile-money account (OPay, PalmPay,
Moniepoint and other Paystack banks) that the owner saved in the app under Pay by USSD, Cash out
to. The bank names the account before it is saved, and the wallet's passkey approves the change, so
a PIN in the wrong hands can't send naira anywhere else.

How it settles: Kova quotes the naira, the pocket's key signs an EIP-3009 transfer of the dollars to
Kova's treasury with the cash-out's own memo as the nonce, and once it lands on Monad Paystack pays
the account. If the bank refuses, the treasury sends the dollars back to the pocket. Either way the
phone gets a text. A cash-out counts against the pocket's daily limit, like any other spend.

It needs naira switched on (`PAYSTACK_SECRET_KEY`, the relayer) as well as USSD. With a Paystack
test key no naira moves. Tests: `apps/api/test/ussd-cashout.test.ts`.

## Live service

The sandbox channel does not work as a live Nigerian dial code. A provider-approved live
code, production SMS credentials, verified callback configuration, and an end-to-end phone
test are still required. The sandbox setup does not change `monad-mainnet` configuration.

Provider instructions:

- [Sandbox setup](https://help.africastalking.com/en/articles/1170660-how-do-i-get-started-on-the-africa-s-talking-sandbox)
- [Live callback setup](https://help.africastalking.com/en/articles/9915125-how-do-i-go-live-with-ussd)
