import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { schema, uuidv7 } from '@kova/db'
import {
  claimTypedData,
  formatAmount,
  KEY_DAY,
  KEY_WEEK,
  type KeyKind,
  keyApprovalMessage,
  keyRemoveMessage,
  kovaCardAbi,
  linkTypedData,
  NO_PERMIT,
  paymentTypedData,
  splitPermit,
  unlinkTypedData,
  updateTypedData,
} from '@kova/monad'
import { and, desc, eq, gte, inArray, lt, or, sql } from 'drizzle-orm'
import {
  type Address,
  encodeFunctionData,
  getAddress,
  type Hex,
  isAddressEqual,
  maxUint256,
  recoverMessageAddress,
  recoverTypedDataAddress,
  toHex,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { network, settlementToken } from '../chain.js'
import { config } from '../config.js'
import { db } from '../db.js'
import { KovaError } from '../errors.js'
import { decodeId } from '../ids.js'
import { cardContract, cardsReady, holderNonce, MAX_DAILY_LIMIT, onChainCard, permitState, sendCard } from './cards.js'
import { settleFromReceipt } from './settle.js'

/**
 * Spending keys on Monad: who may spend a wallet's dollars, short of the wallet itself.
 *
 *   allowance  someone's own phone or browser spends up to a limit a day or a week (Mum)
 *   team       a staff member's budget, the same way
 *   agent      an AI agent's key, held by Kova (sealed) and used only once its rules pass
 *
 * Every key is linked to the owner's wallet through the KovaCard contract, exactly as a Kova Card
 * is: the owner signs the link with their passkey and a permit lets the contract draw on the
 * wallet, so Monad itself caps what the key can spend in a day, refuses it while frozen, and only
 * ever pays when the key and Kova's cosigner both sign the same payment. Kova cosigns after its own
 * checks: the weekly total, the end date, the most one payment can be, who it may pay, and for an
 * agent, asking the owner first above a line. Kova never holds anyone's dollars.
 *
 * An allowance's key is never stored anywhere: the recipient's wallet signs spendKeyMessage and the
 * key is the hash of that signature, so the same passkey makes it again on any device.
 */

export type KeyRow = typeof schema.walletKeys.$inferSelect
export type KeyPaymentRow = typeof schema.keyPayments.$inferSelect

const INVITE_TTL_MS = 7 * 24 * 3600_000
/** How long a recipient's Claim signature can wait for the owner to switch the key on. */
const CLAIM_MAX_S = 8 * 24 * 3600
/** A key's payment signatures are good for this long. */
const PAYMENT_TTL_S = 120
/** Agents' asks lapse if nobody answers within an hour. */
const APPROVAL_TTL_MS = 3600_000
const TOKEN_PREFIX = 18
const MAX_DAYS = 366

const nowS = () => Math.floor(Date.now() / 1000)

export const keysReady = () => cardsReady()
export const agentsReady = () => cardsReady() && Boolean(config.KOVA_KEYS_MASTER_KEY)

export function requireKeys(kind?: KeyKind): { contract: Address; cosigner: ReturnType<typeof privateKeyToAccount> } {
  if (!cardContract || !config.KOVA_CARD_COSIGNER_KEY || !cardsReady())
    throw new KovaError('conflict', 'Spending keys aren’t switched on for this server yet.')
  if (kind === 'agent' && !config.KOVA_KEYS_MASTER_KEY)
    throw new KovaError('conflict', 'Agent keys aren’t switched on for this server yet.')
  return { contract: cardContract, cosigner: privateKeyToAccount(config.KOVA_CARD_COSIGNER_KEY as Hex) }
}

// ── Sealing an agent's key ──────────────────────────────────────────────────────────────────

function masterKey(): Buffer {
  if (!config.KOVA_KEYS_MASTER_KEY) throw new KovaError('conflict', 'Agent keys aren’t switched on for this server yet.')
  return Buffer.from(config.KOVA_KEYS_MASTER_KEY.slice(2), 'hex')
}

function seal(privateKey: Hex, keyId: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv)
  cipher.setAAD(Buffer.from(keyId))
  const body = Buffer.concat([cipher.update(Buffer.from(privateKey.slice(2), 'hex')), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url')
}

function unseal(sealed: string, keyId: string): Hex {
  const raw = Buffer.from(sealed, 'base64url')
  const decipher = createDecipheriv('aes-256-gcm', masterKey(), raw.subarray(0, 12))
  decipher.setAAD(Buffer.from(keyId))
  decipher.setAuthTag(raw.subarray(12, 28))
  return `0x${Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('hex')}` as Hex
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

function agentAccount(row: KeyRow) {
  if (!row.sealedKey) throw new KovaError('internal', 'This agent key has no key.')
  return privateKeyToAccount(unseal(row.sealedKey, row.id))
}

// ── Reading ─────────────────────────────────────────────────────────────────────────────────

export async function keyRow(id: string): Promise<KeyRow | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined
  return db.query.walletKeys.findFirst({ where: eq(schema.walletKeys.id, id) })
}

export async function ownedKey(owner: Address, id: string): Promise<KeyRow> {
  const row = await keyRow(id)
  if (!row || !isAddressEqual(row.ownerAddress as Address, owner) || row.status === 'removed')
    throw new KovaError('not_found', 'No such key for this wallet.')
  return row
}

/** The keys a wallet gave (owner), and the allowances and budgets it was given (holder). */
export async function keysOf(wallet: Address): Promise<{ given: KeyRow[]; received: KeyRow[] }> {
  const address = wallet.toLowerCase()
  const rows = await db.query.walletKeys.findMany({
    where: and(
      eq(schema.walletKeys.network, network.id),
      sql`${schema.walletKeys.status} <> 'removed'`,
      or(eq(schema.walletKeys.ownerAddress, address), eq(schema.walletKeys.holderAddress, address)),
    ),
    orderBy: [desc(schema.walletKeys.createdAt)],
  })
  const fresh = rows.filter((r) => !(r.status === 'invited' && r.createdAt.getTime() < Date.now() - INVITE_TTL_MS))
  return {
    given: fresh.filter((r) => r.ownerAddress === address),
    received: fresh.filter((r) => r.holderAddress === address && (r.status === 'active' || r.status === 'frozen')),
  }
}

/** The start of the key's current period: midnight UTC today, or Monday midnight UTC this week. */
function periodStart(row: Pick<KeyRow, 'period'>, at = new Date()): Date {
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()))
  if (row.period !== KEY_WEEK) return day
  const back = (day.getUTCDay() + 6) % 7
  return new Date(day.getTime() - back * 86_400_000)
}

