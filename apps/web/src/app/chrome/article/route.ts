import { explorerTxUrl, networks, readPaymentSignature } from '@kova/monad'
import { cookies, headers } from 'next/headers'
import { isAddressEqual, isHex } from 'viem'
import { kovaPublic } from '@/lib/api'
import { network } from '@/lib/network'
import {
  ARTICLE_COOKIE,
  ARTICLE_PRICE,
  articleAccess,
  articleRequirement,
  hasArticleAccess,
  paymentRequired,
  tryPayTo,
} from '@/lib/try-chrome'
import { publicUrl } from '@/lib/url'

export const dynamic = 'force-dynamic'

interface Collection {
  transaction: string | null
  network: string
  payer: string
  already: boolean
}

/**
 * mykova.app/chrome/article: a 1¢ article, paid the x402 way. Unpaid, it answers 402 with a
 * PAYMENT-REQUIRED header (what it costs, in AUSD on Monad, and who to pay). Kova for Chrome reads
 * that, pays from mykova.app's budget, and loads the page again with PAYMENT-SIGNATURE: Kova's
 * signed transfer. This checks it's for this article, has Kova collect it on Monad, and opens the
 * article for a day.
 */
export async function GET() {
  const payTo = tryPayTo()
  if (!payTo) return page(offPage(), 503)
  const jar = await cookies()
  if (hasArticleAccess(jar.get(ARTICLE_COOKIE)?.value)) return page(articlePage(null), 200)

  const url = `${await publicUrl()}/chrome/article`
  const requirement = articleRequirement(payTo)
  const asked = (error?: string) =>
    page(askPage(error), 402, { 'payment-required': paymentRequired(requirement, url, error) })

  const header = (await headers()).get('payment-signature')
  if (!header) return asked()

  const paid = readPaymentSignature(header)
  const fits =
    paid &&
    paid.accepted.network === requirement.network &&
    isAddressEqual(paid.accepted.asset, requirement.asset) &&
    isAddressEqual(paid.authorization.to, payTo) &&
    paid.authorization.value >= ARTICLE_PRICE
  if (!fits) return asked('That payment isn’t for this article.')

  let collected: Collection
  try {
    collected = await kovaPublic<Collection>('/v1/x402/collect', {
      method: 'POST',
      body: JSON.stringify({ payment: header }),
    })
  } catch (error) {
    return asked(error instanceof Error ? error.message : 'The payment didn’t go through.')
  }
  const tx = collected.transaction && isHex(collected.transaction) ? collected.transaction : null
  const extra: Record<string, string> = {
    'payment-response': Buffer.from(
      JSON.stringify({
        success: true,
        transaction: tx,
        network: collected.network,
        payer: collected.payer,
      }),
    ).toString('base64'),
  }
  const access = articleAccess()
  if (access)
    extra['set-cookie'] =
      `${ARTICLE_COOKIE}=${access}; Path=/chrome/article; Max-Age=86400; HttpOnly; Secure; SameSite=Lax`
  return page(articlePage(tx), 200, extra)
}

function page(body: string, status: number, headers: Record<string, string> = {}) {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  })
}

const html = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  )

/** Kova's Tap K mark (components/brand.tsx). */
const MARK = `<svg viewBox="0 0 200 200" width="26" height="26" aria-hidden="true"><path d="M62 46 V154" stroke="currentColor" stroke-width="19" stroke-linecap="round"/><g stroke="#d46558" stroke-width="17" stroke-linecap="round" fill="none"><path d="M92.6 74.3 A40 40 0 0 1 92.6 125.7"/><path d="M115.6 55 A70 70 0 0 1 115.6 145"/><path d="M138.6 35.7 A100 100 0 0 1 138.6 164.3"/></g></svg>`

/** The article: a teaser anyone sees (blurred behind the price), and the rest once it's paid. */
const TITLE = 'Dollars for every phone'
const LEDE =
  'You just paid a cent to read this. No account, no card, no checkout. Here’s what made that possible, and what else Kova does.'
