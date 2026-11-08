import type { X402Requirement, X402Resource } from '@kova/monad'
import type { Address, Hex } from 'viem'

/** The wallet Kova for Chrome is connected to, after it signed the connect message. */
export interface Owner {
  address: Address
  name: string
  currency: string
  connectedAt: number
}

/**
 * A website's budget as this browser keeps it: the key is made here, signs every payment the site
 * makes, and never leaves this browser. Everything else (status, spent, left) is Kova's to say.
 */
export interface LocalSite {
  origin: string
  keyId: string
  privateKey: Hex
  keyAddress: Address
  /** Pay-per-use payments up to this many base units go through without asking. */
  askAbove: string
  createdAt: number
}

/** A budget as Kova's API serializes it (apps/api services/spend-keys.ts serializeKey). */
export interface ApiKey {
  id: string
  kind: string
  name: string
  owner: Address
  key_address: Address | null
  status: 'invited' | 'accepted' | 'active' | 'frozen' | 'removed'
  frozen: boolean
  limit: string
  period: 'day' | 'week'
  spent: string
  spent_today: string
  left: string
  ends_at: string
  rules: { per_payment: string; ask_above: string; payees: 'anyone' | Address[] } | null
  last_used_at: string | null
  created_at: string
}

export interface ApiPayment {
  id: string
  key: string
  kind: string
  to: Address
  amount: string
  description: string | null
  status: string
  reason: string | null
  tx_hash: string | null
  created_at: string
  x402?: { header: string; resource: X402Resource | null }
}

/** A site in the popup: what this browser holds, joined with what Kova says about it. */
export interface SiteView {
  origin: string
  name: string
  keyId: string
  status: ApiKey['status'] | 'unknown'
  limit: string
  period: 'day' | 'week'
  spent: string
  left: string
  askAbove: string
}

/** What the popup shows. */
export interface PopupState {
  owner: Owner | null
  balance: string | null
  sites: SiteView[]
  /** Sites that see the wallet's address but have no budget: they can't spend. */
  connected: string[]
  network: string
}

/**
 * A question for the person, shown in Kova's own window (prompt.html). Connecting only shares the
 * address; a budget is asked for the first time a site wants to be paid, with what it asks.
 */
export type Prompt =
  | { kind: 'connect'; origin: string }
  | { kind: 'budget'; origin: string; reason: 'pay' | 'x402'; ask: PromptX402 }
  | { kind: 'pay'; origin: string; to: Address; amount: string; left: string; period: string }
  | ({ kind: 'x402'; origin: string; left: string; period: string } & PromptX402)

/** What a site asks for: an amount, in which dollar, and what for if it said. */
export interface PromptX402 {
  amount: string
  token: string
  description: string | null
}

export type PromptAnswer =
  | { ok: true; limit?: string; period?: 'day' | 'week'; askAbove?: string }
  | { ok: false }

/** A payment a site asked for over HTTP 402, kept until it's paid or turned down. */
export interface PendingX402 {
  tabId: number
  url: string
  origin: string
  requirement: X402Requirement
  resource?: X402Resource | undefined
  amount: string
  token: string
}

/** Messages from the popup and prompt windows to the background. */
export type UiMessage =
  | { type: 'state' }
  | { type: 'connect-wallet' }
  | { type: 'disconnect-wallet' }
  | { type: 'switch-on'; origin: string }
  | { type: 'freeze'; origin: string }
  | { type: 'unfreeze'; origin: string }
  | { type: 'remove'; origin: string }
  | { type: 'disconnect'; origin: string }
  | { type: 'freeze-all' }
  | { type: 'payments'; origin: string }
  | { type: 'open'; path: string }
  | { type: 'prompt:get'; id: string }
  | { type: 'prompt:answer'; id: string; answer: PromptAnswer }

/** What the page's provider asks the background, through the content script. */
export interface RpcCall {
  type: 'rpc'
  method: string
  params?: unknown
}

export type RpcResult = { result: unknown } | { error: { code: number; message: string } }
