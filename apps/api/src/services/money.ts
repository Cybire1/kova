import { createHmac, timingSafeEqual } from 'node:crypto'
import { schema, uuidv7 } from '@kova/db'
import {
  erc4626Abi,
  kovaSaverAbi,
  MONEY_SIGNATURE_MAX_AGE,
  type MoneyFeature,
  moneyActionMessage,
} from '@kova/monad'
import { and, desc, eq, sql } from 'drizzle-orm'
import {
  type Address,
  encodeFunctionData,
  getAddress,
  type Hex,
  isAddress,
  isAddressEqual,
  parseEventLogs,
  parseSignature,
  recoverMessageAddress,
} from 'viem'
import { network, publicClient, settlementToken } from '../chain.js'
import { config } from '../config.js'
import { db } from '../db.js'
import { KovaError } from '../errors.js'
import { sendFromRelayer } from '../relay.js'
import { depositAddress } from './deposits.js'

/**
 * Money in (a US account number), the dollar card and savings. Each runs through a partner, and each
 * is honest about it: with no partner key a wallet can ask for access (Kova keeps the list), and
 * with one, the real thing opens.
 *
 * - US account: Bridge virtual accounts. Bridge needs the person through its KYC first, then gives
 *   an account and routing number; what arrives goes as USDC to the wallet's Aurora Intents deposit
 *   address, which lands it as AUSD on Monad.
 * - Dollar card: Lithic, virtual cards with a daily limit; the number shows in Lithic's own frame.
 * - Savings: any ERC-4626 vault for the settlement dollar, behind KovaSaver, so moving in and out is
 *   a signature and Kova pays the gas.
 */

const net = config.KOVA_NETWORK

// --- Signed requests ---------------------------------------------------------------------------

/** Checks that the wallet itself asked for this action, recently, and nothing else. */
export async function requireWalletSignature(
  wallet: Address,
  action: string,
  signedAt: unknown,
  signature: unknown,
  detail = '',
): Promise<void> {
  if (typeof signedAt !== 'number' || !Number.isInteger(signedAt))
    throw new KovaError('invalid_request', 'Expected signed_at, in seconds.')
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature))
    throw new KovaError('invalid_request', 'Expected the wallet’s signature.')
  if (Math.abs(Date.now() / 1000 - signedAt) > MONEY_SIGNATURE_MAX_AGE)
    throw new KovaError('invalid_request', 'That was signed too long ago. Try again.')
  const signer = await recoverMessageAddress({
    message: moneyActionMessage(wallet, action, signedAt, detail),
    signature: signature as Hex,
  }).catch(() => null)
  if (!signer || !isAddressEqual(signer, wallet))
    throw new KovaError('forbidden', 'Only this wallet can do that.')
}

// --- Asking for access -------------------------------------------------------------------------

export async function hasRequested(wallet: Address, feature: MoneyFeature): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.moneyAccessRequests.id })
    .from(schema.moneyAccessRequests)
    .where(
      and(
        eq(schema.moneyAccessRequests.wallet, wallet.toLowerCase()),
        eq(schema.moneyAccessRequests.network, net),
        eq(schema.moneyAccessRequests.feature, feature),
      ),
    )
    .limit(1)
  return Boolean(row)
}

export async function requestAccess(wallet: Address, feature: MoneyFeature): Promise<void> {
  await db
    .insert(schema.moneyAccessRequests)
    .values({ id: uuidv7(), wallet: wallet.toLowerCase(), network: net, feature })
    .onConflictDoNothing()
}

/** How many wallets are waiting for each feature (for the founders, not shown to wallets). */
export async function accessRequestCounts(): Promise<Record<string, number>> {
  const rows = await db
    .select({ feature: schema.moneyAccessRequests.feature, n: sql<number>`count(*)::int` })
    .from(schema.moneyAccessRequests)
    .where(eq(schema.moneyAccessRequests.network, net))
    .groupBy(schema.moneyAccessRequests.feature)
  return Object.fromEntries(rows.map((r) => [r.feature, r.n]))
}

// --- US account (Bridge) -----------------------------------------------------------------------

