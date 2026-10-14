# Keys: who may spend a wallet's dollars

Everything that spends a Kova wallet's dollars, short of the wallet itself, gets its own key with its
own limit. On Monad, every key is linked to the owner's wallet through the **KovaCard contract**
(`apps/card/contracts/src/KovaCard.sol`), exactly as a Kova Card is:

- the owner signs the link with their passkey, and the first time a permit that lets the contract
  draw on the wallet (EIP-2612; Kova relays both, so nobody needs MON);
- Monad caps what the key can spend in a day, and refuses it while it's frozen;
- a payment needs the key's signature **and** Kova's cosigner's, so neither can pay alone;
- the owner can freeze, unfreeze or remove a key by signature (relayed), or call the contract
  directly without Kova.

Kova never holds anyone's dollars. Before it cosigns, Kova checks the rest: a weekly total, the end
date, the most one payment can be, who the key may pay, and for an agent, asking the owner first.

| Kind | Who holds the key | What Kova adds |
|---|---|---|
| **Allowance** (Mum) | The recipient's own phone or browser. The key is the hash of a signature from the recipient's wallet (`spendKeyMessage`), so it is never stored anywhere and the same passkey makes it again on any device. | The invite: a one-time link (`/a/<code>`). |
| **Team** (someone at your till) | The same, on the team member's phone. | A daily budget. |
| **AI agent** (Claude) | Kova, sealed with AES-256-GCM under `KOVA_KEYS_MASTER_KEY`. The agent holds only a token, shown once. | The most one payment can be, who it may pay, and asking the owner above a line. Every payment, refusal and question is logged. |
| **Kova Card** | The card's chip (Arx HaLo). | The PIN and the till. |

## An agent pays

1. **Keys → New agent key** sets the limit a day, the most one payment can be, the ask-first line and
   how long it lasts. Face ID signs the key's limit onto Monad; Kova pays the fee and shows the
   token once, with the line that connects Claude Code:

   ```sh
   claude mcp add --transport http kova https://<api>/mcp --header "Authorization: Bearer kova_agent_…"
   ```

2. The MCP tools are `kova_status`, `kova_pay`, `kova_pay_charge` (a Kova till's QR or pay link),
   `kova_payment` and `kova_history`. The same actions are plain HTTP under `/v1/agent/*`.
3. A payment over the ask-first line waits: the owner's Home shows "Claude wants to pay $1.50" with
   Approve and Decline, each signed by the owner's wallet.

## An allowance

The owner makes an invite (who it's for, how much a day or a week, how long) and shares the link. The
recipient opens it in Kova (the app, or mykova.app), their wallet makes the key, and the key signs
KovaCard's Claim so nobody can link a key they don't hold. The owner switches it on with Face ID.
From then on the recipient's Home shows "From Ada: $24 left this week" with Spend, which pays from
Ada's wallet, signed by the recipient's key and cosigned by Kova.

## API

Owner (public; every write is signed): `GET /v1/wallets/:address/keys` (`data` = keys given, with
`?kind=allowance|team|agent`; `received`; `approvals`), `POST /v1/wallets/:address/key-invites`,
`POST /v1/wallets/:address/agents`, `GET|POST /v1/wallets/:address/keys/:id/{link → activate,
freeze, remove}`, `GET /v1/wallets/:address/key-payments`, `POST /v1/wallets/:address/approvals/:id`.
Recipient: `GET /v1/key-invites/:code`, `POST /v1/key-invites/:code/accept`, `POST
/v1/keys/:id/payments`, `POST /v1/key-payments/:id/complete`. Agent: `/mcp`, `/v1/agent/*`.

## Check it

```sh
OWNER_KEY=0x… pnpm --filter @kova/api check:keys http://localhost:4411
```

Runs on Monad testnet: an agent switched on, paying over MCP, asking first, refused over its limit
and while frozen, then removed; and an allowance accepted on another wallet and spent from. The
API's relayer needs a little testnet MON, and `OWNER_KEY` a dollar or so of test AUSD.