async function spentSince(rowId: string, since: Date): Promise<bigint> {
  const [sum] = await db
    .select({ total: sql<string>`coalesce(sum(${schema.keyPayments.amount}), 0)` })
    .from(schema.keyPayments)
    .where(
      and(
        eq(schema.keyPayments.walletKeyId, rowId),
        inArray(schema.keyPayments.status, ['paid', 'paying']),
        gte(schema.keyPayments.createdAt, since),
      ),
    )
  return BigInt(sum?.total ?? '0')
}

/** What Monad caps a day at: the limit itself, or for a weekly limit, the whole week's. */
const dailyCap = (row: Pick<KeyRow, 'spendLimit'>) => row.spendLimit

export async function serializeKey(row: KeyRow, options: { chain?: boolean } = {}) {
  const [spent, spentToday] = await Promise.all([
    spentSince(row.id, periodStart(row)),
    spentSince(row.id, periodStart({ period: KEY_DAY })),
  ])
  const chain =
    options.chain && row.keyAddress && (row.status === 'active' || row.status === 'frozen')
      ? await onChainCard(getAddress(row.keyAddress)).catch(() => null)
      : null
  const left = row.spendLimit > spent ? row.spendLimit - spent : 0n
  const rules = row.rules
  return {
    object: 'key',
    id: row.id,
    kind: row.kind,
    name: row.label,
    owner: getAddress(row.ownerAddress),
    owner_name: row.ownerName,
    holder: row.holderAddress ? getAddress(row.holderAddress) : null,
    holder_name: row.holderName,
    key_address: row.keyAddress ? getAddress(row.keyAddress) : null,
    status: row.status,
    frozen: row.status === 'frozen' || (chain?.frozen ?? false),
    limit: formatAmount(row.spendLimit),
    period: row.period === KEY_WEEK ? 'week' : 'day',
    daily_limit: formatAmount(dailyCap(row)),
    spent: formatAmount(spent),
    spent_today: formatAmount(spentToday),
    left: formatAmount(chain && chain.left < left ? chain.left : left),
    ends_at: row.expiresAt.toISOString(),
    rules: rules
      ? {
          per_payment: formatAmount(BigInt(rules.perPayment)),
          ask_above: formatAmount(BigInt(rules.approveAbove)),
          payees: rules.payees === 'anyone' ? 'anyone' : rules.payees.map((p) => getAddress(p)),
        }
      : null,
    link_tx: row.linkTxHash,
    last_used_at: row.lastUsedAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  }
}

export function serializePayment(row: KeyPaymentRow, key?: KeyRow) {
  return {
    object: 'key_payment',
    id: row.id,
    key: row.walletKeyId,
    key_name: key?.label ?? null,
    kind: row.kind,
    to: getAddress(row.recipient),
    amount: formatAmount(row.amount),
    description: row.description,
    status: row.status,
    reason: row.reason,
    tx_hash: row.txHash,
    created_at: row.createdAt.toISOString(),
  }
}

export async function paymentsOf(keyIds: string[], limit = 50): Promise<KeyPaymentRow[]> {
  if (keyIds.length === 0) return []
  return db.query.keyPayments.findMany({
    where: and(inArray(schema.keyPayments.walletKeyId, keyIds), sql`${schema.keyPayments.status} <> 'prepared'`),
    orderBy: [desc(schema.keyPayments.createdAt)],
    limit,
  })
}

// ── Terms ───────────────────────────────────────────────────────────────────────────────────

export interface Terms {
  label: string
  limit: bigint
  period: 'day' | 'week'
  days: number
}

function checkTerms(terms: Terms) {
  if (!terms.label.trim()) throw new KovaError('invalid_request', 'Say who it’s for.')
  if (terms.limit <= 0n || terms.limit > MAX_DAILY_LIMIT)
    throw new KovaError('invalid_request', `A limit is between $0.01 and $${formatAmount(MAX_DAILY_LIMIT)}.`)
  if (!Number.isInteger(terms.days) || terms.days < 1 || terms.days > MAX_DAYS)
    throw new KovaError('invalid_request', 'A key lasts between a day and a year.')
}