export const bridgeLive = () => Boolean(config.BRIDGE_API_KEY)
/** Bridge's sandbox moves no money; its accounts are labelled as such. */
export const bridgeSandbox = () => config.BRIDGE_API_URL.includes('sandbox')

async function bridge<T>(
  path: string,
  init: { method?: string; body?: unknown; idempotencyKey?: string } = {},
): Promise<T> {
  if (!config.BRIDGE_API_KEY)
    throw new KovaError('conflict', 'US accounts aren’t switched on for this server yet.')
  const response = await fetch(`${config.BRIDGE_API_URL}/v0${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'Api-Key': config.BRIDGE_API_KEY,
      'content-type': 'application/json',
      ...(init.idempotencyKey ? { 'Idempotency-Key': init.idempotencyKey } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null)
  if (!response) throw new KovaError('chain_error', 'Bridge didn’t answer. Try again in a moment.')
  const body = (await response.json().catch(() => null)) as (T & { message?: string }) | null
  if (!response.ok || !body)
    throw new KovaError(
      'chain_error',
      `Bridge refused that${body?.message ? `: ${body.message}` : '.'}`,
    )
  return body
}

interface BridgeKycLink {
  id: string
  kyc_link: string
  tos_link: string
  kyc_status: string
  tos_status?: string
  customer_id: string | null
}

interface BridgeVirtualAccount {
  id: string
  status: string
  source_deposit_instructions: {
    bank_name?: string
    bank_address?: string
    bank_routing_number?: string
    bank_account_number?: string
    bank_beneficiary_name?: string
    bank_beneficiary_address?: string
    payment_rails?: string[]
  }
}

export interface UsAccountDetails {
  bank_name: string | null
  account_number: string | null
  routing_number: string | null
  beneficiary_name: string | null
  beneficiary_address: string | null
  rails: string[]
}

export type UsAccountRow = typeof schema.usAccounts.$inferSelect

async function usAccountRow(wallet: Address): Promise<UsAccountRow | null> {
  const [row] = await db
    .select()
    .from(schema.usAccounts)
    .where(
      and(eq(schema.usAccounts.wallet, wallet.toLowerCase()), eq(schema.usAccounts.network, net)),
    )
    .limit(1)
  return row ?? null
}

/** Where Bridge should send what arrives: the wallet's own Aurora deposit address on mainnet. */
async function landingAddress(wallet: Address): Promise<string> {
  if (net === 'mainnet') return (await depositAddress(wallet, 'evm')).address
  // Bridge's sandbox never touches a chain, so on testnet the wallet itself stands in.
  return wallet
}

/** The account as the wallet sees it, refreshing its KYC from Bridge while it's pending. */
export async function usAccountFor(wallet: Address, withDetails: boolean) {
  const live = bridgeLive()
  let row = await usAccountRow(wallet)
  if (live && row && row.status === 'kyc' && row.kycLinkId) row = await advanceUsAccount(row)
  const details = row?.details as UsAccountDetails | null | undefined
  return {
    object: 'us_account' as const,
    live,
    sandbox: live && bridgeSandbox(),
    provider: 'Bridge',
    requested: live ? false : await hasRequested(wallet, 'us_account'),
    /** none, kyc, active. */
    status: (row?.status ?? 'none') as 'none' | 'kyc' | 'active' | 'closed',
    kyc_status: row?.kycStatus ?? null,
    kyc_link: row?.status === 'kyc' ? row.kycLink : null,
    tos_link: row?.status === 'kyc' ? row.tosLink : null,
    arrives_as: settlementToken.symbol,
    details: withDetails && details ? details : null,
    last_four: details?.account_number ? details.account_number.slice(-4) : null,
  }
}

/** Starts Bridge's KYC for this person (Bridge asks for their name and email). */
export async function openUsAccount(wallet: Address, person: { full_name: string; email: string }) {
  const existing = await usAccountRow(wallet)
  if (existing) return usAccountFor(wallet, false)
  const link = await bridge<BridgeKycLink>('/kyc_links', {
    method: 'POST',
    body: { full_name: person.full_name, email: person.email, type: 'individual' },
    idempotencyKey: `kova-kyc-${net}-${wallet.toLowerCase()}`,
  })
  await db
    .insert(schema.usAccounts)
    .values({
      id: uuidv7(),
      wallet: wallet.toLowerCase(),
      network: net,
      provider: 'bridge',
      kycLinkId: link.id,
      kycLink: link.kyc_link,
      tosLink: link.tos_link,
      kycStatus: link.kyc_status,
      customerId: link.customer_id,
      status: 'kyc',
    })
    .onConflictDoNothing()
  return usAccountFor(wallet, false)
}

/** Once Bridge approves the person, makes the virtual account that lands in this wallet. */
async function advanceUsAccount(row: UsAccountRow): Promise<UsAccountRow> {
  const link = await bridge<BridgeKycLink>(
    `/kyc_links/${encodeURIComponent(row.kycLinkId as string)}`,
  ).catch(() => null)
  if (!link) return row
  if (link.kyc_status !== 'approved' || !link.customer_id) {
    if (link.kyc_status === row.kycStatus) return row
    const [updated] = await db
      .update(schema.usAccounts)
      .set({ kycStatus: link.kyc_status, customerId: link.customer_id, updatedAt: new Date() })
      .where(eq(schema.usAccounts.id, row.id))
      .returning()
    return updated ?? row
  }
  const wallet = getAddress(row.wallet)
  const destination = await landingAddress(wallet)
  const account = await bridge<BridgeVirtualAccount>(
    `/customers/${encodeURIComponent(link.customer_id)}/virtual_accounts`,
    {
      method: 'POST',
      body: {
        source: { currency: 'usd' },
        destination: {
          currency: config.BRIDGE_DESTINATION_CURRENCY,
          payment_rail: config.BRIDGE_DESTINATION_RAIL,
          address: destination,
        },
        developer_fee_percent: '0.0',
      },
      idempotencyKey: `kova-va-${net}-${row.wallet}`,
    },
  )
  const i = account.source_deposit_instructions
  const details: UsAccountDetails = {
    bank_name: i.bank_name ?? null,
    account_number: i.bank_account_number ?? null,
    routing_number: i.bank_routing_number ?? null,
    beneficiary_name: i.bank_beneficiary_name ?? null,
    beneficiary_address: i.bank_beneficiary_address ?? null,
    rails: i.payment_rails ?? ['ach_push', 'wire'],
  }
  const [updated] = await db
    .update(schema.usAccounts)
    .set({
      kycStatus: link.kyc_status,
      customerId: link.customer_id,
      virtualAccountId: account.id,
      depositAddress: destination,
      details,
      status: 'active',
      updatedAt: new Date(),
    })
    .where(eq(schema.usAccounts.id, row.id))
    .returning()
  return updated ?? row
}

// --- Dollar card (Lithic) ----------------------------------------------------------------------

export const lithicLive = () => Boolean(config.LITHIC_API_KEY)
export const lithicSandbox = () => config.LITHIC_API_URL.includes('sandbox')
/** A new card's daily limit, in base units: $200. The holder can change it. */
export const DEFAULT_CARD_DAILY_LIMIT = 200_000_000n
export const MAX_CARD_DAILY_LIMIT = 2_000_000_000n

async function lithic<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  if (!config.LITHIC_API_KEY)
    throw new KovaError('conflict', 'The dollar card isn’t switched on for this server yet.')
  const response = await fetch(`${config.LITHIC_API_URL}/v1${path}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: config.LITHIC_API_KEY, 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null)
  if (!response)
    throw new KovaError('chain_error', 'The card issuer didn’t answer. Try again in a moment.')
  const body = (await response.json().catch(() => null)) as
    | (T & { message?: string; debugging_request_id?: string })
    | null
  if (!response.ok || !body)
    throw new KovaError(
      'chain_error',
      `The card issuer refused that${body?.message ? `: ${body.message}` : '.'}`,
    )
  return body
}

