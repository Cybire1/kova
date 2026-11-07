import { WEB } from '../shared/config.js'
import type { Prompt, PromptAnswer } from '../shared/types.js'

/**
 * Two kinds of window, both opened by Kova for Chrome and never by a website:
 *   prompt.html     Kova's own questions (a site's budget, a payment), answered with a click
 *   mykova.app      what only the wallet's passkey can do (switch a budget on, unfreeze, sign)
 * A window closed without an answer is a no.
 */

type Waiting<T> = {
  windowId?: number | undefined
  resolve: (value: T) => void
  reject: (error: Error) => void
}

const prompts = new Map<string, { prompt: Prompt } & Waiting<PromptAnswer>>()
const wallet = new Map<string, Waiting<Record<string, unknown>>>()

/** Chrome stops an idle background after 30 seconds; a question can take longer than that. */
let keepAlive: ReturnType<typeof setInterval> | undefined
function hold() {
  keepAlive ??= setInterval(() => {
    if (prompts.size === 0 && wallet.size === 0) {
      clearInterval(keepAlive)
      keepAlive = undefined
      return
    }
    void chrome.runtime.getPlatformInfo()
  }, 20_000)
}

async function openWindow(url: string, height: number) {
  const current = await chrome.windows.getLastFocused().catch(() => null)
  const width = 400
  const left =
    current?.left !== undefined && current.width !== undefined
      ? Math.max(0, current.left + current.width - width - 24)
      : undefined
  const top = current?.top !== undefined ? current.top + 72 : undefined
  return chrome.windows.create({
    url,
    type: 'popup',
    width,
    height,
    focused: true,
    ...(left !== undefined ? { left } : {}),
    ...(top !== undefined ? { top } : {}),
  })
}

/** Asks the person in Kova's own window. Resolves with their answer; closing it is a no. */
export async function ask(prompt: Prompt): Promise<PromptAnswer> {
  const id = crypto.randomUUID()
  const done = new Promise<PromptAnswer>((resolve, reject) => {
    prompts.set(id, { prompt, resolve, reject })
  })
  hold()
  const win = await openWindow(chrome.runtime.getURL(`prompt.html?id=${id}`), 640)
  const entry = prompts.get(id)
  if (entry) entry.windowId = win.id
  return done
}

export function promptFor(id: string): Prompt | null {
  return prompts.get(id)?.prompt ?? null
}

export function answerPrompt(id: string, answer: PromptAnswer) {
  const entry = prompts.get(id)
  if (!entry) return
  prompts.delete(id)
  entry.resolve(answer)
  if (entry.windowId !== undefined) void chrome.windows.remove(entry.windowId).catch(() => {})
}

function encode(value: unknown): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(JSON.stringify(value)))
    binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export class Cancelled extends Error {
  constructor() {
    super('Cancelled. Nothing moved.')
  }
}

/**
 * Asks the wallet on mykova.app (lib/extension.ts there): opens it with the request in the
 * fragment, and waits for its answer through chrome.runtime.onMessageExternal.
 */
export async function askWallet(action: Record<string, unknown>): Promise<Record<string, unknown>> {
  const id = crypto.randomUUID()
  const done = new Promise<Record<string, unknown>>((resolve, reject) => {
    wallet.set(id, { resolve, reject })
  })
  hold()
  const url = `${WEB}/extension#${encode({ ...action, id, ext: chrome.runtime.id })}`
  const win = await openWindow(url, 680)
  const entry = wallet.get(id)
  if (entry) entry.windowId = win.id
  return done
}

/** mykova.app's answer. Only that origin is listened to. */
export function onWalletAnswer(message: unknown, sender: chrome.runtime.MessageSender): boolean {
  if (!sender.origin || sender.origin !== new URL(WEB).origin) return false
  const m = message as { type?: string; id?: string; ok?: boolean; data?: unknown; error?: string }
  if (m?.type !== 'kova-approval' || typeof m.id !== 'string') return false
  const entry = wallet.get(m.id)
  if (!entry) return false
  wallet.delete(m.id)
  if (m.ok && m.data && typeof m.data === 'object') entry.resolve(m.data as Record<string, unknown>)
  else
    entry.reject(
      m.error === 'Cancelled' ? new Cancelled() : new Error(m.error ?? 'It didn’t go through.'),
    )
  return true
}

/** A window closed: whatever it was asking is a no. */
export function onWindowClosed(windowId: number) {
  for (const [id, entry] of prompts)
    if (entry.windowId === windowId) {
      prompts.delete(id)
      entry.resolve({ ok: false })
    }
  for (const [id, entry] of wallet)
    if (entry.windowId === windowId) {
      wallet.delete(id)
      entry.reject(new Cancelled())
    }
}
