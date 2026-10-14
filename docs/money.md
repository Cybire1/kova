# Money in, the dollar card and savings

Three parts of Kova that run through partners. Each is built end to end (API, web, iPhone) and is
honest about its partner: until Kova has that partner's key, the screen says what the feature is
and who runs it, and offers **Request access** (signed by the wallet, kept in
`money_access_requests`). With the key set, the real flow opens.

| Feature | Partner | What unlocks it | Status on 14 Oct 2026 |
|---|---|---|---|
| Get paid from abroad: a US account number | Bridge (a Stripe company), virtual accounts | A Bridge developer account (sandbox first; onboarding through support@bridge.xyz), then `BRIDGE_API_KEY` | Waiting on the key |
| Dollar card (virtual first) | Lithic, virtual cards and Auth Stream Access | A Lithic account (sandbox keys are self-serve), then `LITHIC_API_KEY` and `LITHIC_ASA_SECRET`; production needs Lithic's program approval | Waiting on the key |
| Savings: dollars that earn | Any ERC-4626 vault for AUSD, behind `KovaSaver` | Testnet: deploy `KovaTestVault` + `KovaSaver` (needs testnet MON). Mainnet: choose an ERC-4626 AUSD vault, then deploy `KovaSaver` in front of it | Contracts tested, not deployed |

## How each works

**US account.** `POST /v1/wallets/:address/us-account` (signed) creates a Bridge KYC link with the
person's name and email. Once Bridge approves them, Kova creates a virtual account whose
destination is the wallet's own Aurora Intents EVM deposit address (USDC on Base by default,
`BRIDGE_DESTINATION_RAIL` / `_CURRENCY`), so ACH and wire deposits land as AUSD on Monad through the
deposit path Kova already has. Bridge doesn't list Monad as a destination rail; it does list Tempo.
The account and routing numbers are only returned to a signed request
(`/us-account/view`).

**Dollar card.** `POST /v1/wallets/:address/dollar-card` (signed) issues a Lithic virtual card with
a daily spend limit ($200 by default, up to $2,000). Freeze and limit changes go to Lithic
(`PATCH /v1/cards/:token`), so the next payment is refused there. The card number never touches
Kova: `/dollar-card/reveal` returns a five-minute link to Lithic's own embedded card frame, signed
with the API key. Lithic's Auth Stream Access calls `POST /v1/dollar-card/authorizations`
(verified like Lithic webhooks: `webhook-id`, `webhook-timestamp`, `webhook-signature`), and Kova
approves only when the card is open and the wallet's AUSD balance covers it.

What production still needs: settling card spend from the wallet. The authorization already checks
the balance; moving the AUSD (for example a KovaCard-style allowance the card program pulls from)
is the step the card program agreement decides.

**Savings.** `KovaSaver` (`apps/card/contracts/src/KovaSaver.sol`) moves dollars in with one EIP-3009
`receiveWithAuthorization` naming the saver (only the saver can carry it out, and the vault shares
go to the signer), and out with an EIP-2612 permit on the vault shares (redeemed only back to the
owner, even if the permit is front-run). AUSD on Monad testnet and mainnet supports both
(`RECEIVE_WITH_AUTHORIZATION_TYPEHASH` and `PERMIT_TYPEHASH` read on-chain). `KovaTestVault` is a
testnet-only ERC-4626 vault whose "test interest" is test dollars Kova adds, labelled as such in the
app.

The largest AUSD yield venue on Monad mainnet, Upshift's earnAUSD
(`0x36eDbF0C834591BFdfCaC0Ef9605528c75c406aA`, lending to Curvance, Euler, Neverland and Morpho), is
not a plain ERC-4626 vault (its share reads revert, and withdrawals queue for up to 72 hours), so it
would need its own adapter. Euler, Morpho and Curvance AUSD vaults are ERC-4626 and plug straight in.

## Running and checking

```bash
# Contracts
cd apps/card/contracts && forge test --match-contract KovaSaverTest
AUSD=0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC forge script script/DeploySavings.s.sol \
  --rpc-url monad_testnet --private-key $KEY --broadcast   # prints KOVA_SAVINGS_VAULT and KOVA_SAVER

# API tests (Bridge and Lithic stubbed with their documented responses)
pnpm --filter @kova/api exec vitest run test/money.test.ts

# Savings end to end, once the API has KOVA_SAVINGS_VAULT and KOVA_SAVER
FUNDER_KEY=0x… pnpm --filter @kova/api check:savings http://localhost:4414
```
