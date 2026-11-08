# Compliance

Where Kova stands, what was done, and what's still open. Not legal advice: the open questions are
for a lawyer and for Kova's partners.

## How money moves today

| Flow | Who holds or exchanges the money | Identity check |
|---|---|---|
| The wallet (send, receive, pay, shops) | Nobody but the person: self-custody, keys from their passkey or Google | None needed |
| Naira in and out | PAJ (licensed): AUSD is swapped in KovaCashOut, which holds nothing, and USDC goes straight to PAJ, which pays the naira | PAJ's |
| Cash-out to banks abroad | Kova's Nuvion account funds the person's own verified Nuvion account, which pays the bank in their name (`KOVA_PAYOUTS_OWN_NAME=1`) | Nuvion's, before the first cash-out |
| Dollar card | Nuvion, on the person's own verified account | Nuvion's |
| Pay-per-use pages (Kova for Chrome) | Kova's x402 float, for the seconds between the site's budget paying it and the site collecting | The site's budget, approved by the person |
| Stocks (xStocks) | Buying paused (`KOVA_STOCKS_BUYING=0`); selling still open | Country check and self-certification |

## Done (8 November 2026)

- Cash-outs abroad need Nuvion's ID check first and go out from the person's own account, in their name.
- Stock buying paused everywhere; stocks taken off the website's marketing.
- Cash-outs abroad and the dollar card refused from Cuba, Iran, North Korea, Syria, Russia and Belarus (by IP).
- Terms updated: licensed partners, ID checks and limits, Kova for Chrome, paused stocks, and a ban on breaking a country's rules on moving money.
- Privacy policy covers Kova for Chrome. The private-payments line no longer says "only they can see it".

## Open

1. **Nigeria's SEC:** does Kova itself need to register (or join the ARIP incubation programme) as a
   self-custody wallet that routes to licensed partners? See `lawyer-brief.md`.
2. **Nuvion:** which licence covers Kova's payouts, and can each person's own account take
   stablecoins on Base, so Kova never exchanges money? See `nuvion-email.md`.
3. **PAJ:** a copy of their licence for Kova's files. See `paj-email.md`.
4. **The full fix for cash-outs abroad:** once Nuvion confirms, the person's AUSD goes to their own
   Nuvion stablecoin account on Base (Kova's existing send-to-any-network), and Nuvion turns it into
   dollars and pays the bank. Kova never holds or exchanges it.
5. **Marketing:** no "buy stocks", no "move money out of [country]", no "anonymous" or "no KYC", in
   posts, bios and replies.