// ── Allowances and team budgets: an invite the recipient accepts on their own device ────────

export async function createInvite(
  owner: Address,
  input: Terms & { kind: 'allowance' | 'team'; ownerName?: string | undefined },
): Promise<{ row: KeyRow; code: string }> {
  requireKeys()
  checkTerms(input)
  const code = randomBytes(12).toString('base64url')
  const [row] = await db
    .insert(schema.walletKeys)
    .values({
      id: uuidv7(),
      network: network.id,
      ownerAddress: owner.toLowerCase(),
      ownerName: input.ownerName?.trim().slice(0, 40) || null,
      kind: input.kind,
      label: input.label.trim().slice(0, 40),
      spendLimit: input.limit,
      period: input.period === 'week' ? KEY_WEEK : KEY_DAY,
      expiresAt: new Date(Date.now() + input.days * 86_400_000),
      inviteHash: sha256(code),
      status: 'invited',
    })
    .returning()
  if (!row) throw new KovaError('internal', 'The invite wasn’t saved.')
  return { row, code }
}

async function inviteRow(code: string): Promise<KeyRow> {
  const row = /^[A-Za-z0-9_-]{8,64}$/.test(code)
    ? await db.query.walletKeys.findFirst({ where: eq(schema.walletKeys.inviteHash, sha256(code)) })
    : undefined
  if (!row || row.status === 'removed' || row.network !== network.id) throw new KovaError('not_found', 'This invite isn’t open.')
  return row
}

export async function inviteFor(code: string) {
  const row = await inviteRow(code)
  const expired = row.status === 'invited' && row.createdAt.getTime() < Date.now() - INVITE_TTL_MS
  return {
    object: 'key_invite',
    id: row.id,
    kind: row.kind,
    name: row.label,
    owner: getAddress(row.ownerAddress),
    owner_name: row.ownerName,
    limit: formatAmount(row.spendLimit),
    period: row.period === KEY_WEEK ? 'week' : 'day',
    ends_at: row.expiresAt.toISOString(),
    status: expired ? 'expired' : row.status,
    holder: row.holderAddress ? getAddress(row.holderAddress) : null,
    contract: cardContract,
    chain_id: network.chainId,
  }
}

/**
 * The recipient accepts: their wallet made the key on their device and the key signed KovaCard's
 * Claim (so nobody can link a key they don't hold). It spends nothing until the owner switches it on.
 */
export async function acceptInvite(
  code: string,
  input: { holder: Address; holderName?: string | undefined; key: Address; claimSignature: Hex; claimDeadline: bigint },
): Promise<KeyRow> {
  const { contract } = requireKeys()
  const row = await inviteRow(code)
  if (row.status !== 'invited' || row.createdAt.getTime() < Date.now() - INVITE_TTL_MS)
    throw new KovaError('conflict', 'This invite has already been used or has run out.')
  if (isAddressEqual(row.ownerAddress as Address, input.holder))
    throw new KovaError('invalid_request', 'This is your own invite. Send the link to the person it’s for.')
  const deadline = Number(input.claimDeadline)
  if (deadline < nowS() + 3600 || deadline > nowS() + CLAIM_MAX_S)
    throw new KovaError('invalid_request', 'That approval’s time is off. Try again.')
  const signer = await recoverTypedDataAddress({
    ...claimTypedData(network.chainId, contract, {
      card: input.key,
      holder: getAddress(row.ownerAddress),
      deadline: input.claimDeadline,
    }),
    signature: input.claimSignature,
  }).catch(() => null)
  if (!signer || !isAddressEqual(signer, input.key))
    throw new KovaError('invalid_request', 'The key’s signature doesn’t match. Try again.')
  const taken = await db.query.walletKeys.findFirst({ where: eq(schema.walletKeys.keyAddress, input.key.toLowerCase()) })
  if (taken && taken.id !== row.id) throw new KovaError('conflict', 'That key is already in use.')

  const [updated] = await db
    .update(schema.walletKeys)
    .set({
      holderAddress: input.holder.toLowerCase(),
      holderName: input.holderName?.trim().slice(0, 40) || null,
      keyAddress: input.key.toLowerCase(),
      claimSignature: input.claimSignature,
      claimDeadline: deadline,
      status: 'accepted',
      updatedAt: new Date(),
    })
    .where(and(eq(schema.walletKeys.id, row.id), eq(schema.walletKeys.status, 'invited')))
    .returning()
  if (!updated) throw new KovaError('conflict', 'This invite has already been used.')
  return updated
}

// ── Agents: a key Kova holds, with rules ────────────────────────────────────────────────────

export interface AgentTerms extends Terms {
  perPayment: bigint
  approveAbove: bigint
  payees: 'anyone' | Address[]
}

