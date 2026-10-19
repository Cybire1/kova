# Mainnet release

Verified 18 October 2026 (Africa/Lagos).

- Web: https://mykova.app/wallet serves `network: mainnet` after deployment
  `854242c6-97c7-4c21-878e-e8d1025bdcba` (Railway `monad-mainnet`, service `web`).
- API: https://api-monad-mainnet.up.railway.app/health reports `network: mainnet`, chain 143.
- iOS: version 0.1.0, build 11, EAS build
  `f343215a-b2a1-40cb-9378-926e844b373c` completed successfully. Submission
  `844bc64c-7dc5-4db3-a6c8-b3f68cd94360` completed successfully to App Store Connect app
  `6819066097`. Public TestFlight group availability has not been independently verified.
- The downloaded build 11 app bundle contains the mainnet API URL and no testnet API URL.
  The production EAS profile explicitly pins mainnet, its API, and `https://mykova.app`.
- EAS production build 8 was inspected separately: its bundle selects testnet. Its source
  defaults differ from the current source, so current source settings alone do not establish
  what a previously installed TestFlight build uses.

Validation: web production build and four network configuration tests passed; web, API, and
mobile type checks passed. Mobile lint passed with eight existing warnings and no errors.
No payment transactions were executed for this release verification.

Local testnet tools and the separate testnet deployment remain available with explicit testnet
configuration. Partner funding features remain subject to their existing availability checks.

## README evidence audit — 19 October 2026

Read-only checks confirmed mainnet API chain 143, a healthy database, a fixed exchange-rate
table with no rate contract configured, and disabled naira funding. Mainnet public checkout
statistics reported 0 paid checkout records and $0.00 volume. Ordinary wallet transfers live
in the transfer index and are not counted by this checkout statistic.

Existing AUSD transfer receipts were checked directly on mainnet, including transaction
sender (Kova's relayer), successful receipt status, token and amount:

- `0x98b3d548bd1e6c726b1687718de8e08ed7fc1895f90b8004416cdbc4deef7ba4`: $1.00.
- `0x370e22dd3791638643ecaa10a610874cea9093222757bbe1e5b6da9ad3104930`: $1.00.
- `0xd7e2300fc3a2fa639fa922871466a4abe39f7a345425c5ecf342896f790fe528`: $1.00.

The KovaCard address returned deployed bytecode. This audit did not establish a mainnet
card-payment receipt. The README labels the three receipts as wallet transfers and preserves
the pending card/checkout proof status. No funds were moved and no payment records were added.

Testnet API checks separately confirmed Chainlink-backed rates and Paystack test mode. These
are not mainnet feature availability or adoption claims. README whitespace validation passed.

## MON cleanup and web receiving — 19 October 2026

Mainnet web deployment `3c34296f-53c4-4e70-8f5d-b530f8d670bd` succeeded. Deployed browser
fixture checks verified hidden MON dust, persisted dismissal, automatic private balance
restoration, public/private arrival dialogs, reduced motion and no replay of old history.
No funds were transferred during this fixture verification.

iOS 0.1.0 build 17 (`f766238a-23e6-40bc-8e0b-e9290f7bbc6b`) and its App Store Connect
submission (`49e44ce5-06c1-4ef4-895d-81b9e4606cb0`) both finished successfully. The IPA's
Info.plist reports build 17 and bundle `xyz.kova.pay.monad`; its compiled bundle contains
the mainnet API, no testnet API URL, and the MON dismissal UI/storage key. External public
TestFlight group availability was not independently checked.

The later USSD simulator beta was deployed only to the separate testnet API and website.
The current iOS mainnet app is not the client for this simulator flow.

## Website switched to testnet for the demo — 19 October 2026

At the user's explicit request, `mykova.app` now points to the existing testnet API on chain
10143. The Railway web service still belongs to the `monad-mainnet` environment, but its
`KOVA_NETWORK`, `KOVA_API_URL` and `KOVA_PUBLIC_API_URL` select testnet. Its passkey domain
remains `mykova.app`; Google sign-in settings were retained. The global top banner was later
removed at the user's request; phone/USSD screens retain their simulator labels.
Banner removal release `a93b01ae-b84e-4352-a438-5a8cc665806c` built successfully and its
container started. A fresh live wallet response confirmed the global banner is absent.
The mainnet API and current TestFlight build remain on chain 143.

Private ledgers, payment notes, shop labels, saved link recovery keys and shop sessions are
separated by network, preserving the site's existing mainnet storage. Wallet identity and
passkeys are retained; mainnet funds were not moved. Reload existing tabs after the switch.

Web deployment `54ef39df-6e21-43f0-9edc-d9409b78acdb` succeeded. Testnet API deployment
`f8148517-4e80-4f05-987d-69ec15753d54` succeeded and uses `KOVA_PHONE_WEB_URL=https://mykova.app`
for phone invitations. See [phone-payment verification](phone-payments.md) for test receipts.

To restore the website to mainnet, set the web service's `KOVA_NETWORK=mainnet`,
`KOVA_API_URL=https://api-monad-mainnet.up.railway.app` and matching `KOVA_PUBLIC_API_URL`,
retain passkey domain `mykova.app`, and rebuild/redeploy the web service. Remove the testnet
API's `KOVA_PHONE_WEB_URL` override at the same time so test invitations return to its Railway
website. Do not change mainnet API encryption keys or enable production phone/USSD flags as
part of restoring the website.

## Misleading private-balance prompt — 19 October 2026

Removed "Unlock private dollars" from the home balance card. Its trigger treated any new
network-wide private announcement as a reason to show a wallet-specific prompt, even though
that announcement did not establish that this wallet had received money. Keyless background
checks no longer poll that global feed. The Activity setup control now depends on this wallet
having private receiving enabled and lacking browser scan access. Existing read-only view
restoration, automatic keyed scans, confirmed private amounts and balance hiding remain.

All 56 web tests and the testnet production build passed. Deployment
`f9e137a7-3ecc-4513-b7ec-104656649661` succeeded. Browser fixture checks on `mykova.app` at
390px and 1440px showed no unlock prompt, false private amount, global top banner, overflow
or runtime error; no keyless announcement requests were made. No SMS or funds moved.
