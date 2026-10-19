# Phone payments

Send accepts a phone number with an explicit country code on web and iOS. Both clients use
`createPhoneClient` and the same chain-bound wallet approvals.

- An active USSD number resolves to its pocket while USSD is enabled. The review names the
  USSD destination, and the transfer credits the spendable USSD balance directly. A verified
  number without an active, enabled pocket resolves to its owner's main Kova wallet. Destination
  address and type are rechecked immediately before signing; changes require another review.
- A new number gets a pending `phone_accounts` entry, not a usable authenticated account.
  A payment is reserved and its recovery key is saved before funding. The recipient receives
  an invitation after funding. They open or create a Kova wallet using Google or a passkey,
  verify the recipient number by SMS, and claim into that wallet.
- Unclaimed payments can be returned by a signed sender approval, including from another
  device. Phone payments appear in Your links; opening one shows its invitation and recovery.
- The invitation carries no spending key. Phone-payment keys are sealed under
  `KOVA_POCKET_MASTER_KEY`, using a separate `phone:<id>` encryption context. Kova controls
  waiting funds until claimed or returned; this is disclosed before sending. The sender also
  retains the recovery key in the existing local link-key store.
- Phone ownership never silently replaces a number already linked to a different wallet.
  The USSD setup flow checks the same registry. USSD phone sends can resolve accounts verified
  by the new recipient claim flow, without requiring the recipient to fund a USSD pocket.

## Deployment

Run migration `0025_phone_payments`. Set `KOVA_PHONE_SEND_ENABLED=1` only where SMS credentials,
the pocket encryption key, and the relayer are configured. Testnet requires sandbox SMS;
mainnet refuses sandbox credentials. Do not rotate the pocket encryption key while funds wait.
Mainnet activation requires live provider onboarding; this code does not obtain that approval.
The current released iOS app predates this feature and requires a new build for native access.

The demo runs at `/wallet/send/phone` on the test website. SMS invitations and verification codes
arrive in Africa's Talking's simulator. The web invitation stays on the originating network.

## Payment and verification controls

Approvals bind chain, wallet, action, number, address, amount, name, note and payment id. Creation
is idempotent for a recovery address. Raw phone numbers, keys and OTPs are omitted from public
payment responses and request error logs. OTPs expire in ten minutes, are salted and hashed,
are bound to the recipient wallet, and lock after five committed failures. A phone-wide database
lock prevents overlapping fresh challenges from bypassing attempt limits.

Claims and returns serialize their destination in Postgres and use the same deterministic token
authorization nonce. The signed transaction hash is stored before broadcast. Unknown results
stay reserved; receipt recovery checks the exact token, sender, recipient and amount. Recovery
and invitation retries run in the background, with database-controlled SMS retry spacing.
Normal bearer-link claim routes reject phone payments. Sender recovery remains available when
new phone payments are paused. A funding cancellation or uncertain broadcast never triggers
an automatic second funding transfer.

## Demo rehearsal

1. Open a funded test wallet and choose Send → Send to a phone number.
2. Enter a second simulator number with country code and $1. Review and slide to send.
3. Open the invitation from that simulator number's SMS inbox in a separate browser profile.
4. Create/open a different test Kova wallet with Google or a passkey, enter the full recipient
   number, request its OTP and verify it. Claim the test dollars and check the receipt.
5. Send another $0.50 to that number: it now resolves directly to the verified wallet.
6. Test a different new number and return the waiting payment from Your links.

Automated checks use simulated SMS and blockchain receipts, with an isolated local database.
A real provider SMS and funded on-chain rehearsal must be distinguished from those checks.
Phone-number recycling and changing a verified number's wallet require an explicit future
recovery policy; verification does not overwrite an existing wallet association.

## Verification and demo release — 2026-10-19

- API: 148 tests passed against an isolated temporary Postgres database; 14 existing end-to-end
  tests skipped. Fourteen phone-payment integration tests cover OTP limits, network-bound proofs,
  sender/recipient races, unknown broadcasts, invitation failure/retry and recovery while paused.