interface LithicCard {
  token: string
  last_four: string
  exp_month?: string
  exp_year?: string
  state: 'OPEN' | 'PAUSED' | 'CLOSED' | string
  spend_limit: number
}

interface LithicTransaction {
  token: string
  amount: number
  status: string
  result?: string
  created: string
  merchant?: { descriptor?: string; city?: string; country?: string }
}

export type DollarCardRow = typeof schema.dollarCards.$inferSelect

async function cardRow(wallet: Address): Promise<DollarCardRow | null> {
  const [row] = await db
    .select()
    .from(schema.dollarCards)
    .where(
      and(
        eq(schema.dollarCards.wallet, wallet.toLowerCase()),
        eq(schema.dollarCards.network, net),
        sql`${schema.dollarCards.state} <> 'closed'`,
      ),
    )
    .orderBy(desc(schema.dollarCards.createdAt))
    .limit(1)
  return row ?? null
}

/** Base units (6 decimals) to cents, rounding down. */
const toCents = (units: bigint) => Number(units / 10_000n)
/** Cents to base units. */
const fromCents = (cents: number) => BigInt(Math.round(cents)) * 10_000n

function serializeCard(row: DollarCardRow) {
  return {
    last_four: row.lastFour,
    exp_month: row.expMonth,
    exp_year: row.expYear,
    frozen: row.state === 'paused',
    daily_limit: row.dailyLimit.toString(),
  }
}

