import {
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  parseAmount,
  parsePaymentRequired,
  payableRequirement,
} from '@kova/monad'
import { formatUnits } from 'viem'
import { NETWORK } from '../shared/config.js'
import type { PendingX402 } from '../shared/types.js'
import { ask } from './approvals.js'
import { connectSite, owner, payX402, siteKey } from './sites.js'
import { siteFor } from './store.js'

/**
 * Pay-per-use websites (x402). A page that answers 402 Payment Required with a PAYMENT-REQUIRED
 * header is read here; if the site has a budget and the price is under its line, Kova pays at once,
 * otherwise it asks. Then the page loads again with the PAYMENT-SIGNATURE header added (a session
 * rule for that one URL in that one tab, removed as soon as the page is back), and a note on the
 * page says what was paid. Pages only: a site's own fetches aren't read.
 */

const seen = new Map<number, string>()

export function watchX402() {
  chrome.webRequest.onHeadersReceived.addListener(
    (details) => {
      if (details.statusCode !== 402 || details.tabId < 0) return
      const header = details.responseHeaders?.find(
        (h) => h.name.toLowerCase() === PAYMENT_REQUIRED_HEADER,
      )?.value
      if (!header) return
      // One question per page load, however many times Chrome reports it.
      if (seen.get(details.tabId) === details.url) return
      seen.set(details.tabId, details.url)
      setTimeout(() => seen.delete(details.tabId), 15_000)
      void handle(details.tabId, details.url, header)
    },
    { urls: ['<all_urls>'], types: ['main_frame'] },
    ['responseHeaders'],
  )
}

async function handle(tabId: number, url: string, header: string) {
  const origin = new URL(url).origin
  const required = parsePaymentRequired(header)
  if (!required) return
  const payable = payableRequirement(required, NETWORK)
  if (!payable) {
    await toast(tabId, {
      title: 'This page asks for a payment Kova can’t make',
      body: 'Kova pays websites on Monad, in AUSD or USDC.',
      tone: 'muted',
    })
    return
  }
  const pending: PendingX402 = {
    tabId,
    url,
    origin,
    requirement: payable.requirement,
    resource: required.resource,
    amount: formatUnits(payable.amount, 6),
    token: payable.token.currency,
  }
  try {
    await settle(pending)
  } catch (error) {
    await toast(tabId, {
      title: 'Not paid',
      body: error instanceof Error ? error.message : 'It didn’t go through. Nothing moved.',
      tone: 'muted',
    })
  }
}

async function settle(p: PendingX402) {
  const description = p.resource?.description ?? null
  // No wallet or no budget yet: one window sets both up, and says what it's for.
  if (!(await owner()) || !(await siteFor(p.origin))) {
    const answer = await ask({
      kind: 'connect',
      origin: p.origin,
      reason: 'x402',
      x402: { amount: p.amount, token: p.token, description },
    })
    if (!answer.ok) return
    await connectSite(p.origin, {
      limit: answer.limit ?? '2',
      period: answer.period ?? 'week',
      askAbove: answer.askAbove ?? '0.50',
    })
  }
  const key = await siteKey(p.origin)
  const site = await siteFor(p.origin)
  if (!key || !site) throw new Error('This site has no budget yet.')
  const amount = parseAmount(p.amount)
  const underLine = amount <= BigInt(site.askAbove) && amount <= parseAmount(key.left)
  if (!underLine) {
    const answer = await ask({
      kind: 'x402',
      origin: p.origin,
      amount: p.amount,
      token: p.token,
      description,
      left: key.left,
      period: key.period,
    })
    if (!answer.ok) return
  }
  const { header, payment } = await payX402(p.origin, p.requirement, p.resource)
  await reloadWith(p.tabId, p.url, header)
  const left = (Number(key.left) - Number(payment.amount)).toFixed(2)
  await toast(p.tabId, {
    title: `Paid ${cents(p.amount)} to ${description ? 'read this' : 'open this'}`,
    body: `${new URL(p.origin).host} · $${left} left ${key.period === 'week' ? 'this week' : 'today'}`,
    tone: 'paid',
  })
}

const cents = (amount: string) => {
  const n = Number(amount)
  return n < 1 ? `${Math.round(n * 100)}¢` : `$${n.toFixed(2)}`
}

let nextRule = 1

/** Loads the page again with the payment attached, for this URL in this tab only, once. */
async function reloadWith(tabId: number, url: string, header: string) {
  const id = nextRule++
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [id],
    addRules: [
      {
        id,
        priority: 1,
        action: {
          type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
          requestHeaders: [
            {
              header: PAYMENT_SIGNATURE_HEADER,
              operation: chrome.declarativeNetRequest.HeaderOperation.SET,
              value: header,
            },
          ],
        },
        condition: {
          urlFilter: `|${url.replace(/[|^*]/g, '*')}|`,
          resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME],
          tabIds: [tabId],
        },
      },
    ],
  })
  const done = new Promise<void>((resolve) => {
    const listener = (updated: number, info: chrome.tabs.TabChangeInfo) => {
      if (updated !== tabId || info.status !== 'complete') return
      chrome.tabs.onUpdated.removeListener(listener)
      resolve()
    }
    chrome.tabs.onUpdated.addListener(listener)
    setTimeout(resolve, 30_000)
  })
  seen.set(tabId, url)
  await chrome.tabs.reload(tabId)
  await done
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [id] })
}

export async function toast(
  tabId: number,
  note: { title: string; body: string; tone: 'paid' | 'muted' },
) {
  await chrome.tabs.sendMessage(tabId, { type: 'kova-toast', ...note }).catch(() => {})
}
