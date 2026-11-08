import { schema, uuidv7 } from '@kova/db'
import { formatAmount } from '@kova/monad'
import { and, desc, eq, gte, inArray, isNull } from 'drizzle-orm'
import type { Context } from 'hono'
import { type Address, getAddress, isAddress } from 'viem'
import { generateApiKey } from '../auth.js'
import { db } from '../db.js'
import { KovaError } from '../errors.js'
import { isRole, ROLE_INFO, type Role } from './business-roles.js'
import { SESSION_TTL_MS } from './sign-in.js'

export { isRole, ROLE_INFO, ROLES, type Role, roleMay } from './business-roles.js'

/**
 * Kova for Business: a business's branches, its team and what each role may do, and its audit
 * trail. The owner (the shop's owner_address) can do everything and is never a member. Everyone
 * else signs in with their own Kova wallet and gets a session that can do only what their role
 * allows: anything not listed for a role is refused.
 */

type Merchant = typeof schema.merchants.$inferSelect
export type Member = typeof schema.businessMembers.$inferSelect
export type Branch = typeof schema.businessBranches.$inferSelect

// --- Who did it, for the audit trail -------------------------------------------------------------

export interface Actor {
  kind: 'owner' | 'member' | 'key' | 'terminal'
  /** The member's or the key's id. */
  id: string
  name: string
  member?: Member
}

/** Who's making this request: a team member, a till, the owner signed in, or one of the shop's keys. */
export function actorOf(c: Context): Actor {
  const member = c.get('member') as Member | undefined
  if (member)
    return { kind: 'member', id: member.id, name: `${member.name} (${member.role})`, member }
  const key = c.get('apiKey')
  if (key.terminalId) return { kind: 'terminal', id: key.id, name: key.name }
  if (key.expiresAt) return { kind: 'owner', id: key.id, name: 'Owner' }
  return { kind: 'key', id: key.id, name: key.name }
}

/**
 * Writes one line of the business's audit trail (audit_logs, targeted at the business), with the
 * actor's name as it was, so the trail still reads right after a member leaves. Never fails the
 * request it records.
 */
export async function audit(
  merchantId: string,
  actor: Actor,
  action: string,
  subject?: string | null,
  details?: Record<string, unknown>,
) {
  await db
    .insert(schema.auditLogs)
    .values({
      id: uuidv7(),
      actorType: actor.kind,
      actorId: actor.id,
      action,
      targetType: 'merchant',
      targetId: merchantId,
      metadata: { actor_name: actor.name, subject: subject ?? null, ...(details ?? {}) },
    })
    .catch((e) => console.error('[audit] not written:', action, (e as Error).message))
}

export async function auditTrail(merchantId: string, limit = 100) {
  return db
    .select()
    .from(schema.auditLogs)
    .where(
      and(eq(schema.auditLogs.targetType, 'merchant'), eq(schema.auditLogs.targetId, merchantId)),
    )
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(Math.min(Math.max(limit, 1), 500))
}

const ACTOR_NAMES: Record<string, string> = {
  owner: 'Owner',
  api_key: 'The shop',
  key: 'A shop key',
  terminal: 'A till',
  system: 'Kova',
}

export function serializeAudit(row: typeof schema.auditLogs.$inferSelect) {
  const { actor_name, subject, ...details } = (row.metadata ?? {}) as Record<string, unknown>
  return {
    object: 'audit_event',
    id: row.id,
    actor: {
      kind: row.actorType,
      name:
        typeof actor_name === 'string' ? actor_name : (ACTOR_NAMES[row.actorType] ?? row.actorType),
    },
    action: row.action,
    subject: typeof subject === 'string' ? subject : null,
    details,
    created_at: row.createdAt.toISOString(),
  }
}

// --- Branches -------------------------------------------------------------------------------------

