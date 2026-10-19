# Kova features and integrations

What Kova does, what it will do next, and the problem each piece solves. Every feature ships the same
way: a real problem first, a finished flow on the phone and the web, real on-chain proof, and screenshots
checked before it is called done. Status as of 1 October 2026.

## Built and live

| Feature | Integration | The problem it solves |
|---|---|---|
| Passkey wallet: Face ID, no seed phrase | Mera (WebAuthn PRF) | People lose seed phrases, and crypto wallets scare them |
| The same wallet on iPhone and at mykova.app | Mera + iCloud Keychain | One account everywhere, with nothing to log in to |
| Encrypted backup of name, contacts, settings | Mera's second, passkey-derived key | A lost phone means lost details |
| Gas-free payments and sends | Kova's relayer on Monad (EIP-3009) | Nobody should have to buy MON before paying for coffee |
| Paid in about 1.5 s | Monad | A checkout line can't wait |
| Prices in your own currency | Reference rates (fixed table today) | People think in naira and euros, not dollars |
| Your shop inside your wallet: stall page, catalogue, till, orders, takings | Kova API | A small shop needs a till without buying hardware |
| Shop sign-in on the web with the same passkey | Sign-In with Ethereum (EIP-4361) | Shop owners juggle passwords and API keys |
| Guest checkout with email or Google | Privy embedded wallets | A customer without Kova can't pay at the counter |
| $5 of test dollars a day | Kova's testnet treasury | Agora's testnet faucet is empty |
| Kova Travel: flights and hotels in dollars | Duffel | Paying abroad in dollars is hard |
| Snap your menu | Claude / DeepSeek | Typing a whole menu into a till is slow |
| Spending insights | TypeSafe's Jev | Knowing where the money went |
| Link previews, a way out of in-app browsers | mykova.app | Shared links looked bare; passkeys fail inside X |

## Next, in build order

Each one: the problem, what done means, how it is proven.

### 1. Paid in under a second · done
- **Result (1 Oct):** server relay 384–520 ms (was 514–704); tap to paid measured from Lagos 0.91–1.05 s (was 1.3–1.6 s). One round-trip to check (estimate with fees and a locally counted nonce alongside), a local signature, one `eth_sendRawTransactionSync`. Test dollars share the same send path, so the nonce has one owner.
- **Problem:** Monad finalises in about 0.6 s, but Kova's receipts show 1.3 to 1.6 s. The rest is our own round-trips.
- **Done:** measure every step of a payment (sign, request, simulate, submit, receipt), remove what isn't needed, and show "Paid" as soon as the chain has the transaction. The receipt shows the real time.
- **Proof:** five payments on testnet, timed end to end, before and after.

### 2. Send in one sheet · done
- **Result (1 Oct):** on iOS, one form sheet over Home sized to each step (who, amount with their currency, review with Kovi flying the arc from your face to theirs, slide to send, Sent with the measured time); it settles low at the end so Home's balance shows behind it, counting down. The web has the same sheet over the web wallet's Home (keyboard: Enter on the knob sends). Real testnet sends: iPhone simulator $2.50 in 1.27 s and $1.00 in 1.29 s (the wallet's chain balance went 5.00 → 1.50); web, headless Chrome with a passkey, $2.50 in 1.03 s.
- **Problem:** sending money takes several full screens; it feels slow before it is slow.
- **Done:** on iOS, one sheet over Home: person, amount (with their currency), review (you, Kovi's arc, them, $0.00 fee), slide to send, and the same sheet turns into "Sent" with the measured time, while the balance behind it drops live. Then the same on the web.
- **Proof:** screenshots of every step on the simulator and the web, and a real send on testnet.

### 3. Private payment notes · done
- **Result (1 Oct):** each wallet publishes an X25519 note key derived from its passkey's vault secret and signed by the wallet (senders check the signature, so Kova can't swap keys). A note is sealed on the sender's device twice, for the receiver and for the sender, bound to the transfer (from, to, amount, EIP-3009 nonce), and stored by Kova as ciphertext only. The app opens notes without Face ID (the key can't move money); the web keeps the key in memory, so after a reload notes are sealed until the passkey opens them. Proven on testnet: web → phone ("Puff-puff for the road") and phone → web ("Thanks Ada!") both open on the other side; the ciphertext Kova returns opens for neither a third wallet nor a different transfer. `pnpm --filter @kova/web check:notes` checks app/web interop; API tests cover the key and note routes.
- **Problem (was):** a note on a send stayed on the sender's phone, so the receiver never saw it; sending it through Kova in the clear would have let Kova read it.
- **Done:** notes are encrypted with a key derived from the sender's passkey (Mera PRF) and shared with the receiver, so only the two of them can read them. Kova stores ciphertext only.
- **Proof:** the database row shows ciphertext; both wallets show the note; a third wallet can't.

