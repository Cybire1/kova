# Kova for Chrome: the Chrome Web Store listing

Everything to paste into the Chrome Web Store developer dashboard
(chrome.google.com/webstore/devconsole). The images are in this folder.

## The package

```bash
cd apps/extension && node build.mjs --store   # kova-chrome-0.1.0-store.zip
```

The store build leaves out the manifest's `key` (the store refuses it and gives the extension its
own ID). After the first upload, copy the ID the store shows and add it to the web app's
`NEXT_PUBLIC_KOVA_EXTENSION_IDS` on Railway, then redeploy the web app, or mykova.app won't answer
the store version.

## Store listing

**Name:** Kova

**Summary** (132 characters at most):

> Give every site a budget, not your wallet. Pay websites in dollars on Monad, with limits only you can change.

**Category:** Productivity. **Language:** English.

**Description:**

> Kova for Chrome is a wallet for websites, made so a site can never take more than you gave it.
>
> CONNECT WITHOUT RISK
> Connecting a site shows it your wallet's address and balance, like any wallet. Nothing more. It
> can't move a cent.
>
> A BUDGET, NOT YOUR WALLET
> The first time a site asks to be paid, Kova asks you for its budget: $5, $20, $50 or any amount, a
> day or a week. The limit is enforced on Monad by Kova's contract, so even a hacked site can only
> spend what you gave it.
>
> PAGES THAT COST A CENT
> When a page asks for a payment ("402 Payment Required", the x402 standard), Kova pays it from that
> site's budget and the page opens. Amounts under your line go through without asking; anything
> bigger asks first.
>
> ONE SWITCH STOPS IT
> See what every site has spent. Freeze one site, or all of them at once. Only your passkey or Google
> sign-in turns them back on.
>
> NO APPROVALS THAT NEVER END
> Kova refuses the open-ended token approvals and blind signatures most wallet drains start with.
>
> Kova for Chrome uses your Kova wallet (mykova.app and the Kova app), opened with a passkey or
> Google. No seed phrase, no gas to buy. Payments are in AUSD on Monad.

**Images:**
- Icon: `icon-128.png`
- Screenshots (1280×800): `screenshot-1.png` to `screenshot-4.png`
- Small promo tile (440×280): `promo-tile-440x280.png`

**Website:** https://mykova.app/chrome

## Privacy practices

**Single purpose:**

> Kova for Chrome lets websites request payments from a user's Kova wallet, and limits each website
> to a budget the user approves.

**Permission justifications:**

| Permission | Why |
|---|---|
| `storage` | Keeps the connected wallet's address, the sites the user connected, and each site's budget key, on the user's computer. |
| `webRequest` | Reads the response headers of pages the user opens, only to notice a page asking for a payment (HTTP 402 with a PAYMENT-REQUIRED header). Nothing is recorded or sent. |
| `declarativeNetRequestWithHostAccess` | After the user's budget pays a page, adds the payment header to that one page's reload, in that one tab, then removes the rule. |
| Host permission `<all_urls>` | Kova works on any website the user chooses to connect or pay: the wallet provider is offered to every page, and a pay-per-use page can be on any site. |
| Remote code | None. All code ships in the package. |

**Data usage** (tick these in the form):
- **Personally identifiable information:** yes. The name on the Kova wallet goes to Kova's API with
  a new budget, so the Kova app can show whose it is.
- **Financial and payment information:** yes. Payments the user approves (amount, recipient, the
  site) go to Kova's API to be carried out on Monad.
- **Website content:** yes, for pay-per-use pages only: the address of a page the user pays for is
  kept with that payment.
- Everything else (personal communications, location, web history, user activity, health,
  authentication information): no. Each site's budget key is made in the extension and never leaves
  the computer.

Certify: not sold to third parties; not used for anything unrelated to the single purpose; not used
to decide creditworthiness or for lending.

**Privacy policy:** https://mykova.app/privacy (it has a "Kova for Chrome" section).

## Before you submit

1. A $5 Chrome Web Store developer account, in the name you want shown as the publisher.
2. A real test: reload the extension, open mykova.app/chrome, connect, send the 10¢ tip, open the
   1¢ article.
3. Review usually takes a few days. Wallet extensions often get extra questions about permissions;
   the justifications above answer them.