export async function dollarCardFor(wallet: Address) {
  const live = lithicLive()
  const row = await cardRow(wallet)
  let transactions: Array<{
    id: string
    amount: string
    status: string
    merchant: string
    at: string
  }> = []
  if (live && row) {
    const page = await lithic<{ data: LithicTransaction[] }>(
      `/transactions?card_token=${encodeURIComponent(row.providerCardToken)}&page_size=20`,
    ).catch(() => ({ data: [] }))
    transactions = page.data.map((t) => ({
      id: t.token,
      amount: fromCents(t.amount).toString(),
      status: t.status.toLowerCase(),
      merchant: t.merchant?.descriptor?.trim() || 'Card payment',
      at: t.created,
    }))
  }
  return {
    object: 'dollar_card' as const,
    live,
    sandbox: live && lithicSandbox(),
    provider: 'Lithic',
    requested: live ? false : await hasRequested(wallet, 'dollar_card'),
    card: row ? serializeCard(row) : null,
    transactions,
  }
}

/** Issues the wallet's virtual card, spending at most `dailyLimit` a day. */
export async function issueDollarCard(wallet: Address, dailyLimit = DEFAULT_CARD_DAILY_LIMIT) {
  if (await cardRow(wallet))
    throw new KovaError('conflict', 'This wallet already has a dollar card.')
  const card = await lithic<LithicCard>('/cards', {
    method: 'POST',
    body: {
      type: 'VIRTUAL',
      memo: `Kova ${wallet.slice(0, 6)}…${wallet.slice(-4)}`,
      spend_limit: toCents(dailyLimit),
      spend_limit_duration: 'DAILY',
      state: 'OPEN',
    },
  })
  await db.insert(schema.dollarCards).values({
    id: uuidv7(),
    wallet: wallet.toLowerCase(),
    network: net,
    provider: 'lithic',
    providerCardToken: card.token,
    lastFour: card.last_four,
    expMonth: card.exp_month ?? null,
    expYear: card.exp_year ?? null,
    state: card.state === 'PAUSED' ? 'paused' : 'open',
    dailyLimit,
  })
  return dollarCardFor(wallet)
}