export async function createAgent(owner: Address, input: AgentTerms & { ownerName?: string | undefined }): Promise<KeyRow> {
  requireKeys('agent')
  checkTerms(input)
  if (input.perPayment <= 0n || input.perPayment > input.limit)
    throw new KovaError('invalid_request', 'The most one payment can be is between $0.01 and the key’s limit.')
  if (input.approveAbove < 0n || input.approveAbove > input.perPayment)
    throw new KovaError('invalid_request', 'The ask-first line is at most the most one payment can be.')
  if (input.payees !== 'anyone' && (input.payees.length === 0 || input.payees.length > 20))
    throw new KovaError('invalid_request', 'List between 1 and 20 wallets it may pay, or let it pay anyone.')
  const id = uuidv7()
  const privateKey = generatePrivateKey()
  const key = privateKeyToAccount(privateKey).address
  const [row] = await db
    .insert(schema.walletKeys)
    .values({
      id,
      network: network.id,
      ownerAddress: owner.toLowerCase(),
      ownerName: input.ownerName?.trim().slice(0, 40) || null,
      kind: 'agent',
      label: input.label.trim().slice(0, 40),
      keyAddress: key.toLowerCase(),
      holderAddress: null,
      spendLimit: input.limit,
      period: input.period === 'week' ? KEY_WEEK : KEY_DAY,
      expiresAt: new Date(Date.now() + input.days * 86_400_000),
      rules: {
        perPayment: input.perPayment.toString(),
        approveAbove: input.approveAbove.toString(),
        payees: input.payees === 'anyone' ? 'anyone' : input.payees.map((p) => p.toLowerCase()),
      },
      sealedKey: seal(privateKey, id),
      status: 'accepted',
    })
    .returning()
  if (!row) throw new KovaError('internal', 'The key wasn’t saved.')
  return row
}

/** Finds the agent a bearer token belongs to. Only the hash is stored; the prefix finds the row. */
export async function agentForToken(token: string | undefined): Promise<KeyRow> {
  if (!token || !token.startsWith('kova_agent_') || token.length < 40)
    throw new KovaError('unauthorized', 'Send this agent key’s token as a Bearer token.')
  const row = await db.query.walletKeys.findFirst({
    where: eq(schema.walletKeys.tokenPrefix, token.slice(0, TOKEN_PREFIX)),
  })
  const expected = Buffer.from(row?.tokenHash ?? '0'.repeat(64), 'hex')
  const given = Buffer.from(sha256(token), 'hex')
  if (!row || row.kind !== 'agent' || !timingSafeEqual(expected, given) || row.status === 'removed')
    throw new KovaError('unauthorized', 'This agent key isn’t valid any more. Its owner can make a new one.')
  return row
}

// ── Switching a key on: the owner's link, relayed ───────────────────────────────────────────

/** What the owner signs to switch a key on, and whether a permit is still needed. */
export async function linkPlan(row: KeyRow) {
  const { contract } = requireKeys(row.kind as KeyKind)
  if (row.status !== 'accepted' || !row.keyAddress)
    throw new KovaError('conflict', row.status === 'invited' ? 'Nobody has accepted this invite yet.' : 'This key is already on.')
  let deadline = row.claimDeadline ?? 0
  if (row.kind === 'agent' || deadline < nowS() + 120) {
    if (row.kind !== 'agent') throw new KovaError('conflict', 'This invite’s approval ran out. Send a new one.')
    deadline = nowS() + 600
    await db.update(schema.walletKeys).set({ claimDeadline: deadline }).where(eq(schema.walletKeys.id, row.id))
  }
  const owner = getAddress(row.ownerAddress)
  const [nonce, permit] = await Promise.all([holderNonce(owner), permitState(owner)])
  return {
    object: 'key_link_plan',
    key: row.id,
    contract,
    chain_id: network.chainId,
    holder: owner,
    card: getAddress(row.keyAddress),
    daily_limit: dailyCap(row).toString(),
    nonce: nonce.toString(),
    deadline,
    permit: {
      needed: permit.allowance < maxUint256 / 2n,
      nonce: permit.nonce.toString(),
      value: maxUint256.toString(),
      token: { address: settlementToken.address, domain: settlementToken.domain },
    },
  }
}

export async function activateKey(
  row: KeyRow,
  input: { holderSignature: Hex; permit: { value: bigint; deadline: bigint; signature: Hex } | null },
): Promise<{ row: KeyRow; token: string | null }> {
  const { contract } = requireKeys(row.kind as KeyKind)
  if (row.status !== 'accepted' || !row.keyAddress || !row.claimDeadline)
    throw new KovaError('conflict', 'This key can’t be switched on right now.')
  const owner = getAddress(row.ownerAddress)
  const card = getAddress(row.keyAddress)
  const deadline = BigInt(row.claimDeadline)
  if (Number(deadline) < nowS() + 5) throw new KovaError('invalid_request', 'That approval ran out. Try again.')

  const nonce = await holderNonce(owner)
  const holderSigner = await recoverTypedDataAddress({
    ...linkTypedData(network.chainId, contract, { holder: owner, card, dailyLimit: dailyCap(row), nonce, deadline }),
    signature: input.holderSignature,
  }).catch(() => null)
  if (!holderSigner || !isAddressEqual(holderSigner, owner))
    throw new KovaError('invalid_request', 'The wallet’s approval doesn’t match. Try again.')

  const claimSignature =
    row.kind === 'agent'
      ? await agentAccount(row).signTypedData(claimTypedData(network.chainId, contract, { card, holder: owner, deadline }))
      : (row.claimSignature as Hex)
  const permit = input.permit ? splitPermit(input.permit.value, input.permit.deadline, input.permit.signature) : NO_PERMIT
  const receipt = await sendCard(
    contract,
    encodeFunctionData({
      abi: kovaCardAbi,
      functionName: 'link',
      args: [owner, card, dailyCap(row), deadline, input.holderSignature, claimSignature, permit],
    }),
  )

  let token: string | null = null
  const values: Partial<typeof schema.walletKeys.$inferInsert> = {
    status: 'active',
    linkTxHash: receipt.transactionHash,
    updatedAt: new Date(),
  }
  if (row.kind === 'agent') {
    token = `kova_agent_${randomBytes(30).toString('base64url')}`
    values.tokenPrefix = token.slice(0, TOKEN_PREFIX)
    values.tokenHash = sha256(token)
  }
  const [updated] = await db.update(schema.walletKeys).set(values).where(eq(schema.walletKeys.id, row.id)).returning()
  return { row: updated as KeyRow, token }
}

