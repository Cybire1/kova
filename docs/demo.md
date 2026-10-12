# Demo video: Kova on Monad (2:50)

Rules (§4, §9): 3 minutes at most, public (YouTube, Loom or Vimeo), the product in actual
operation, not mockups or slides, and showing Monad interactions. Every number on screen comes
from a transaction made during the take, and the key moments cut to Monadscan.

Judges score product quality, technical excellence, Monad integration, track fit and impact (20%
each). The bounties want cross-border payments in AUSD (Agora, $10k), Privy sign-in and payment
($5k) and a CRE workflow (Chainlink, $3k). Each scene names what it proves.

**One idea, held all film: money that moves like a message.** The problem first (about a quarter),
then the product working, one beat per proof, ending on mainnet.

## Setup (before recording)

- **Phone:** the Kova iOS app on the Kova iPhone 16 Simulator (or a real iPhone), testnet build.
  A fresh wallet for Ada, funded from the faucet.
- **Laptop:** Chrome. One window as the friend abroad (Lucía, a fresh browser, no wallet), one
  as Ada's Bakery's dashboard (orders board), one on Monadscan.
- **Shop:** Ada's Bakery with 6 tables and a 5-stamp card; menu cleaned of duplicates.
- **Rates:** publish a fresh Chainlink report within the hour (`cre workflow simulate kova-rates
  --target staging-settings --broadcast` in `apps/rates`) so the label reads "a few min ago".
- **Mainnet proof:** one small AUSD send on mainnet (`pnpm mainnet:check` in apps/api) the same
  day, for the closing explorer shot.
- **Recording:** screen captures at 1080p, notifications off. Voiceover recorded separately
  (calm, short), captions for every line.

## Script

| Time | Shot | Voiceover | Proves |
|---|---|---|---|
| 0:00–0:12 | Black, then a phone: a bank transfer form, "3–5 business days", "fee $25". Cut to a café queue and a buzzer that never lights. | "Sending $20 to a friend abroad still takes days and a fee. Paying for a coffee still means a queue and a card machine." | Problem (track fit) |
| 0:12–0:24 | Phone, Kova Home. Make a wallet: name "Ada" → Face ID → Home, $5 lands. | "Kova is a dollar wallet that lives behind your Face ID. No seed phrase, no gas token, dollars that settle on Monad in about a second." | Passkey wallet, product quality |
| 0:24–0:58 | **Send by link.** Send → "Send as a link" → $20, note "Birthday coffee 🎂" → share to WhatsApp. Laptop: Lucía opens the link: "Ada sent you $20.00, about €18.40 (Chainlink rate, 3 min ago)" → "Claim with email" (Privy) → "It's yours, 0.7 s". Cut: Monadscan, the claim tx, gas paid by Kova. | "Ada sends Lucía twenty dollars with a link. Lucía has no wallet and no app. She opens it, sees it in euros at a rate Chainlink publishes on Monad, claims it with her email, and it's hers in under a second." | **Agora cross-border (AUSD), Privy, Chainlink CRE**, Monad |
| 0:58–1:12 | Phone: Ada's link list: "Claimed by Lucía". Lucía's side: she pays it on, or keeps it. | "Unclaimed links come back to the sender. Nothing is lost in an envelope." | Completeness |
| 1:12–1:52 | **A café, from the table.** Phone scans table 3's code → Ada's Bakery opens with "Table 3" → flat white + croissant → Face ID → "Paid 0.76 s". Laptop: the orders board pings "Table 3"; the shop taps Ready. Phone: "Your order is ready. We're bringing it to table 3." | "At a café, the table is the counter. Order and pay from your seat. The shop sees table three, taps ready, and your phone tells you. No queue, no buzzer, no card machine." | Consumer payments, shop OS, product quality |
| 1:52–2:10 | Phone: the stamp card fills over visits (time-lapse of real orders) → "Your next croissant is free" → pays $0.00 → Monadscan: the $0 receipt. | "Regulars collect stamps without signing up: the wallet that pays is the card. The sixth is free, and even that has a receipt on Monad." | Innovation |
| 2:10–2:30 | **Private takings.** Monadscan: the shop's old address, every sale listed, anyone can add them up. Phone: Stall → Private takings on (Face ID). Two sales → Monadscan: each to a different fresh address. Phone: "Private takings $8.25 · Move to wallet" → moved in 1 s. Laptop: the accountant's view link: every sale and the total, "can't move money". | "On a public chain anyone can add up a shop's sales. With private takings, every sale goes to its own address that only the shop can open, and the accountant gets a view that can't move a cent. It's the idea of Monad's Private Settlement, built with standards that run on Monad today." | Innovation, Monad's privacy direction |
| 2:30–2:45 | Monadscan on **mainnet**: Kova's relayer, the KovaCard contract, a live AUSD payment; KovaRates on testnet with the Chainlink report. | "This is live on Monad mainnet today. The payments, the links and the rates are all on Monad." | Monad integration (load-bearing) |
| 2:45–2:50 | Kovi waves. mykova.app. | "Kova. Tap. Paid. Anywhere." | Close |

## Rules for the edit

- No fake numbers: times and amounts are whatever the take produced. If something takes 1.4 s,
  say "about a second".
- Show the explorer at least three times (claim, table payment, mainnet).
- Cut on the moment money moves: the slide, the Face ID, the claim.
- Captions for key numbers ("0.7 s", "$0.00 fee", "€18.40"), in Kova's Manrope.
- Export 1080p, under 3:00; upload public (YouTube, unlisted is not enough); link it in the
  README and the submission.
