# AGENTS.md

A map of Kova for AI agents and reviewers: what it is, where each part lives, where Monad is
load-bearing, and how to check all of it. The story and every proof transaction are in
[README.md](README.md); decisions and their reasons are in [DECISIONS.md](DECISIONS.md).

## Kova in five lines

- A dollar wallet and a shop till in one app. Balances and payments are **AUSD** (Agora) on **Monad**.
- **Payments are signatures.** The payer signs an EIP-3009 `transferWithAuthorization`; Kova's
  relayer submits it and pays the gas, so nobody holds MON. About a second from tap to paid.
- **Wallets are passkeys** (Face ID), with keys derived through WebAuthn PRF. No seed phrase.
- **Private payments** use ERC-5564 stealth addresses with sealed notes; **every key that spends**
  (a card, an allowance, an AI agent over MCP, a teammate) has its own limit, enforced on Monad.
- Live: [mykova.app](https://mykova.app) (Monad mainnet) and
  [web-monad.up.railway.app](https://web-monad.up.railway.app) (testnet); an iOS beta on TestFlight.

## Repo map

| Path | What it is |
|---|---|
| `apps/api` | The Kova API: Hono on Node 22, Postgres via Drizzle. Entry `src/index.ts`; one route file per area in `src/routes` (intents and checkout, wallet, takings, spend keys, `mcp`, business, naira, travel, …). |
| `apps/api/src/relay.ts` | The only code that spends the relayer's MON: estimate, sign locally, `eth_sendRawTransactionSync`. Owns the nonce. |
| `apps/api/src/workers` | `watcher.ts` indexes AUSD transfers and settles charges by the reference in the authorization's nonce; `announcer.ts` posts ERC-5564 announcements; `webhooks.ts` delivers merchant webhooks. |
| `apps/web` | mykova.app: Next.js 16, React 19. The web wallet (`src/components/wallet`), shop mode (`/dashboard`), pay pages (`/pay/:id`), stalls (`/s/:slug`). Every API call is made server-side. |
| `apps/mobile` | The iOS app: Expo SDK 54, expo-router screens in `src/app`, UI in `src/ui`, logic in `src/lib`. Installs with **npm**, outside the pnpm workspace. |
| `apps/card/contracts` | `KovaCard` (spending keys: per-key daily limit, freeze, cosigner), `KovaSaver`, `KovaTestVault`. Foundry. |
| `apps/rates` | The Chainlink CRE workflow (`kova-rates/`) and the `KovaRates` contract it writes (`contracts/`). |
| `packages/monad` | Chain logic shared by the API, web and app: networks and tokens, EIP-3009 typed data (`authorization.ts`), stealth addresses (`stealth.ts`), sealed notes (`notes.ts`, `memo.ts`), the privacy router that picks where each payment comes from (`route.ts`), spending keys (`spend-keys.ts`), offline payments (`offline.ts`), encrypted vaults (`vault.ts`). |
| `packages/db` | Drizzle schema (`src/schema.ts`) and SQL migrations (`drizzle/`), applied on API start. |
| `packages/tempo` | From the earlier Tempo build. The Monad build doesn't use it. |
| `film` | The demo videos (Remotion). Not shipped code, so it sits outside the app lint. |
| `docs` | Design notes, research and the Metropolis checklist. |

## Where Monad is load-bearing

1. **Gasless payments:** `packages/monad/src/authorization.ts` builds the EIP-3009 authorization;
   `apps/api/src/relay.ts` relays it. Monad's cheap gas is what lets Kova pay it for every user.
2. **Settlement:** `apps/api/src/workers/watcher.ts` reads AUSD transfers and settles each charge
   by the reference carried in the authorization's nonce, whoever submitted it.
3. **Privacy:** `packages/monad/src/stealth.ts` (ERC-5564, scheme 1) and
   `apps/api/src/workers/announcer.ts` (the canonical announcer on Monad).
4. **Limits on every key:** `apps/card/contracts/src/KovaCard.sol`, `packages/monad/src/spend-keys.ts`,
   `apps/api/src/routes/spend-keys.ts`, and `apps/api/src/routes/mcp.ts` (AI agents pay over MCP).
5. **Rates:** `apps/rates` (Chainlink CRE writes signed reports to `KovaRates`; the API reads them).

Contract and token addresses, and a proof transaction for each feature, are in the README's
"How Kova uses Monad" and "New on Monad" sections.

## Check it

You need Node 22 (`.nvmrc`), pnpm 10, PostgreSQL 16 for the API tests, and Foundry for the
contracts. CI (`.github/workflows/ci.yml`) runs exactly this on every push:

```bash
git clone --recursive https://github.com/Cybire1/kova && cd kova   # or: git submodule update --init
pnpm install                         # also builds packages/*
pnpm typecheck                       # every workspace package
pnpm lint                            # Biome; `pnpm format` fixes formatting
pnpm --filter "./packages/*" test    # unit tests of the shared packages
DATABASE_URL=postgres://localhost:5432/kova_test pnpm --filter @kova/api test
pnpm --filter @kova/web build
(cd apps/mobile && npm ci && npx tsc --noEmit)
(cd apps/card/contracts && forge test) && (cd apps/rates/contracts && forge test)
```

Live checks that move test dollars on Monad testnet (they need a funded relayer; see the README's
"Run it"): `pnpm --filter @kova/api check:private`, `check:keys`, `check:business`,
`check:offline`, `check:naira`, `check:savings`.

## Conventions

- TypeScript, strict, everywhere. Biome formats (2 spaces, single quotes, no semicolons, 100
  columns) and lints with its recommended rules. `useExhaustiveDependencies` and
  `noArrayIndexKey` are warnings, and every `biome-ignore` carries its reason.
- Money is integer base units: AUSD has 6 decimals, so `1_000_000n` is $1.00. Never floats.
- Creating a charge takes an `Idempotency-Key`; a signed authorization can be used once (EIP-3009
  nonces); a charge settles only from a transfer the watcher reads on Monad.
- Secrets are never committed. Each app's `.env.example` lists its variables; production values
  live in Railway.
- The relayer's nonce has one owner, `relay.ts`. Never send from the relayer's key anywhere else.

## What's live, and what isn't

- **Live:** payments, shops and tills, sends and payment links, private sends and private
  receiving, offline payments, the Kova Card, spending keys (allowances, AI agents, teams), Kova
  for Business, naira in and out (Paystack test mode on testnet), and Chainlink rates.
- **Built, waiting on partners:** a US account number (Bridge), a dollar card (Lithic) and
  savings. They show "Request access" today.