// ── Freeze, unfreeze, remove ────────────────────────────────────────────────────────────────

export async function updatePlan(row: KeyRow, frozen: boolean) {
  const { contract } = requireKeys()
  if (!row.keyAddress || (row.status !== 'active' && row.status !== 'frozen'))
    throw new KovaError('conflict', 'This key isn’t on yet.')
  const owner = getAddress(row.ownerAddress)
  return {
    object: 'key_update_plan',
    contract,
    chain_id: network.chainId,
    holder: owner,
    card: getAddress(row.keyAddress),
    daily_limit: dailyCap(row).toString(),
    frozen,
    nonce: (await holderNonce(owner)).toString(),
    deadline: nowS() + 600,
  }
}

export async function setFrozen(
  row: KeyRow,
  input: { frozen: boolean; deadline: bigint; holderSignature: Hex },
): Promise<KeyRow> {
  const { contract } = requireKeys()
  if (!row.keyAddress || (row.status !== 'active' && row.status !== 'frozen'))
    throw new KovaError('conflict', 'This key isn’t on yet.')
  if (Number(input.deadline) < nowS() + 5 || Number(input.deadline) > nowS() + 1200)
    throw new KovaError('invalid_request', 'That approval ran out. Try again.')
  const owner = getAddress(row.ownerAddress)
  const card = getAddress(row.keyAddress)
  const nonce = await holderNonce(owner)
  const signer = await recoverTypedDataAddress({
    ...updateTypedData(network.chainId, contract, {
      holder: owner,
      card,
      dailyLimit: dailyCap(row),
      frozen: input.frozen,
      nonce,
      deadline: input.deadline,
    }),
    signature: input.holderSignature,
  }).catch(() => null)
  if (!signer || !isAddressEqual(signer, owner)) throw new KovaError('invalid_request', 'The wallet’s approval doesn’t match. Try again.')
  // A freeze bites now: Kova stops cosigning at once, before the chain hears of it.
  if (input.frozen)
    await db.update(schema.walletKeys).set({ status: 'frozen', updatedAt: new Date() }).where(eq(schema.walletKeys.id, row.id))
  await sendCard(
    contract,
    encodeFunctionData({
      abi: kovaCardAbi,
      functionName: 'update',
      args: [card, dailyCap(row), input.frozen, input.deadline, input.holderSignature],
    }),
  )
  const [updated] = await db
    .update(schema.walletKeys)
    .set({ status: input.frozen ? 'frozen' : 'active', updatedAt: new Date() })
    .where(eq(schema.walletKeys.id, row.id))
    .returning()
  return updated as KeyRow
}

export async function removePlan(row: KeyRow) {
  const { contract } = requireKeys()
  const owner = getAddress(row.ownerAddress)
  if (row.keyAddress && (row.status === 'active' || row.status === 'frozen'))
    return {
      object: 'key_remove_plan',
      on_chain: true,
      contract,
      chain_id: network.chainId,
      holder: owner,
      card: getAddress(row.keyAddress),
      nonce: (await holderNonce(owner)).toString(),
      deadline: nowS() + 600,
    }
  return { object: 'key_remove_plan', on_chain: false, message: keyRemoveMessage({ owner, keyId: row.id }) }
}

export async function removeKey(row: KeyRow, input: { deadline?: bigint | undefined; signature: Hex }): Promise<KeyRow> {
  const { contract } = requireKeys()
  const owner = getAddress(row.ownerAddress)
  let txHash: Hex | null = null
  if (row.keyAddress && (row.status === 'active' || row.status === 'frozen')) {
    if (!input.deadline) throw new KovaError('invalid_request', 'Missing the approval’s deadline.')
    const card = getAddress(row.keyAddress)
    const nonce = await holderNonce(owner)
    const signer = await recoverTypedDataAddress({
      ...unlinkTypedData(network.chainId, contract, { holder: owner, card, nonce, deadline: input.deadline }),
      signature: input.signature,
    }).catch(() => null)
    if (!signer || !isAddressEqual(signer, owner)) throw new KovaError('invalid_request', 'The wallet’s approval doesn’t match. Try again.')
    // Off for Kova at once; the chain follows.
    await db.update(schema.walletKeys).set({ status: 'frozen', updatedAt: new Date() }).where(eq(schema.walletKeys.id, row.id))
    const receipt = await sendCard(
      contract,
      encodeFunctionData({ abi: kovaCardAbi, functionName: 'unlink', args: [card, input.deadline, input.signature] }),
    )
    txHash = receipt.transactionHash
  } else {
    const signer = await recoverMessageAddress({
      message: keyRemoveMessage({ owner, keyId: row.id }),
      signature: input.signature,
    }).catch(() => null)
    if (!signer || !isAddressEqual(signer, owner)) throw new KovaError('invalid_request', 'The wallet’s approval doesn’t match. Try again.')
  }
  const [updated] = await db
    .update(schema.walletKeys)
    .set({ status: 'removed', removedTxHash: txHash, tokenHash: null, sealedKey: null, updatedAt: new Date() })
    .where(eq(schema.walletKeys.id, row.id))
    .returning()
  return updated as KeyRow
}