const TEASER = [
  'Kova is a dollar wallet and a shop till in one app. Your money is held as dollars (AUSD) on Monad, a fast blockchain, and you open the wallet with Face ID or Google. There’s no seed phrase to write down and no gas to buy.',
  'Paying is a signature. You tap, Face ID says yes, and Kova carries it to Monad and pays the network fee for you. It’s paid in about a second, whether it’s a coffee, a friend, or a page like this one.',
]
const SECTIONS: { h: string; p: string[] }[] = [
  {
    h: 'Made for every phone',
    p: [
      'Not everyone has the newest phone or a good signal, so Kova works the way people actually live.',
      'Pay privately: each private payment goes to a one-time address, with a sealed note only the two of you can read. Pay with no signal: the payment is signed now and carried as a code, and it settles when a phone is back online. And on a basic phone with no internet at all, Kova works by dialling a short code and following a menu.',
    ],
  },
  {
    h: 'A key for every job, each with its own limit',
    p: [
      'Kova’s idea is simple: nothing should be able to spend your whole wallet except you. So every key that can spend gets its own limit, written on Monad by Kova’s contract.',
      'A tap-to-pay card. An allowance for your kid. An AI agent that pays for things on your behalf. A teammate at your shop. And websites: the cent you just paid came out of mykova.app’s own budget in Kova for Chrome. If any of them goes wrong, it can spend its limit and nothing more, and one switch freezes it.',
    ],
  },
  {
    h: 'Money in, money out',
    p: [
      'You can add naira and cash out to a Nigerian bank through a licensed partner. You can cash out to bank accounts in more than 35 countries after a one-time ID check, so every cash-out goes out in your own name. And you can spend anywhere cards work with a dollar card.',
    ],
  },
  {
    h: 'A till in your pocket',
    p: [
      'The same app is a shop. Take payments at a counter, send payment links, open a stall page with a menu, and see your takings as they land. Customers can pay with Kova, or with email or Google if they don’t have it yet.',
    ],
  },
  {
    h: 'Why Monad',
    p: [
      'Paying everyone’s network fee only works where fees are tiny and blocks are quick. On Monad, Kova can cover the fee for every payment and still have it settled in about a second. That’s what lets a single cent be worth sending.',
    ],
  },
]
const QUOTE = 'Nothing should be able to spend your whole wallet except you.'
const FACTS = [
  ['~1 second', 'from tap to paid'],
  ['$0', 'network fees for you'],
  ['0', 'seed phrases'],
  ['35+', 'countries to cash out to'],
] as const