export async function branchesOf(merchantId: string): Promise<Branch[]> {
  return db
    .select()
    .from(schema.businessBranches)
    .where(
      and(
        eq(schema.businessBranches.merchantId, merchantId),
        isNull(schema.businessBranches.archivedAt),
      ),
    )
    .orderBy(schema.businessBranches.createdAt)
}

async function branchRow(merchantId: string, id: string): Promise<Branch> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new KovaError('not_found', 'No such branch.')
  const row = await db.query.businessBranches.findFirst({
    where: and(
      eq(schema.businessBranches.id, id),
      eq(schema.businessBranches.merchantId, merchantId),
    ),
  })
  if (!row || row.archivedAt) throw new KovaError('not_found', 'No such branch.')
  return row
}

const cleanName = (value: string, what: string) => {
  const name = value.trim().replace(/\s+/g, ' ')
  if (name.length < 2 || name.length > 60)
    throw new KovaError('invalid_request', `Give the ${what} a name of 2 to 60 letters.`)
  return name
}

export async function addBranch(merchant: Merchant, input: { name: string; address?: string }) {
  const [row] = await db
    .insert(schema.businessBranches)
    .values({
      id: uuidv7(),
      merchantId: merchant.id,
      name: cleanName(input.name, 'branch'),
      address: input.address?.trim().slice(0, 160) || null,
    })
    .returning()
  if (!row) throw new KovaError('internal', 'Kova couldn’t save that branch. Try again.')
  return row
}

export async function updateBranch(
  merchant: Merchant,
  id: string,
  input: { name?: string; address?: string | null },
) {
  await branchRow(merchant.id, id)
  const [row] = await db
    .update(schema.businessBranches)
    .set({
      ...(input.name !== undefined ? { name: cleanName(input.name, 'branch') } : {}),
      ...(input.address !== undefined
        ? { address: input.address?.trim().slice(0, 160) || null }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.businessBranches.id, id))
    .returning()
  return row as Branch
}

/** Closes a branch: its tills keep working, with no branch, and nobody works there any more. */
export async function archiveBranch(merchant: Merchant, id: string) {
  const row = await branchRow(merchant.id, id)
  await db
    .update(schema.businessBranches)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.businessBranches.id, id))
  await db
    .update(schema.terminals)
    .set({ branchId: null })
    .where(and(eq(schema.terminals.merchantId, merchant.id), eq(schema.terminals.branchId, id)))
  return row
}

/** Each branch's tills, and what its tills took today (UTC), in base units. */
export async function branchFigures(merchantId: string, branches: Branch[]) {
  const tills = await db
    .select({
      id: schema.terminals.id,
      branchId: schema.terminals.branchId,
      name: schema.terminals.name,
    })
    .from(schema.terminals)
    .where(and(eq(schema.terminals.merchantId, merchantId), eq(schema.terminals.status, 'active')))
  const byBranch = new Map<string, { id: string; name: string }[]>()
  for (const t of tills) {
    if (!t.branchId) continue
    byBranch.set(t.branchId, [...(byBranch.get(t.branchId) ?? []), { id: t.id, name: t.name }])
  }
  const start = new Date()
  start.setUTCHours(0, 0, 0, 0)
  const ids = tills.filter((t) => t.branchId).map((t) => t.id)
  const paid = ids.length
    ? await db
        .select({
          terminalId: schema.paymentIntents.terminalId,
          amount: schema.paymentIntents.amount,
        })
        .from(schema.paymentIntents)
        .where(
          and(
            eq(schema.paymentIntents.merchantId, merchantId),
            eq(schema.paymentIntents.status, 'paid'),
            inArray(schema.paymentIntents.terminalId, ids),
            gte(schema.paymentIntents.createdAt, start),
          ),
        )
    : []
  const branchOfTill = new Map(tills.map((t) => [t.id, t.branchId]))
  const today = new Map<string, bigint>()
  for (const p of paid) {
    const b = p.terminalId ? branchOfTill.get(p.terminalId) : null
    if (b) today.set(b, (today.get(b) ?? 0n) + p.amount)
  }
  return new Map(
    branches.map((b) => [b.id, { tills: byBranch.get(b.id) ?? [], today: today.get(b.id) ?? 0n }]),
  )
}