// ── The rules ───────────────────────────────────────────────────────────────────────────────

type Verdict = { kind: 'pay' } | { kind: 'ask' } | { kind: 'deny'; reason: string }

async function judge(row: KeyRow, amount: bigint, to: Address, approved: boolean): Promise<Verdict> {
  if (row.status === 'frozen') return { kind: 'deny', reason: 'This key is frozen by its owner.' }
  if (row.status !== 'active' || !row.keyAddress) return { kind: 'deny', reason: 'This key isn’t switched on.' }
  if (row.expiresAt < new Date()) return { kind: 'deny', reason: 'This key has ended. Its owner can make a new one.' }
  if (amount <= 0n) return { kind: 'deny', reason: 'A payment has to move some money.' }
  if (isAddressEqual(to, row.ownerAddress as Address)) return { kind: 'deny', reason: 'That would pay the owner their own money.' }
  const rules = row.rules
  if (rules) {
    if (amount > BigInt(rules.perPayment))
      return { kind: 'deny', reason: `That’s over this key’s limit of $${formatAmount(BigInt(rules.perPayment))} a payment.` }
    if (rules.payees !== 'anyone' && !rules.payees.some((p) => isAddressEqual(p as Address, to)))
      return { kind: 'deny', reason: 'This key may only pay the wallets its owner listed.' }
  }
  const spent = await spentSince(row.id, periodStart(row))
  if (spent + amount > row.spendLimit) {
    const left = row.spendLimit > spent ? row.spendLimit - spent : 0n
    return { kind: 'deny', reason: `That’s over what this key has left this ${row.period === KEY_WEEK ? 'week' : 'day'}: $${formatAmount(left)}.` }
  }
  const chain = await onChainCard(getAddress(row.keyAddress))
  if (!isAddressEqual(chain.holder, row.ownerAddress as Address)) return { kind: 'deny', reason: 'This key isn’t linked on Monad any more.' }
  if (chain.frozen) return { kind: 'deny', reason: 'This key is frozen by its owner.' }
  if (chain.left < amount) {
    const dayLeft = chain.dailyLimit > chain.spentToday ? chain.dailyLimit - chain.spentToday : 0n
    return {
      kind: 'deny',
      reason:
        dayLeft < amount
          ? `That’s over what Monad lets this key spend today: $${formatAmount(dayLeft)}.`
          : 'There isn’t enough money in the wallet behind this key.',
    }
  }
  if (rules && !approved && amount > BigInt(rules.approveAbove)) return { kind: 'ask' }
  return { kind: 'pay' }
}

async function record(row: KeyRow, values: Omit<typeof schema.keyPayments.$inferInsert, 'id' | 'walletKeyId'>) {
  const [payment] = await db
    .insert(schema.keyPayments)
    .values({ id: uuidv7(), walletKeyId: row.id, ...values })
    .returning()
  return payment as KeyPaymentRow
}

async function settle(payment: KeyPaymentRow, values: Partial<typeof schema.keyPayments.$inferInsert>) {
  const [updated] = await db
    .update(schema.keyPayments)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(schema.keyPayments.id, payment.id))
    .returning()
  if (values.status === 'paid')
    await db.update(schema.walletKeys).set({ lastUsedAt: new Date() }).where(eq(schema.walletKeys.id, payment.walletKeyId))
  return updated as KeyPaymentRow
}

const why = (error: unknown) => {
  const e = error as { shortMessage?: string; message?: string }
  return (e.shortMessage ?? e.message ?? String(error)).split('\n')[0]?.slice(0, 300) ?? 'unknown'
}

const randomMemo = () => toHex(randomBytes(32))

function paymentData(contract: Address, row: KeyRow, payment: KeyPaymentRow) {
  return paymentTypedData(network.chainId, contract, {
    card: getAddress(row.keyAddress as string),
    to: getAddress(payment.recipient),
    amount: payment.amount,
    memo: payment.memo as Hex,
    deadline: BigInt(payment.deadline ?? 0),
  })
}

/** Cosigns and sends a payment the key has signed. The payment is claimed first, so it pays once. */
async function cosignAndSend(row: KeyRow, payment: KeyPaymentRow, keySignature: Hex): Promise<KeyPaymentRow> {
  const { contract, cosigner } = requireKeys()
  const typed = paymentData(contract, row, payment)
  const [claimed] = await db
    .update(schema.keyPayments)
    .set({ status: 'paying', updatedAt: new Date() })
    .where(and(eq(schema.keyPayments.id, payment.id), inArray(schema.keyPayments.status, ['prepared', 'approved'])))
    .returning()
  if (!claimed) throw new KovaError('conflict', 'This payment is already being paid.')
  try {
    const cosignature = await cosigner.signTypedData(typed)
    const receipt = await sendCard(
      contract,
      encodeFunctionData({
        abi: kovaCardAbi,
        functionName: 'pay',
        args: [
          getAddress(row.keyAddress as string),
          getAddress(payment.recipient),
          payment.amount,
          payment.memo as Hex,
          BigInt(payment.deadline ?? 0),
          keySignature,
          cosignature,
        ],
      }),
    )
    // A Kova charge's memo settles it: the shop's till turns to paid now.
    if (payment.kind === 'charge') await settleFromReceipt(receipt).catch(() => {})
    return settle(claimed, { status: 'paid', txHash: receipt.transactionHash })
  } catch (error) {
    return settle(claimed, { status: 'failed', reason: error instanceof KovaError ? error.message : why(error) })
  }
}