- Web: 49 tests passed, including verified-recipient sends, new-recipient funding, duplicate-button
  protection, recipient changes, OTP claims and resuming a verified claim after reload.
- Shared phone primitives: two tests passed. API and web production builds passed. Mobile typecheck
  and lint passed with zero errors and eight existing warnings.
- Testnet API deployment `2345c35d-5ef3-49dd-9b7e-c6776c261d6c` and final web deployment
  `a1940c3c-b36e-429f-859c-ecd4e2a2bc0b` succeeded. Testnet alone has phone payments enabled.
- Live read-only/signed-lookup checks confirmed an unregistered number resolves to no wallet,
  a mainnet approval is rejected on testnet, and database, relayer and existing USSD remain healthy.
- Browser fixtures on the deployed website covered Send and sender screens at 390px/1440px,
  recipient verification and new-recipient Google/passkey onboarding, without overflow or runtime
  errors. These checks sent no messages and moved no funds.
- Native screens are implemented in source; no new TestFlight build was released for this change.
  A real simulator invitation/OTP/funded claim rehearsal remains to be completed before filming.

## Production staging — 2026-10-19

At the user's request, the same code is deployed on `mykova.app` and its mainnet API:

- API: `7b19264d-1a1a-4175-9481-94605b684366` (SUCCESS).
- Web: `f9c5c049-ff85-40d9-97d3-e8356e6336ce` (SUCCESS).
- Production remains Monad mainnet, chain 143. Health and database checks passed.
- Production has no SMS API key or username. An encryption master key was generated once and
  stored directly in Railway without printing or saving it locally; do not rotate it after use.
- `KOVA_PHONE_SEND_ENABLED=0` and `KOVA_USSD_ENABLED=0` are explicit production settings.
  `/api/phone/info` reports `enabled: false, network: mainnet`. The phone Send page explains that
  phone payments are coming and presents no funding form while unavailable.
- Activation needs live SMS credentials and applicable provider approval. Phone-number sends use
  SMS and can be enabled separately from USSD dial-code provisioning. Production refuses sandbox
  SMS credentials. No mainnet funds were moved and no messages were sent during staging.
- Testnet remains enabled separately for the simulator rehearsal. Native code remains unreleased.
- Production browser verification passed at 390px: the paused phone screen has no funding form,
  ordinary Send remains available, and neither screen overflows or throws a runtime error.
  The check used a fixture wallet and sent no messages or funds.

## mykova.app testnet demo — 2026-10-19

The user requested switching `mykova.app` to testnet for testing. Web deployment
`54ef39df-6e21-43f0-9edc-d9409b78acdb` and testnet API deployment
`f8148517-4e80-4f05-987d-69ec15753d54` both succeeded. The website's phone info reports
`enabled: true, network: testnet, mode: sandbox`; USSD info also reports enabled sandbox mode.
Invitation URLs now use `mykova.app`. The mainnet API remains mainnet with phone payments paused.

- Web: 53 tests passed, including storage isolation preserving mainnet recovery keys and private
  feed cursors. Phone/USSD API integration: 34 tests passed against the isolated local database.
  API and testnet web production builds passed.
- Deployed browser checks passed at 390px and 1440px for Send and sender management, plus recipient
  verification and new-recipient onboarding at 390px. No overflow or runtime errors. Readiness
  came from the real deployed API; payment data and wallets in these browser checks were fixtures.
- A funded round trip used the actual website faucet and `/api/wallet/send`, controlled ephemeral
  wallets, chain 10143, and test AUSD. Sent 0.25 test AUSD and returned all of it; recipient balance
  returned to zero and sender balance was restored. No user funds or mainnet funds moved.
- Signed phone lookup through the website succeeded for an unregistered number. A chain-143
  approval was rejected. No SMS was sent by these checks. The full invitation/OTP/claim rehearsal
  with simulator phone numbers remains a manual demo step; automated integration tests mock SMS.