export async function assignTill(merchant: Merchant, terminalId: string, branchId: string | null) {
  if (!/^[0-9a-f-]{36}$/i.test(terminalId)) throw new KovaError('not_found', 'No such till.')
  if (branchId) await branchRow(merchant.id, branchId)
  const [row] = await db
    .update(schema.terminals)
    .set({ branchId })
    .where(and(eq(schema.terminals.id, terminalId), eq(schema.terminals.merchantId, merchant.id)))
    .returning()
  if (!row) throw new KovaError('not_found', 'No such till.')
  return row
}

// --- The team -------------------------------------------------------------------------------------

export async function membersOf(merchantId: string): Promise<Member[]> {
  return db
    .select()
    .from(schema.businessMembers)
    .where(
      and(
        eq(schema.businessMembers.merchantId, merchantId),
        eq(schema.businessMembers.status, 'active'),
      ),
    )
    .orderBy(schema.businessMembers.createdAt)
}

async function memberRow(merchantId: string, id: string): Promise<Member> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new KovaError('not_found', 'No such team member.')
  const row = await db.query.businessMembers.findFirst({
    where: and(
      eq(schema.businessMembers.id, id),
      eq(schema.businessMembers.merchantId, merchantId),
    ),
  })
  if (!row || row.status !== 'active') throw new KovaError('not_found', 'No such team member.')
  return row
}

/** Branch ids a member works at: every one named must be this business's, open. */
async function cleanBranches(merchantId: string, ids: string[] | null | undefined) {
  if (!ids || ids.length === 0) return null
  const open = new Set((await branchesOf(merchantId)).map((b) => b.id))
  const unique = [...new Set(ids)]
  if (unique.some((id) => !open.has(id)))
    throw new KovaError('invalid_request', 'Pick open branches.')
  return unique
}

/** Only the owner hands out or takes back the admin role, or changes an admin. */
function guardAdmins(actor: Actor, role: Role | undefined, current?: Member) {
  if (actor.kind !== 'member') return
  if (role === 'admin' || current?.role === 'admin')
    throw new KovaError('forbidden', 'Only the owner can add, change or remove an admin.')
}

export async function addMember(
  merchant: Merchant,
  actor: Actor,
  input: { wallet: string; name: string; role: string; branch_ids?: string[] | null },
) {
  if (!isAddress(input.wallet, { strict: false }))
    throw new KovaError('invalid_request', 'Add them by their Kova wallet address.')
  if (!isRole(input.role)) throw new KovaError('invalid_request', 'Pick a role.')
  const wallet = getAddress(input.wallet).toLowerCase()
  const owner = (merchant.ownerAddress ?? merchant.settlementAddress).toLowerCase()
  if (wallet === owner) throw new KovaError('invalid_request', 'That’s the owner’s own wallet.')
  guardAdmins(actor, input.role)
  const existing = await db.query.businessMembers.findFirst({
    where: and(
      eq(schema.businessMembers.merchantId, merchant.id),
      eq(schema.businessMembers.wallet, wallet),
      eq(schema.businessMembers.status, 'active'),
    ),
  })
  if (existing) throw new KovaError('conflict', 'They’re already on the team.')
  const [row] = await db
    .insert(schema.businessMembers)
    .values({
      id: uuidv7(),
      merchantId: merchant.id,
      wallet,
      name: cleanName(input.name, 'person'),
      role: input.role,
      branchIds: await cleanBranches(merchant.id, input.branch_ids),
      addedBy: actor.name,
    })
    .returning()
  if (!row) throw new KovaError('internal', 'Kova couldn’t add them. Try again.')
  return row
}