// ── A Kova charge ───────────────────────────────────────────────────────────────────────────

export function chargeIdFrom(text: string): string | null {
  return /\bpi_[0-9a-z]{26}\b/.exec(text)?.[0] ?? null
}

async function openCharge(chargeId: string) {
  const uuid = decodeId('paymentIntent', chargeId)
  const intent = uuid ? await db.query.paymentIntents.findFirst({ where: eq(schema.paymentIntents.id, uuid) }) : undefined
  if (!intent) throw new KovaError('not_found', 'No such Kova charge.')
  if (intent.status !== 'requires_payment') throw new KovaError('conflict', `This charge is ${intent.status.replace('_', ' ')}.`)
  if (intent.expiresAt < new Date()) throw new KovaError('conflict', 'This charge has expired. Ask the shop for a new one.')
  if (!isAddressEqual(intent.tokenAddress as Address, settlementToken.address))
    throw new KovaError('invalid_request', 'This charge is in a different dollar than Kova keys pay in.')
  const merchant = await db.query.merchants.findFirst({ where: eq(schema.merchants.id, intent.merchantId) })
  return { intent, shop: merchant?.name ?? 'A Kova shop' }
}

// ── Spending from an allowance or a team budget (the key is on the holder's device) ─────────

/** The holder wants to pay: check the key may, and give back the exact payment for it to sign. */
export async function preparePayment(
  row: KeyRow,
  input: { holder: Address; to?: Address | undefined; amount?: bigint | undefined; charge?: string | undefined; note?: string | undefined },
): Promise<{ payment: KeyPaymentRow; typedData: ReturnType<typeof paymentTypedData> }> {
  const { contract } = requireKeys()
  if (row.kind === 'agent' || !row.holderAddress || !isAddressEqual(row.holderAddress as Address, input.holder))
    throw new KovaError('forbidden', 'Only the person this key was given to can spend it.')
  let to: Address
  let amount: bigint
  let memo: Hex = randomMemo()
  let description = input.note?.trim().slice(0, 200) || null
  let kind = 'pay'
  if (input.charge) {
    const { intent, shop } = await openCharge(input.charge)
    to = getAddress(intent.payTo)
    amount = intent.amount
    memo = intent.memo as Hex
    description = shop
    kind = 'charge'
  } else {
    if (!input.to || !input.amount) throw new KovaError('invalid_request', 'Say who to pay and how much.')
    to = input.to
    amount = input.amount
  }
  const verdict = await judge(row, amount, to, true)
  if (verdict.kind === 'deny') throw new KovaError('policy_declined', verdict.reason)
  const payment = await record(row, {
    kind,
    recipient: to.toLowerCase(),
    amount,
    description,
    status: 'prepared',
    memo,
    deadline: nowS() + PAYMENT_TTL_S,
    request: input.charge ? { charge: input.charge } : null,
  })
  return { payment, typedData: paymentData(contract, row, payment) }
}

export async function paymentRow(id: string): Promise<KeyPaymentRow | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined
  return db.query.keyPayments.findFirst({ where: eq(schema.keyPayments.id, id) })
}

/** The holder's key signed: check it, run the rules once more, cosign and pay. */
export async function completePayment(payment: KeyPaymentRow, signature: Hex): Promise<KeyPaymentRow> {
  const { contract } = requireKeys()
  const row = await keyRow(payment.walletKeyId)
  if (!row || !row.keyAddress) throw new KovaError('not_found', 'No such key.')
  if (payment.status !== 'prepared') throw new KovaError('conflict', `This payment is ${payment.status}.`)
  if ((payment.deadline ?? 0) <= nowS() + 3) throw new KovaError('conflict', 'That took too long. Try again.')
  const signer = await recoverTypedDataAddress({ ...paymentData(contract, row, payment), signature }).catch(() => null)
  if (!signer || !isAddressEqual(signer, row.keyAddress as Address))
    throw new KovaError('invalid_request', 'The key’s signature doesn’t match. Try again.')
  // A prepared payment isn't counted yet, so the rules see what's already been paid, plus this.
  const verdict = await judge(row, payment.amount, getAddress(payment.recipient), true)
  if (verdict.kind === 'deny') return settle(payment, { status: 'denied', reason: verdict.reason })
  return cosignAndSend(row, payment, signature)
}

// ── Agents paying ───────────────────────────────────────────────────────────────────────────

async function agentSend(row: KeyRow, payment: KeyPaymentRow): Promise<KeyPaymentRow> {
  const { contract } = requireKeys('agent')
  const fresh = await settle(payment, { memo: payment.memo ?? randomMemo(), deadline: nowS() + PAYMENT_TTL_S })
  const signature = await agentAccount(row).signTypedData(paymentData(contract, row, fresh))
  return cosignAndSend(row, fresh, signature)
}

