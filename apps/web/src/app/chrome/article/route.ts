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

function shell(title: string, main: string) {
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
:root{--bg:#f4f2ee;--tile:#eae7e1;--card:#fff;--ink:#0b1a1d;--muted:#5f6b6e;--line:rgba(11,26,29,.08);--coral:#d46558;--coral-wash:#f2ddd7;--teal:#46878b;--teal-wash:#d7e5e3}
@media (prefers-color-scheme:dark){:root{--bg:#0a0a0a;--tile:#171717;--card:#1a1a1a;--ink:#ece8e1;--muted:#9e998f;--line:rgba(236,232,225,.08);--coral-wash:#2a1712;--teal-wash:#12292a}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:Manrope,ui-sans-serif,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit}
header{max-width:720px;margin:0 auto;padding:22px 20px;display:flex;align-items:center;justify-content:space-between}
.brand{display:flex;align-items:center;gap:9px;font-weight:800;font-size:18px;letter-spacing:-.02em;text-decoration:none}
.back{font-size:14px;font-weight:600;color:var(--muted);text-decoration:none}
main{max-width:720px;margin:0 auto;padding:12px 20px 80px}
.tag{display:inline-block;padding:5px 11px;border-radius:999px;background:var(--tile);font-size:12px;font-weight:700;letter-spacing:.02em}
h1{font-size:clamp(34px,6vw,52px);line-height:1.04;letter-spacing:-.035em;margin:16px 0 14px;font-weight:800}
.lede{font-size:19px;line-height:1.55;color:var(--muted);margin:0 0 26px}
.paid{display:flex;gap:12px;align-items:center;padding:14px 16px;border-radius:18px;background:var(--teal-wash);font-size:15px;font-weight:600;margin:0 0 30px}
.paid a{font-weight:700}
.dot{width:9px;height:9px;border-radius:50%;background:var(--teal);flex:none}
article p{font-size:18px;line-height:1.7;margin:0 0 20px}
article h2{font-size:24px;letter-spacing:-.02em;margin:34px 0 12px}
.ask{margin-top:7vh;background:var(--card);border-radius:28px;padding:34px 30px;box-shadow:0 0 0 1px var(--line)}
.price{font-size:64px;font-weight:800;letter-spacing:-.05em;line-height:1;margin:18px 0 6px}
.ask p{font-size:17px;line-height:1.6;color:var(--muted);margin:10px 0}
.btn{display:inline-flex;align-items:center;justify-content:center;height:50px;padding:0 24px;border-radius:999px;background:var(--ink);color:var(--bg);font-weight:700;font-size:15px;text-decoration:none;margin-top:18px}
.err{padding:12px 14px;border-radius:14px;background:var(--coral-wash);font-size:15px;font-weight:600;margin:16px 0 0}
.fine{font-size:13.5px!important;margin-top:22px!important}
code{font-family:"JetBrains Mono",ui-monospace,Menlo,monospace;font-size:.9em;background:var(--tile);padding:2px 6px;border-radius:6px}
</style>
</head>
<body>
<header><a class="brand" href="/">${MARK}kova</a><a class="back" href="/chrome#try">Back to the demo</a></header>
<main>${main}</main>
</body>
</html>`
}

function askPage(error?: string) {
  return shell(
    '1¢ to read this · Kova',
    `<section class="ask">
<span class="tag">HTTP 402 · Payment required</span>
<div class="price">1¢</div>
<p><b>The cent that pays for the web.</b> This article costs one cent. No account, no card, no subscription.</p>
<p>With Kova for Chrome, it’s paid from mykova.app’s budget, in AUSD on Monad, and this page opens by itself.</p>
${error ? `<p class="err">${html(error)}</p>` : ''}
<a class="btn" href="/chrome#get">Get Kova for Chrome</a>
<p class="fine">This page answered <code>402 Payment Required</code> with a price in a <code>PAYMENT-REQUIRED</code> header. A wallet that speaks x402 pays it and asks again.</p>
</section>`,
  )
}

function articlePage(tx: string | null) {
  const receipt = tx
    ? `<div class="paid"><span class="dot"></span><span>You paid 1¢ to read this. <a href="${explorerTxUrl(networks[network], tx as `0x${string}`)}" target="_blank" rel="noopener">See it on Monad</a></span></div>`
    : `<div class="paid"><span class="dot"></span><span>Paid. This article stays open for a day.</span></div>`
  return shell(
    'The cent that pays for the web · Kova',
    `<span class="tag">A 1¢ article</span>
<h1>The cent that pays for the web</h1>
<p class="lede">Most of the web is paid for by ads or by subscriptions. There was always meant to be a third way.</p>
${receipt}
<article>
<p>When the web was designed, its authors set aside a status code for paying: <code>402 Payment Required</code>. For thirty years almost nothing used it. A cent cost more to move than it was worth, card fees started at thirty cents, and nobody would type a card number to read one page.</p>
<p>So the web split in two. Free pages paid for by attention, and walled pages paid for by monthly plans most people never start. A writer with one good article had no way to charge for just that article.</p>
<h2>What changed</h2>
<p>Dollars that live on a fast network can move in a second for a fraction of a cent. A page can now answer 402 with a price, and a wallet can pay it and ask again, with no checkout in between. That is what just happened here: this page asked for one cent, and Kova for Chrome paid it.</p>
<h2>Why a budget</h2>
<p>Paying by itself only works if it can’t go wrong. So Kova never gives a site your wallet. mykova.app got its own budget, with a limit Monad enforces, and small payments under your line go through without a question. Anything bigger asks you first. One switch freezes it.</p>
<p>A cent at a time, the web can pay the people who make it.</p>
</article>`,
  )
}

function offPage() {
  return shell(
    'Coming soon · Kova',
    `<section class="ask">
<span class="tag">Kova for Chrome</span>
<h1>The 1¢ article isn’t switched on yet</h1>
<p>Kova hasn’t set up this demo’s payments on this server yet. Come back soon.</p>
<a class="btn" href="/chrome">Back to Kova for Chrome</a>
</section>`,
  )
}