| Testnet transaction | Receipt |
|---|---|
| Faucet funding | [0xaff58ca3…](https://testnet.monadscan.com/tx/0xaff58ca3dd703b7a6c1e408a4efdc3a2b5dade27d30b544914a7b10f0cee8812) |
| Send 0.25 test AUSD | [0x700cd4ef…](https://testnet.monadscan.com/tx/0x700cd4ef1d3e3cba4892c862b4af89b047b8e64438a675b97d72303fd8e3c7f2) |
| Return 0.25 test AUSD | [0xa90708d9…](https://testnet.monadscan.com/tx/0xa90708d99630469236e3578b5395444d09266b6e183e31583efb3e7357fdeac0) |

For a rehearsal, reload `mykova.app`, sign in, and get test dollars from Add. If the existing
test dollars are already in a USSD pocket, return them to the wallet first. Open Send → Phone
number and use another number registered in Africa's Talking's simulator. Open its invitation,
sign in to the recipient's own wallet and verify the code in that simulator's SMS inbox. Existing
verified numbers receive in their active USSD pocket, or main wallet if no active pocket is
available. USSD dial code `*384*53916#` remains
simulator-only. The current iOS TestFlight build remains mainnet and does not run this rehearsal.

## App-to-USSD balance routing fix — 2026-10-19

The original app phone resolver returned an active pocket's owner wallet, so an app send reached
that main wallet while the USSD balance remained unchanged. Read-only tracing found testnet
transfers of 2.00 and 1.00 AUSD to the recipient's owner wallet; it held 3.00 AUSD and its verified
USSD pocket still held the earlier 5.00 AUSD. Those existing funds were not moved during repair.

`phonePaymentDestination` now selects an active USSD pocket while USSD is enabled. Wallet identity
checks still use `verifiedWalletForPhone`, so pocket ownership and phone verification remain tied
to the owner. Conflicting identities cannot route to either destination. Closed or pending pockets
are not selected; paused USSD falls back to a verified main wallet. New numbers retain the existing
invitation/OTP claim flow. USSD menu sends to a phone still land in its owner's main Kova wallet,
supporting the reverse USSD-to-app flow.

The shared phone client returns destination metadata. Web and native source display the USSD
destination before approval, and both recheck the destination and address before signing. The
native change is source-only; no new TestFlight build was released.

- API: all 152 tests passed, 14 existing end-to-end tests skipped. Web: all 58 tests passed.
  Coverage includes active pockets, inactive/closed pockets, paused USSD, conflicting owners and
  a pocket closing between review and approval. API/shared/web builds passed. Native typecheck
  passed and lint reported zero errors with eight existing warnings.
- Website deployment `d1b527ab-5ac8-4a30-827b-9a408da44d5a` and testnet API deployment
  `c8f184dd-2c01-4b36-a602-329e3f450329` succeeded. The mainnet API and TestFlight were unchanged.
- A fresh controlled wallet resolved the verified recipient number through `mykova.app`, confirmed
  `destination: ussd-pocket`, and sent 0.25 free test AUSD through the website's real transfer API.
  The successful receipt matched token, sender, pocket and amount:
  [0xdb4afef2…](https://testnet.monadscan.com/tx/0xdb4afef266a4bbe94198b745e93c3feca50b43b131f4634b3f36565f33d97c7a).
  The pocket and real USSD API balance rose from 5.00 to 5.25; the owner's main wallet stayed at
  3.00. No SMS, owner-wallet spend or mainnet transfer was made by this check.
- A fresh browser using the recipient's public profile observed the real USSD API balance change
  from $5.00 to $5.25 automatically. Mobile 390px and desktop 1440px checks had no overflow or
  runtime errors. The browser did not approve or send transactions.

Existing transfers can be moved into the pocket by the owner using Profile → Pay by USSD →
Add test dollars. This requires the owner's normal wallet approval; deployment does not move it.