export async function agentPay(row: KeyRow, input: { to: Address; amount: bigint; note?: string | undefined }) {
  const verdict = await judge(row, input.amount, input.to, false)
  const base = {
    kind: 'pay',
    recipient: input.to.toLowerCase(),
    amount: input.amount,
    description: input.note?.trim().slice(0, 200) || null,
  }
  if (verdict.kind === 'deny') return record(row, { ...base, status: 'denied', reason: verdict.reason })
  if (verdict.kind === 'ask') return record(row, { ...base, status: 'pending_approval' })
  return agentSend(row, await record(row, { ...base, status: 'prepared', memo: randomMemo() }))
}

export async function agentPayCharge(row: KeyRow, chargeId: string) {
  const { intent, shop } = await openCharge(chargeId)
  const to = getAddress(intent.payTo)
  const base = {
    kind: 'charge',
    recipient: to.toLowerCase(),
    amount: intent.amount,
    description: `${shop}${intent.reference ? ` · ${intent.reference}` : ''}`.slice(0, 200),
    memo: intent.memo,
    request: { charge: chargeId },
  }
  const verdict = await judge(row, intent.amount, to, false)
  if (verdict.kind === 'deny') return record(row, { ...base, status: 'denied', reason: verdict.reason })
  if (verdict.kind === 'ask') return record(row, { ...base, status: 'pending_approval' })
  return agentSend(row, await record(row, { ...base, status: 'prepared' }))
}

export async function describeAgent(row: KeyRow) {
  const key = await serializeKey(row, { chain: true })
  return {
    name: key.name,
    status: key.status,
    limit: `$${key.limit} a ${key.period}`,
    left_this_period: `$${key.left}`,
    spent_today: `$${key.spent_today}`,
    most_per_payment: key.rules ? `$${key.rules.per_payment}` : null,
    owner_approves_above: key.rules ? `$${key.rules.ask_above}` : null,
    may_pay: key.rules?.payees ?? 'anyone',
    ends_at: key.ends_at,
    currency: 'US dollars (AUSD on Monad); Kova pays the network fee',
  }
}

// ── The owner's answer to an agent's ask ────────────────────────────────────────────────────

export async function approvalsFor(owner: Address): Promise<{ payment: KeyPaymentRow; key: KeyRow }[]> {
  const keys = await db.query.walletKeys.findMany({
    where: and(eq(schema.walletKeys.ownerAddress, owner.toLowerCase()), eq(schema.walletKeys.network, network.id)),
  })
  if (keys.length === 0) return []
  const ids = keys.map((k) => k.id)
  await db
    .update(schema.keyPayments)
    .set({ status: 'expired', updatedAt: new Date() })
    .where(
      and(
        inArray(schema.keyPayments.walletKeyId, ids),
        eq(schema.keyPayments.status, 'pending_approval'),
        lt(schema.keyPayments.createdAt, new Date(Date.now() - APPROVAL_TTL_MS)),
      ),
    )
  const waiting = await db.query.keyPayments.findMany({
    where: and(inArray(schema.keyPayments.walletKeyId, ids), eq(schema.keyPayments.status, 'pending_approval')),
    orderBy: [desc(schema.keyPayments.createdAt)],
  })
  return waiting.map((payment) => ({ payment, key: keys.find((k) => k.id === payment.walletKeyId) as KeyRow }))
}

export function approvalMessageFor(owner: Address, payment: KeyPaymentRow, decision: 'approve' | 'decline') {
  return keyApprovalMessage({
    owner,
    paymentId: payment.id,
    decision,
    amount: formatAmount(payment.amount),
    to: payment.description ?? getAddress(payment.recipient),
  })
}

export async function answerApproval(input: {
  owner: Address
  paymentId: string
  decision: 'approve' | 'decline'
  signature: Hex
}): Promise<KeyPaymentRow> {
  const payment = await paymentRow(input.paymentId)
  const key = payment ? await keyRow(payment.walletKeyId) : undefined
  if (!payment || !key || !isAddressEqual(key.ownerAddress as Address, input.owner))
    throw new KovaError('not_found', 'No such payment waiting for this wallet.')
  if (payment.status !== 'pending_approval')
    throw new KovaError('conflict', `This payment is ${payment.status.replace('_', ' ')}, not waiting.`)
  const signer = await recoverMessageAddress({
    message: approvalMessageFor(getAddress(input.owner), payment, input.decision),
    signature: input.signature,
  }).catch(() => null)
  if (!signer || !isAddressEqual(signer, input.owner))
    throw new KovaError('forbidden', 'Only the wallet that owns this key can answer for it.')
  const [claimed] = await db
    .update(schema.keyPayments)
    .set({ status: input.decision === 'approve' ? 'approved' : 'declined', decidedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schema.keyPayments.id, payment.id), eq(schema.keyPayments.status, 'pending_approval')))
    .returning()
  if (!claimed) throw new KovaError('conflict', 'This payment was already answered.')
  if (input.decision === 'decline') return claimed
  if (claimed.kind === 'charge') {
    try {
      const { intent } = await openCharge(String((claimed.request as { charge?: string } | null)?.charge ?? ''))
      if (intent.amount !== claimed.amount) return settle(claimed, { status: 'failed', reason: 'The charge changed.' })
    } catch (error) {
      return settle(claimed, { status: 'failed', reason: why(error) })
    }
  }
  const verdict = await judge(key, claimed.amount, getAddress(claimed.recipient), true)
  if (verdict.kind === 'deny') return settle(claimed, { status: 'failed', reason: verdict.reason })
  return agentSend(key, claimed)
}