/** Freezes or unfreezes the card at the issuer, so the next payment is refused there. */
export async function setDollarCard(
  wallet: Address,
  change: { frozen?: boolean; dailyLimit?: bigint },
) {
  const row = await cardRow(wallet)
  if (!row) throw new KovaError('not_found', 'This wallet has no dollar card yet.')
  if (
    change.dailyLimit !== undefined &&
    (change.dailyLimit <= 0n || change.dailyLimit > MAX_CARD_DAILY_LIMIT)
  )
    throw new KovaError('invalid_request', 'A daily limit is between $1 and $2,000.')
  const body: Record<string, unknown> = {}
  if (change.frozen !== undefined) body.state = change.frozen ? 'PAUSED' : 'OPEN'
  if (change.dailyLimit !== undefined) body.spend_limit = toCents(change.dailyLimit)
  const card = await lithic<LithicCard>(`/cards/${encodeURIComponent(row.providerCardToken)}`, {
    method: 'PATCH',
    body,
  })
  await db
    .update(schema.dollarCards)
    .set({
      state: card.state === 'PAUSED' ? 'paused' : card.state === 'CLOSED' ? 'closed' : 'open',
      ...(change.dailyLimit !== undefined ? { dailyLimit: change.dailyLimit } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.dollarCards.id, row.id))
  return dollarCardFor(wallet)
}

/**
 * A link to Lithic's own frame that shows the card's number, expiry and CVC, so they never pass
 * through Kova. Signed with the API key, as Lithic's embedded card UI expects.
 */
export async function revealDollarCard(
  wallet: Address,
  targetOrigin: string,
): Promise<{ url: string; expires_at: string }> {
  const row = await cardRow(wallet)
  if (!row) throw new KovaError('not_found', 'This wallet has no dollar card yet.')
  if (!config.LITHIC_API_KEY)
    throw new KovaError('conflict', 'The dollar card isn’t switched on for this server yet.')
  const expires = new Date(Date.now() + 5 * 60_000)
  const request = Buffer.from(
    JSON.stringify({
      token: row.providerCardToken,
      expiration: expires.toISOString(),
      target_origin: targetOrigin,
    }),
  ).toString('base64')
  const hmac = createHmac('sha256', config.LITHIC_API_KEY).update(request).digest('base64')
  const params = new URLSearchParams({ embed_request: request, hmac })
  return {
    url: `${config.LITHIC_API_URL}/v1/embed/card?${params}`,
    expires_at: expires.toISOString(),
  }
}

/** What Lithic sends for a card authorization (Auth Stream Access), as far as Kova reads it. */
export interface CardAuthorizationEvent {
  token?: string
  card_token?: string
  card?: { token?: string }
  /** Cents. Older payloads carry `amount`; newer ones `amounts.cardholder.amount`. */
  amount?: number
  amounts?: { cardholder?: { amount?: number } }
}

/**
 * A card authorization from Lithic (Auth Stream Access): approved only when the card is open and
 * the wallet holds enough dollars, so the card spends from the Kova balance and never past it.
 * The reply is Lithic's documented `{ result }`: APPROVED, or a decline such as INSUFFICIENT_FUNDS.
 */
export async function decideCardAuthorization(
  event: CardAuthorizationEvent,
): Promise<{ result: string }> {
  const cardToken = event.card_token ?? event.card?.token
  const cents = event.amounts?.cardholder?.amount ?? event.amount
  if (!cardToken || typeof cents !== 'number' || cents <= 0)
    return { result: 'UNAUTHORIZED_MERCHANT' }
  const [row] = await db
    .select()
    .from(schema.dollarCards)
    .where(eq(schema.dollarCards.providerCardToken, cardToken))
    .limit(1)
  if (row?.state !== 'open') return { result: 'CARD_PAUSED' }
  const balance = await publicClient
    .readContract({
      address: settlementToken.address,
      abi: erc4626Abi,
      functionName: 'balanceOf',
      args: [getAddress(row.wallet)],
    })
    .catch(() => null)
  if (balance === null || fromCents(cents) > balance) return { result: 'INSUFFICIENT_FUNDS' }
  return { result: 'APPROVED' }
}

/**
 * Lithic signs Auth Stream Access requests the way it signs webhooks: `webhook-signature` holds
 * "v1,<base64 HMAC-SHA256>" over "<webhook-id>.<webhook-timestamp>.<body>", keyed with the
 * base64 secret after "whsec_". Five minutes of clock skew at most.
 */
export function verifyLithicSignature(
  raw: string,
  headers: { id?: string; timestamp?: string; signature?: string },
  now = Math.floor(Date.now() / 1000),
): boolean {
  const secret = config.LITHIC_ASA_SECRET
  if (!secret || !headers.id || !headers.timestamp || !headers.signature) return false
  const at = Number(headers.timestamp)
  if (!Number.isFinite(at) || Math.abs(now - at) > 300) return false
  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64')
  const expected = createHmac('sha256', key)
    .update(`${headers.id}.${headers.timestamp}.${raw}`)
    .digest('base64')
  return headers.signature.split(' ').some((part) => {
    const [version, sig] = part.split(',')
    return version === 'v1' && sig !== undefined && timingSafeEqualText(sig, expected)
  })
}

function timingSafeEqualText(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

// --- Savings (an ERC-4626 vault, behind KovaSaver) ---------------------------------------------

/**
 * The most gas Kova pays to move savings in or out. A vault that lends across several markets and
 * swaps on the way costs more than a plain one: setsAUSD measured about 1.24M in and 1.79M out on
 * Monad. The relayer asks for the estimate, so this only caps it, with room so a withdrawal never
 * gets stuck behind the cap. At 102 gwei, 3M gas is 0.31 MON.
 */
const SAVINGS_MAX_GAS = 3_000_000n

export function savingsVault(): Address | null {
  return config.KOVA_SAVINGS_VAULT && isAddress(config.KOVA_SAVINGS_VAULT)
    ? getAddress(config.KOVA_SAVINGS_VAULT)
    : null
}

export function saver(): Address | null {
  return config.KOVA_SAVER && isAddress(config.KOVA_SAVER) ? getAddress(config.KOVA_SAVER) : null
}

export const savingsLive = () => Boolean(savingsVault() && saver())

/**
 * Whether this wallet can put money into savings (KOVA_SAVINGS_WALLETS): everyone, or the wallets a
 * vault is tried out with first. Unset, it's nobody on mainnet. Taking savings out is never closed.
 */
export function savingsOpenTo(wallet: Address, on: typeof net = net): boolean {
  const only = config.KOVA_SAVINGS_WALLETS?.trim()
  if (!only) return on === 'testnet'
  if (only === 'everyone') return true
  return only.split(',').some((a) => a.trim().toLowerCase() === wallet.toLowerCase())
}

/** Monad makes about 2.5 blocks a second. */
const BLOCKS_A_SECOND = 2.5
const WEEK = 7 * 86_400

export interface SavingsRate {
  /** A year's worth of what the vault paid lately: 0.036 is 3.6%. */
  yearly: number
  /** Over how many days. */
  days: number
}
let rateRead: { vault: Address; at: number; rate: SavingsRate | null } | null = null

/**
 * What the vault actually paid over about the last week, as a yearly rate: its share price now
 * against a week ago, read off Monad. Kept for an hour. Null when it can't be read, or the vault is
 * newer than a day.
 */
export async function savingsRate(vault: Address): Promise<SavingsRate | null> {
  const rated =
    config.KOVA_SAVINGS_RATE_VAULT && isAddress(config.KOVA_SAVINGS_RATE_VAULT)
      ? getAddress(config.KOVA_SAVINGS_RATE_VAULT)
      : vault
  if (rateRead && rateRead.vault === rated && Date.now() - rateRead.at < 3_600_000)
    return rateRead.rate
  let rate: SavingsRate | null = null
  try {
    const latest = await publicClient.getBlock()
    const back = BigInt(Math.round(WEEK * BLOCKS_A_SECOND))
    const then = await publicClient.getBlock({
      blockNumber: latest.number > back ? latest.number - back : 1n,
    })
    // The price of a million of the smallest shares: whole numbers, precise to well under 0.01%.
    const price = (blockNumber: bigint) =>
      publicClient.readContract({
        address: rated,
        abi: erc4626Abi,
        functionName: 'convertToAssets',
        args: [10n ** 18n],
        blockNumber,
      })
    const [now, before] = await Promise.all([price(latest.number), price(then.number)])
    const seconds = Number(latest.timestamp - then.timestamp)
    if (before > 0n && seconds >= 86_400) {
      const yearly = (Number(now) / Number(before)) ** ((365 * 86_400) / seconds) - 1
      if (Number.isFinite(yearly))
        rate = { yearly: Math.round(yearly * 10_000) / 10_000, days: Math.round(seconds / 86_400) }
    }
  } catch {
    // Too new to have a week behind it, or the RPC stumbled: no rate rather than a made-up one.
  }
  rateRead = { vault: rated, at: Date.now(), rate }
  return rate
}

const dollars = (amount: bigint) =>
  (Number(amount) / 1e6).toLocaleString('en-US', { style: 'currency', currency: 'USD' })

/** What the wallet has in savings, what it put in, and what it has earned on top. */
export async function savingsFor(wallet: Address) {
  const vault = savingsVault()
  const helper = saver()
  const closed = async () => ({
    object: 'savings' as const,
    live: false,
    test: net === 'testnet',
    requested: await hasRequested(wallet, 'savings'),
    vault: null,
    saver: null,
    balance: '0',
    deposited: '0',
    earned: '0',
    room: null,
    withdrawable: null,
    rate: null,
    can_save: false,
    beta: false,
    moves: [],
  })
  if (!vault || !helper) return closed()
  const canSave = savingsOpenTo(wallet)
  const [name, shares, nonce] = await Promise.all([
    publicClient
      .readContract({ address: vault, abi: erc4626Abi, functionName: 'name' })
      .catch(() => 'Savings'),
    publicClient.readContract({
      address: vault,
      abi: erc4626Abi,
      functionName: 'balanceOf',
      args: [wallet],
    }),
    publicClient
      .readContract({ address: vault, abi: erc4626Abi, functionName: 'nonces', args: [wallet] })
      .catch(() => 0n),
  ])
  // Savings opens to a few wallets first; a wallet already holding savings can always take them out.
  if (!canSave && shares === 0n) return closed()
  const worth = (some: bigint) =>
    some === 0n
      ? Promise.resolve(0n)
      : publicClient.readContract({
          address: vault,
          abi: erc4626Abi,
          functionName: 'convertToAssets',
          args: [some],
        })
  const [balance, room, redeemable, rate] = await Promise.all([
    worth(shares),
    // A vault with a cap says how much more it takes; one that doesn't say has no cap to show.
    canSave
      ? publicClient
          .readContract({
            address: vault,
            abi: erc4626Abi,
            functionName: 'maxDeposit',
            args: [wallet],
          })
          .catch(() => null)
      : Promise.resolve(0n),
    shares === 0n
      ? Promise.resolve(0n)
      : publicClient
          .readContract({
            address: vault,
            abi: erc4626Abi,
            functionName: 'maxRedeem',
            args: [wallet],
          })
          .catch(() => null),
    savingsRate(vault),
  ])
  // What can come out right now: all of it, unless the vault is keeping some back for a while.
  const withdrawable =
    redeemable === null ? null : redeemable >= shares ? balance : await worth(redeemable)
  const moves = await db
    .select()
    .from(schema.savingsMoves)
    .where(
      and(
        eq(schema.savingsMoves.wallet, wallet.toLowerCase()),
        eq(schema.savingsMoves.network, net),
      ),
    )
    .orderBy(desc(schema.savingsMoves.createdAt))
    .limit(50)
  const deposited = moves.reduce(
    (sum, m) => (m.kind === 'in' ? sum + m.assets : sum - m.assets),
    0n,
  )
  const earned = balance > deposited ? balance - deposited : 0n
  return {
    object: 'savings' as const,
    live: true,
    test: net === 'testnet',
    requested: false,
    vault: {
      address: vault,
      name,
      version: '1',
      chain_id: network.chainId,
      shares: shares.toString(),
      nonce: nonce.toString(),
    },
    saver: helper,
    balance: balance.toString(),
    deposited: (deposited > 0n ? deposited : 0n).toString(),
    earned: earned.toString(),
    room: room === null ? null : room.toString(),
    withdrawable: withdrawable === null ? null : withdrawable.toString(),
    rate,
    can_save: canSave,
    // A partner's vault on mainnet is new money's home: the app says plainly until it's audited.
    beta: net === 'mainnet' && config.KOVA_SAVINGS_AUDITED !== '1',
    moves: moves.map((m) => ({
      kind: m.kind,
      amount: m.assets.toString(),
      tx_hash: m.txHash,
      at: m.createdAt.toISOString(),
    })),
  }
}

/** Into savings: the wallet's signed receiveWithAuthorization, carried out by KovaSaver. */
export async function saveIn(
  wallet: Address,
  signed: { value: bigint; validAfter: bigint; validBefore: bigint; nonce: Hex; signature: Hex },
) {
  const vault = savingsVault()
  const helper = saver()
  if (!vault || !helper)
    throw new KovaError('conflict', 'Savings aren’t switched on for this server yet.')
  if (signed.value <= 0n) throw new KovaError('invalid_request', 'Save more than $0.00.')
  if (!savingsOpenTo(wallet))
    throw new KovaError('policy_declined', 'Savings isn’t open to this wallet yet.')
  // Said before the relayer spends anything: a vault at its cap would refuse the deposit.
  const room = await publicClient
    .readContract({ address: vault, abi: erc4626Abi, functionName: 'maxDeposit', args: [wallet] })
    .catch(() => null)
  if (room !== null && room < signed.value)
    throw new KovaError(
      'policy_declined',
      room === 0n
        ? 'Savings is full right now. Try again later.'
        : `Savings can take ${dollars(room)} more right now.`,
    )
  const { v, r, s, yParity } = parseSignature(signed.signature)
  const data = encodeFunctionData({
    abi: kovaSaverAbi,
    functionName: 'save',
    args: [
      wallet,
      signed.value,
      signed.validAfter,
      signed.validBefore,
      signed.nonce,
      Number(v ?? BigInt(yParity + 27)),
      r,
      s,
    ],
  })
  const receipt = await sendFromRelayer(helper, data, { maxGas: SAVINGS_MAX_GAS })
  if (receipt.status !== 'success')
    throw new KovaError('chain_error', 'The move into savings didn’t go through.')
  await db
    .insert(schema.savingsMoves)
    .values({
      id: uuidv7(),
      wallet: wallet.toLowerCase(),
      network: net,
      vault: vault.toLowerCase(),
      kind: 'in',
      assets: signed.value,
      txHash: receipt.transactionHash,
    })
    .onConflictDoNothing()
  return { tx_hash: receipt.transactionHash }
}

/** Out of savings: a permit on the wallet's vault shares, redeemed by KovaSaver back to the wallet. */
export async function saveOut(
  wallet: Address,
  signed: { shares: bigint; deadline: bigint; signature: Hex },
) {
  const vault = savingsVault()
  const helper = saver()
  if (!vault || !helper)
    throw new KovaError('conflict', 'Savings aren’t switched on for this server yet.')
  if (signed.shares <= 0n) throw new KovaError('invalid_request', 'Move out more than $0.00.')
  const [assets, redeemable] = await Promise.all([
    publicClient.readContract({
      address: vault,
      abi: erc4626Abi,
      functionName: 'convertToAssets',
      args: [signed.shares],
    }),
    publicClient
      .readContract({ address: vault, abi: erc4626Abi, functionName: 'maxRedeem', args: [wallet] })
      .catch(() => null),
  ])
  // A vault that keeps some in cash, or waits on a market, can pay out less than all for a while.
  if (redeemable !== null && redeemable < signed.shares) {
    const now =
      redeemable === 0n
        ? 0n
        : await publicClient.readContract({
            address: vault,
            abi: erc4626Abi,
            functionName: 'convertToAssets',
            args: [redeemable],
          })
    throw new KovaError(
      'policy_declined',
      now === 0n
        ? 'Savings can’t pay out right now. Your savings are still yours: try again in a little while.'
        : `You can move ${dollars(now)} out right now.`,
    )
  }
  const { v, r, s, yParity } = parseSignature(signed.signature)
  const data = encodeFunctionData({
    abi: kovaSaverAbi,
    functionName: 'withdraw',
    args: [wallet, signed.shares, signed.deadline, Number(v ?? BigInt(yParity + 27)), r, s],
  })
  const receipt = await sendFromRelayer(helper, data, { maxGas: SAVINGS_MAX_GAS })
  if (receipt.status !== 'success')
    throw new KovaError('chain_error', 'The move out of savings didn’t go through.')
  // What actually came back, as KovaSaver logged it: a vault that swaps on the way out pays a hair
  // under what its shares were worth.
  const paid =
    parseEventLogs({ abi: kovaSaverAbi, eventName: 'Withdrawn', logs: receipt.logs }).find((l) =>
      isAddressEqual(l.address, helper),
    )?.args.assets ?? assets
  await db
    .insert(schema.savingsMoves)
    .values({
      id: uuidv7(),
      wallet: wallet.toLowerCase(),
      network: net,
      vault: vault.toLowerCase(),
      kind: 'out',
      assets: paid,
      txHash: receipt.transactionHash,
    })
    .onConflictDoNothing()
  return { tx_hash: receipt.transactionHash, amount: paid.toString() }
}
