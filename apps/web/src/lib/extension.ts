import type { Address } from 'viem'

/**
 * Kova for Chrome asks mykova.app for what only the wallet's passkey can do: opening the wallet,
 * switching a website's budget on, unfreezing or removing it, and signing a site's sign-in message.
 * The extension opens /extension with the request in the URL's fragment (never sent to a server),
 * and this site answers it with chrome.runtime.sendMessage, which reaches only an extension that
 * lists mykova.app in its manifest (externally_connectable) and whose ID is allowed below.
 */

export type ExtensionAction =
  | { action: 'connect' }
  | { action: 'link'; owner: Address; key: string }
  | { action: 'unfreeze'; owner: Address; key: string }
  | { action: 'remove'; owner: Address; key: string }
  | { action: 'sign'; owner: Address; site: string; message: string }

export type ExtensionRequest = ExtensionAction & {
  /** The extension's own id for this request, echoed in the answer. */
  id: string
  /** The extension's Chrome ID: where the answer goes. */
  ext: string
}

export type ExtensionAnswer =
  | { type: 'kova-approval'; id: string; ok: true; data: Record<string, unknown> }
  | { type: 'kova-approval'; id: string; ok: false; error: string; cancelled?: boolean }

/**
 * The extensions this site answers. Kova for Chrome's ID is fixed by the key in its manifest
 * (apps/extension/manifest.json); NEXT_PUBLIC_KOVA_EXTENSION_IDS adds others (the Web Store's).
 */
export const EXTENSION_IDS = [
  'aoaggfomejplfmnipidhdobmekaeogha',
  ...(process.env.NEXT_PUBLIC_KOVA_EXTENSION_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => /^[a-p]{32}$/.test(id)),
]

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const UUID = /^[0-9a-f-]{36}$/i

/** Reads a request from the fragment. Null for anything malformed or from an unknown extension. */
export function readExtensionRequest(fragment: string): ExtensionRequest | null {
  let json: unknown
  try {
    const text = fragment.replace(/^#/, '')
    const padded = text.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
    json = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))))
  } catch {
    return null
  }
  if (!json || typeof json !== 'object') return null
  const r = json as Record<string, unknown>
  if (typeof r.id !== 'string' || r.id.length > 64) return null
  if (typeof r.ext !== 'string' || !EXTENSION_IDS.includes(r.ext)) return null
  const base = { id: r.id, ext: r.ext }
  switch (r.action) {
    case 'connect':
      return { ...base, action: 'connect' }
    case 'link':
    case 'unfreeze':
    case 'remove':
      if (typeof r.owner !== 'string' || !ADDRESS.test(r.owner)) return null
      if (typeof r.key !== 'string' || !UUID.test(r.key)) return null
      return { ...base, action: r.action, owner: r.owner as Address, key: r.key }
    case 'sign':
      if (typeof r.owner !== 'string' || !ADDRESS.test(r.owner)) return null
      if (typeof r.site !== 'string' || r.site.length > 120) return null
      if (typeof r.message !== 'string' || r.message.length > 4000) return null
      return {
        ...base,
        action: 'sign',
        owner: r.owner as Address,
        site: r.site,
        message: r.message,
      }
    default:
      return null
  }
}

type ChromeRuntime = {
  runtime?: { sendMessage?: (id: string, message: unknown, done?: () => void) => void }
}

/** Hands the answer to the extension. False when this browser has no way to reach it. */
export function answerExtension(request: ExtensionRequest, answer: ExtensionAnswer): boolean {
  const chrome = (globalThis as { chrome?: ChromeRuntime }).chrome
  const send = chrome?.runtime?.sendMessage
  if (!send) return false
  send(request.ext, answer, () => {})
  return true
}