export async function updateMember(
  merchant: Merchant,
  actor: Actor,
  id: string,
  input: { role?: string; name?: string; branch_ids?: string[] | null },
) {
  const current = await memberRow(merchant.id, id)
  if (input.role !== undefined && !isRole(input.role))
    throw new KovaError('invalid_request', 'Pick a role.')
  guardAdmins(actor, input.role as Role | undefined, current)
  if (actor.member?.id === id && input.role !== undefined && input.role !== current.role)
    throw new KovaError('forbidden', 'You can’t change your own role.')
  const [row] = await db
    .update(schema.businessMembers)
    .set({
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.name !== undefined ? { name: cleanName(input.name, 'person') } : {}),
      ...(input.branch_ids !== undefined
        ? { branchIds: await cleanBranches(merchant.id, input.branch_ids) }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.businessMembers.id, id))
    .returning()
  return { before: current, after: row as Member }
}

/** Takes someone off the team, and signs out every session they have on it at once. */
export async function removeMember(merchant: Merchant, actor: Actor, id: string) {
  const current = await memberRow(merchant.id, id)
  guardAdmins(actor, undefined, current)
  if (actor.member?.id === id)
    throw new KovaError('forbidden', 'Ask the owner or an admin to take you off the team.')
  await db
    .update(schema.businessMembers)
    .set({ status: 'removed', removedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.businessMembers.id, id))
  await db
    .update(schema.apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.apiKeys.memberId, id), isNull(schema.apiKeys.revokedAt)))
  return current
}

/** The businesses a wallet is on the team of, newest first. */
export async function membershipsOf(wallet: Address) {
  const rows = await db
    .select({ member: schema.businessMembers, merchant: schema.merchants })
    .from(schema.businessMembers)
    .innerJoin(schema.merchants, eq(schema.merchants.id, schema.businessMembers.merchantId))
    .where(
      and(
        eq(schema.businessMembers.wallet, wallet.toLowerCase()),
        eq(schema.businessMembers.status, 'active'),
        eq(schema.merchants.status, 'active'),
      ),
    )
    .orderBy(desc(schema.businessMembers.createdAt))
  return rows
}

/** A session for a team member: it acts on the business, limited to their role, and lapses. */
export async function openMemberSession(merchant: Merchant, member: Member) {
  const key = generateApiKey(merchant.isTest)
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  const [row] = await db
    .insert(schema.apiKeys)
    .values({
      id: uuidv7(),
      merchantId: merchant.id,
      name: `${member.name} (${member.role})`,
      prefix: key.prefix,
      secretHash: key.secretHash,
      scopes: [`role:${member.role}`],
      memberId: member.id,
      isTest: merchant.isTest,
      expiresAt,
    })
    .returning()
  if (!row) throw new KovaError('internal', 'Could not sign in')
  return { id: row.id, secret: key.secret, expiresAt }
}

export function serializeMember(m: Member, branches: Branch[]) {
  const named = new Map(branches.map((b) => [b.id, b.name]))
  return {
    object: 'business_member',
    id: m.id,
    wallet: getAddress(m.wallet),
    name: m.name,
    role: m.role,
    role_name: isRole(m.role) ? ROLE_INFO[m.role].name : m.role,
    branches: m.branchIds
      ? m.branchIds.map((id) => ({ id, name: named.get(id) ?? 'Closed branch' }))
      : null,
    added_by: m.addedBy,
    created_at: m.createdAt.toISOString(),
  }
}

export function serializeBranch(
  b: Branch,
  figures?: { tills: { id: string; name: string }[]; today: bigint },
) {
  return {
    object: 'business_branch',
    id: b.id,
    name: b.name,
    address: b.address,
    tills: figures?.tills ?? [],
    today: formatAmount(figures?.today ?? 0n),
    created_at: b.createdAt.toISOString(),
  }
}