### 4. From guest to Kova · done
- **Result (1 Oct):** after paying a charge with email or Google (Privy), the pay page stays put and offers "Keep your $0.50 in Kova": one passkey makes a Kova wallet, the email wallet signs one EIP-3009 transfer of everything left into it (Kova's relayer pays the gas), the email wallet is signed out, and "Open my Kova wallet" lands on Home with the dollars there. Proven on testnet with a localhost stand-in for Privy's embedded wallet (`/pay/<id>?guest=dev`, localhost only): paid $4.50 of $5, moved the $0.50 in 1.29 s, Home showed $0.50. Not yet run with a real Privy email sign-in.
- **Problem:** someone who paid once as a guest (Privy, email) has a leftover balance they'll forget.
- **Done:** after a guest payment, "Keep your dollars in Kova": create a passkey wallet in one step and move the guest balance into it, gas paid by Kova.
- **Proof:** a guest wallet's balance arrives in a new Kova wallet on testnet.

### 5. Live exchange rates · done
- **Result (1 Oct):** `KovaRates` deployed to Monad testnet at `0xb5322DC6d6AA938C50859f0f0e2DF7b6Da4C9e8e` (tx `0xf097ea34…`; redeployed 2 Oct to refuse reports dated in the future); the CRE workflow fetched both sources, agreed on NGN 1,328.02, KES 129.03, EUR 0.8855, GBP 0.7560, MXN 18.184, and wrote them on-chain (report tx `0x982e904589b29fd3a76d0773bb66aa9346eb49ecfaa8faa7f59b4e09c4fc7694`). The API reads the contract (`source: chainlink`), and the app shows "1 USD ≈ 1,328 NGN, Chainlink rate from 3 min ago". Reports are published with `cre workflow simulate --broadcast` until Chainlink enables DON deploy access for the account (`cre account access`), after which it runs every 15 minutes on its own.
- **Problem:** local prices come from a fixed table, labelled "reference rate".
- **Done:** deploy `KovaRates` on Monad testnet; the Chainlink CRE workflow (`apps/rates`) publishes rates from two sources with consensus; the API reads the contract; the app says "Chainlink rate from 4 min ago".
- **Proof:** the contract address, a report transaction, and the app showing a live rate.

### 6. Crypto deposits · enabled on mainnet; funded proof pending
- **Updated (18 Oct):** Add money → Deposit crypto defaults to MON on Monad. A live provider catalogue offers supported solver tokens on selected EVM networks, Solana, Tron and Bitcoin. Users preview AUSD received, then copy/scan a token-and-network-specific deposit address. Refunds, route fees, per-deposit status and recovery are included. The new flow uses Relay and always pins Monad mainnet AUSD.
- **Availability:** `RELAY_API_KEY` is configured on the mainnet API. Authenticated tracking and live unfunded quotes passed for all 11 offered networks, including Solana. The entry is enabled on the web and in iOS build 14. Mainnet, capability and tracking-readiness gates apply. No real funds have been transferred to validate settlement.
- **Why the provider changed:** NEAR 1Click's current token list still lacks AUSD on Monad. The legacy Aurora helpers remain separate from the new flow.
- **Setup, API, checks and limits:** [multichain-deposits.md](multichain-deposits.md).

### 7. Card top-up · built, waiting on a Ramp key and mainnet (shown on mainnet only)
- **Built (1 Oct):** Ramp Network lists AUSD on Monad itself (`MONAD_AUSD`, `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a`, €6.25 to €15,000), for buying and for selling, so a top-up lands as the same dollars every Kova payment moves, with no swap. Add money → Card or bank opens Ramp's hosted checkout (in-app browser on iOS, a new tab on the web) set to AUSD on Monad, this wallet's address and the person's currency (USD, EUR, GBP or MXN; others pay in USD). API: `GET /v1/wallets/:address/top-up` builds the link server-side; on testnet, or without `RAMP_HOST_API_KEY`, it says "mainnet". Tested: the link's parameters (API tests); without a key Ramp's widget shows "integration issue", so a key is required even to try it.
- **Problem:** there is no way to put money into Kova with a card or bank.
- **Done:** "Add money → Card or bank" with Ramp Network, buying AUSD on Monad straight into the Kova wallet.
- **Proof:** a sandbox purchase landing in a Kova wallet.
- **Needs from you:** a Ramp Network partner key.

### 8. Cash out · built, waiting on a Ramp key with off-ramp enabled (shown on mainnet only)
- **Built (1 Oct):** Profile → Cash out (iOS opens mykova.app/wallet/cash-out in the in-app browser, where the same passkey opens the same wallet; the web has it on Profile). The page opens Ramp's off-ramp for AUSD on Monad, paid out in the person's currency, and answers Ramp's send-crypto callback with an ordinary Kova send to Ramp's address: gas-free, approved with the passkey. API: `GET /v1/wallets/:address/cash-out` serves the settings with the key server-side; "mainnet" until then.
- **Checked (1 Oct):** Ramp's off-ramp lists AUSD on Monad. Ramp requires a production key with off-ramp switched on for it, and its native flow for mobile wallets (the wallet sends AUSD to Ramp when the widget asks), which Kova's gasless send fits.
- **Problem:** there is no way to take money out of Kova.
- **Done:** "Cash out" with Ramp's off-ramp, from AUSD on Monad to a bank or card.
- **Proof:** a sandbox off-ramp from a Kova wallet.
- **Needs from you:** the same Ramp key.
