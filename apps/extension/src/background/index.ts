import { networks } from '@kova/monad'
import { NETWORK, WEB } from '../shared/config.js'
import { keyPaymentsOf } from '../shared/kova.js'
import type { RpcCall, UiMessage } from '../shared/types.js'
import { answerPrompt, onWalletAnswer, onWindowClosed, promptFor } from './approvals.js'
import { handleRpc } from './provider.js'
import {
  connectWallet,
  disconnectWallet,
  freezeAll,
  freezeSite,
  owner,
  removeSite,
  switchOn,
  unfreezeSite,
  view,
} from './sites.js'
import { siteFor } from './store.js'
import { watchX402 } from './x402.js'

/**
 * Kova for Chrome's background: the one place that holds the site keys, talks to Kova's API and
 * opens Kova's windows. Websites reach it only through the content script (bridge.ts), which says
 * which site is asking; Chrome tells it which tab and origin a message came from, and that origin
 * is the one used, never anything the page claims.
 */

watchX402()

/** Tells a site's open tabs its accounts changed (connected, removed). */
async function notify(origin: string) {
  const me = await owner()
  const accounts = me && (await siteFor(origin)) ? [me.address] : []
  const tabs = await chrome.tabs.query({ url: `${origin}/*` }).catch(() => [])
  for (const tab of tabs)
    if (tab.id !== undefined)
      void chrome.tabs
        .sendMessage(tab.id, { type: 'kova-event', event: 'accountsChanged', data: accounts })
        .catch(() => {})
}

async function fromPage(call: RpcCall, sender: chrome.runtime.MessageSender) {
  const origin = sender.origin ?? (sender.tab?.url ? new URL(sender.tab.url).origin : null)
  if (!origin || !/^https?:/.test(origin))
    return { error: { code: 4100, message: 'Kova only works on websites.' } }
  const before = await siteFor(origin)
  const result = await handleRpc(origin, call.method, call.params)
  const after = await siteFor(origin)
  if (Boolean(before) !== Boolean(after)) void notify(origin)
  return result
}

async function fromUi(message: UiMessage): Promise<unknown> {
  switch (message.type) {
    case 'state':
      return { ...(await view()), network: networks[NETWORK].name }
    case 'connect-wallet':
      return connectWallet()
    case 'disconnect-wallet':
      return disconnectWallet()
    case 'switch-on': {
      const site = await siteFor(message.origin)
      if (!site) return null
      await switchOn(site)
      void notify(message.origin)
      return null
    }
    case 'freeze':
      return freezeSite(message.origin)
    case 'unfreeze':
      return unfreezeSite(message.origin)
    case 'remove':
      await removeSite(message.origin)
      void notify(message.origin)
      return null
    case 'freeze-all':
      return freezeAll()
    case 'payments': {
      const me = await owner()
      const site = await siteFor(message.origin)
      if (!me || !site) return []
      const { data } = await keyPaymentsOf(me.address)
      return data.filter((p) => p.key === site.keyId)
    }
    case 'open':
      await chrome.tabs.create({ url: `${WEB}${message.path}` })
      return null
    case 'prompt:get':
      return promptFor(message.id)
    case 'prompt:answer':
      answerPrompt(message.id, message.answer)
      return null
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  // Kova's own pages (the popup, its windows) by their address; a content script shares the
  // extension's id but carries the website's address.
  const fromExtension =
    sender.id === chrome.runtime.id && (sender.url ?? '').startsWith(chrome.runtime.getURL(''))
  const work =
    message?.type === 'rpc' && sender.tab && !fromExtension
      ? fromPage(message as RpcCall, sender)
      : fromExtension
        ? fromUi(message as UiMessage)
        : Promise.resolve({ error: { code: 4100, message: 'Not allowed.' } })
  work.then(
    (value) => respond({ ok: true, value }),
    (error: unknown) =>
      respond({ ok: false, error: error instanceof Error ? error.message : String(error) }),
  )
  return true
})

chrome.runtime.onMessageExternal.addListener((message, sender) => {
  onWalletAnswer(message, sender)
})

chrome.windows.onRemoved.addListener((windowId) => onWindowClosed(windowId))
