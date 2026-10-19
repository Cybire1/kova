# Google wallet sign-in

The main wallet supports Google as an alternative to a passkey. New Google users receive a
Privy embedded Ethereum wallet; returning users reopen its existing address. The web and
native clients use the same Privy app and select the first wallet index. They sign AUSD
authorizations for the configured Monad network; Kova's existing relayer submits payments.
No private key or Google OAuth token is sent to Kova's API.

Existing passkey wallets still open with their original passkey. This change does not import
passkey keys into Privy, merge wallets, or give Google access to an existing passkey wallet.

## Native activation

Google OAuth is already enabled on Privy app `cmufz0ix501jn0cl6z2vdou5a`. Native activation
requires a mobile app client in Privy Dashboard → App settings → Clients:

- Allowed app identifier: `xyz.kova.pay.monad`.
- Allowed URL scheme: `kova`.
- Set the public client ID as `EXPO_PUBLIC_PRIVY_CLIENT_ID` locally and in the EAS production
  environment, or explicitly in the production build profile, before creating the next build.
- `EXPO_PUBLIC_PRIVY_APP_ID` defaults to the existing public app ID above.

Until the native client ID is configured, the mobile app keeps its passkey flow and hides the
Google button. A JavaScript bundle export alone does not establish native OAuth readiness.

The web uses the existing `PRIVY_APP_ID` server setting. A single provider owns wallet,
checkout, and shop sign-in so they share the same Privy identity and wallet list.

## Restoration and approvals

Google wallets restore encrypted names and contacts using a separate, private, deterministic
wallet signature. The client checks that it can reproduce the signature before using the
derived vault secret. This follows the existing signature-derived private-receiving-key model.
Signatures used to derive encryption keys must never be logged or published.

Reopening a remembered wallet checks its expected address. A different Google account fails
without replacing the wallet. Sign-out ends the signing session, clears vault material, and
ends the provider session. The native app uses device authentication when reopening a signing
session; the web asks for confirmation. Existing amount and idle limits remain in force.

Google wallets need a connection to sign. Native offline payment creation stays available to
passkey wallets; Google users receive an explicit explanation to reconnect.

## Verification

Provider signature tests cover real signature recovery, EIP-712 payments, wrong accounts,
wrong networks, session locking including an in-flight signature, and vault restoration.
Web component tests mock only the external identity provider and cover first sign-in,
returning users, creation, OAuth return, cancellation, wrong accounts, identity changes,
sign-out, and abandoned requests. They do not authenticate a real Google user.

A fresh-browser check confirmed the Google button sends an OAuth initialization request to
Privy and reaches `accounts.google.com`, with no page errors. Native type checking and an iOS
JavaScript export pass. A real native sign-in on a device still requires the app client above.

The web change is deployed on `mykova.app` (Railway deployment
`a03eda92-bfee-497d-b09a-cfe7d0159abe`, status `SUCCESS`). The same fresh-browser check passed
against the deployed site, with both sign-in options visible and no horizontal overflow at
390 px. All 41 shared-package tests and 15 web tests pass; API, web, and mobile type checks pass.
Mobile lint has no errors and eight pre-existing warnings. No real payment was submitted.

The current TestFlight build does not include this Google integration. Its replacement must be
built with the configured native client ID and tested on a device before Google is advertised
as available in iOS.

Native release note (18 Oct): the optional `expo-apple-authentication` peer remains available to the JS SDK but is excluded from iOS native autolinking because Kova currently exposes Google OAuth and passkeys, not Apple OAuth. This avoids adding an unused Apple sign-in entitlement to the existing provisioning profile. Expo introspection and build 14 confirm the configuration. Adding Apple OAuth later requires deliberately enabling that module and the corresponding Apple capability/profile.