function shell(title: string, main: string, back = '/chrome#try') {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${html(title)}</title>
<meta name="robots" content="noindex">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap">
<style>
:root{--bg:#f4f2ee;--tile:#eae7e1;--card:#fff;--ink:#0b1a1d;--muted:#5f6b6e;--line:rgba(11,26,29,.1);--coral:#d46558;--coral-wash:#f2ddd7;--teal:#46878b;--teal-wash:#d7e5e3;--dark:#0e1b1e;--on-dark:#ece8e1;--ease:cubic-bezier(.32,.72,0,1)}
@media (prefers-color-scheme:dark){:root{--bg:#0a0a0a;--tile:#171717;--card:#1a1a1a;--ink:#ece8e1;--muted:#9e998f;--line:rgba(236,232,225,.1);--coral-wash:#2a1712;--teal-wash:#12292a;--dark:#151515}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:Manrope,ui-sans-serif,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit}
header{max-width:760px;margin:0 auto;padding:22px 24px;display:flex;align-items:center;justify-content:space-between}
.brand{display:flex;align-items:center;gap:9px;font-weight:800;font-size:18px;letter-spacing:-.02em;text-decoration:none}
.back{font-size:14px;font-weight:600;color:var(--muted);text-decoration:none}
.back:hover{color:var(--ink)}
main{max-width:760px;margin:0 auto;padding:10px 24px 96px}
.tag{display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border-radius:999px;background:var(--tile);font-size:12.5px;font-weight:700;letter-spacing:.02em}
h1{font-size:clamp(40px,7vw,68px);line-height:1;letter-spacing:-.045em;margin:20px 0 18px;font-weight:800}
.lede{font-size:21px;line-height:1.55;color:var(--muted);margin:0 0 22px;max-width:36em}
.byline{display:flex;align-items:center;gap:10px;font-size:14px;font-weight:600;color:var(--muted);margin-bottom:30px}
.byline .dot{width:4px;height:4px;border-radius:50%;background:var(--muted)}
.paid{display:flex;gap:12px;align-items:center;padding:14px 18px;border-radius:20px;background:var(--teal-wash);font-size:15px;font-weight:600;margin:0 0 40px;animation:in .9s var(--ease) both}
.paid a{font-weight:700}
.check{width:28px;height:28px;border-radius:50%;flex:none;background:var(--teal) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='m6 12.5 4 4 8-9' fill='none' stroke='white' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/15px no-repeat}
article p{font-size:19px;line-height:1.72;margin:0 0 22px}
article h2{font-size:28px;line-height:1.15;letter-spacing:-.03em;margin:52px 0 14px}
blockquote{margin:44px 0;padding:0 0 0 22px;border-left:4px solid var(--coral);font-size:clamp(26px,4vw,34px);line-height:1.2;letter-spacing:-.035em;font-weight:800}
.facts{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:48px 0 0}
.fact{padding:20px 18px;border-radius:22px;background:var(--tile)}
.fact b{display:block;font-size:30px;letter-spacing:-.04em;font-weight:800}
.fact small{display:block;margin-top:4px;font-size:13.5px;color:var(--muted);font-weight:600;line-height:1.35}
.end{margin-top:52px;padding:32px;border-radius:30px;background:var(--dark);color:var(--on-dark);display:grid;gap:14px}
.end strong{font-size:28px;letter-spacing:-.035em;line-height:1.1}
.end p{margin:0;font-size:16px;line-height:1.55;opacity:.75}
.btns{display:flex;flex-wrap:wrap;gap:10px;margin-top:6px}
.btn{display:inline-flex;align-items:center;justify-content:center;height:50px;padding:0 24px;border-radius:999px;background:var(--ink);color:var(--bg);font-weight:700;font-size:15px;text-decoration:none;transition:transform .4s var(--ease)}
.btn:active{transform:scale(.97)}
.end .btn{background:var(--on-dark);color:#0b1a1d}
.end .btn.soft{background:rgba(236,232,225,.12);color:var(--on-dark)}
/* The paywall: the start of the article, blurred, with the price over it. */
.wall{position:relative;margin-top:6px}
.teaser{filter:blur(5px);opacity:.5;user-select:none;pointer-events:none;-webkit-mask-image:linear-gradient(#000 30%,transparent 92%);mask-image:linear-gradient(#000 30%,transparent 92%)}
.price{position:absolute;left:50%;top:40px;transform:translateX(-50%);width:min(460px,100%);padding:30px 28px;border-radius:30px;background:var(--card);box-shadow:0 0 0 1px var(--line),0 40px 80px -36px rgba(11,26,29,.45);animation:rise .9s var(--ease) both}
.price .cent{font-size:76px;font-weight:800;letter-spacing:-.06em;line-height:1;margin:16px 0 4px}
.price p{font-size:16.5px;line-height:1.6;color:var(--muted);margin:10px 0}
.price .btn{margin-top:14px}
.err{padding:12px 14px;border-radius:14px;background:var(--coral-wash);font-size:15px;font-weight:600;margin:14px 0 0;color:var(--ink)!important}
.fine{font-size:13px!important;margin-top:18px!important}
code{font-family:"JetBrains Mono",ui-monospace,Menlo,monospace;font-size:.88em;background:var(--tile);padding:2px 6px;border-radius:6px}
@keyframes in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes rise{from{opacity:0;transform:translate(-50%,18px)}to{opacity:1;transform:translateX(-50%)}}
@media (max-width:640px){.facts{grid-template-columns:repeat(2,1fr)}.price{position:relative;left:0;top:0;transform:none;margin-top:-140px}@keyframes rise{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}.end{padding:24px}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>
</head>
<body>
<header><a class="brand" href="/">${MARK}kova</a><a class="back" href="${back}">Back to the demo</a></header>
<main>${main}</main>
</body>
</html>`
}

/** Before it's paid, the lede says what the cent buys; after, what just happened. */
const ASK_LEDE =
  'What Kova is, what it does for every kind of phone, and why a single cent is now worth sending. One cent to read.'
const intro = (lede: string) => `<span class="tag">A 1¢ article · Kova</span>
<h1>${html(TITLE)}</h1>
<p class="lede">${html(lede)}</p>`

function askPage(error?: string) {
  return shell(
    `1¢ to read: ${TITLE} · Kova`,
    `${intro(ASK_LEDE)}
<div class="wall">
<div class="teaser" aria-hidden="true">${TEASER.map((t) => `<p>${html(t)}</p>`).join('')}<p>${html(SECTIONS[0]?.p[0] ?? '')}</p></div>
<section class="price" aria-labelledby="price-title">
<span class="tag">HTTP 402 · Payment required</span>
<div class="cent" id="price-title">1¢</div>
<p><b>This article costs one cent.</b> No account, no card, no subscription.</p>
<p>With Kova for Chrome, it’s paid from mykova.app’s budget, in AUSD on Monad, and the page opens by itself.</p>
${error ? `<p class="err">${html(error)}</p>` : ''}
<a class="btn" href="/chrome#get">Get Kova for Chrome</a>
<p class="fine">This page answered <code>402 Payment Required</code> with its price in a <code>PAYMENT-REQUIRED</code> header. A wallet that speaks x402 pays it and asks again.</p>
</section>
</div>`,
  )
}

function articlePage(tx: string | null) {
  const receipt = tx
    ? `<div class="paid"><span class="check"></span><span>You paid 1¢ to read this. <a href="${explorerTxUrl(networks[network], tx as `0x${string}`)}" target="_blank" rel="noopener">See it on Monad</a></span></div>`
    : `<div class="paid"><span class="check"></span><span>Paid. This article stays open for a day.</span></div>`
  const body = [
    ...TEASER.map((t) => `<p>${html(t)}</p>`),
    ...SECTIONS.flatMap((section, i) => [
      `<h2>${html(section.h)}</h2>`,
      ...section.p.map((t) => `<p>${html(t)}</p>`),
      i === 1 ? `<blockquote>${html(QUOTE)}</blockquote>` : '',
    ]),
  ].join('\n')
  return shell(
    `${TITLE} · Kova`,
    `${intro(LEDE)}
<div class="byline"><span>Kova</span><span class="dot"></span><span>4 min read</span><span class="dot"></span><span>1¢</span></div>
${receipt}
<article>
${body}
</article>
<div class="facts">${FACTS.map(([b, small]) => `<div class="fact"><b>${html(b)}</b><small>${html(small)}</small></div>`).join('')}</div>
<section class="end">
<strong>Get Kova.</strong>
<p>The wallet, the till and every key with its limit. On the web now, and on your phone.</p>
<div class="btns"><a class="btn" href="/wallet">Open Kova</a><a class="btn soft" href="/android">Get it for Android</a></div>
</section>`,
    '/chrome?read=1#try',
  )
}

function offPage() {
  return shell(
    'Coming soon · Kova',
    `<section class="price" style="position:relative;left:0;transform:none;margin-top:8vh">
<span class="tag">Kova for Chrome</span>
<h1 style="font-size:40px">The 1¢ article isn’t switched on yet</h1>
<p>Kova hasn’t set up this demo’s payments on this server yet. Come back soon.</p>
<a class="btn" href="/chrome">Back to Kova for Chrome</a>
</section>`,
  )
}
