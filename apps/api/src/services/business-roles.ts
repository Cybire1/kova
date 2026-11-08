import { schema } from '@kova/db'
import { and, eq } from 'drizzle-orm'
import { db } from '../db.js'
import { KovaError } from '../errors.js'

/**
 * Kova for Business roles: what each one may do, route by route. Kept apart from the rest of the
 * team code so the API's auth can check a member's session without importing it.
 */

type Member = typeof schema.businessMembers.$inferSelect

export const ROLES = ['admin', 'manager', 'accountant', 'cashier', 'viewer'] as const
export type Role = (typeof ROLES)[number]

/** What a role is, in a sentence the app shows when it's picked. */
export const ROLE_INFO: Record<Role, { name: string; says: string }> = {
  admin: {
    name: 'Admin',
    says: 'Runs the business with you: team, branches, tills, books and settings.',
  },
  manager: { name: 'Manager', says: 'Runs their branches: the tills, the menu and the takings.' },
  accountant: {
    name: 'Accountant',
    says: 'Sees everything and keeps the books: payroll and suppliers.',
  },
  cashier: { name: 'Cashier', says: 'Takes payments at the till. Nothing else.' },
  viewer: { name: 'Viewer', says: 'Sees everything, changes nothing.' },
}

/** What a session may do, by kind of action. */
type Capability =
  | 'any'
  | 'till' // what a till needs to read: the shop, its menu, its charges
  | 'read' // everything that isn't a secret
  | 'take_payments'
  | 'catalog'
  | 'tills'
  | 'books'
  | 'team'
  | 'settings'
  | 'audit'
  | 'owner'

const CAN: Record<Role, Capability[]> = {
  admin: [
    'till',
    'read',
    'take_payments',
    'catalog',
    'tills',
    'books',
    'team',
    'settings',
    'audit',
  ],
  manager: ['till', 'read', 'take_payments', 'catalog', 'tills'],
  accountant: ['till', 'read', 'books', 'audit'],
  cashier: ['till', 'take_payments'],
  viewer: ['till', 'read', 'audit'],
}

/**
 * Every route a member's session may reach, and the capability it needs. Paths are after /v1.
 * Anything not here is refused for members (the owner's sessions and the shop's keys aren't
 * checked here).
 */
const RULES: [method: string, path: RegExp, need: Capability][] = [
  ['POST', /^\/sign_out$/, 'any'],
  ['GET', /^\/business\/me$/, 'any'],
  // A till's reads
  ['GET', /^\/account$/, 'till'],
  ['GET', /^\/catalog\/items$/, 'till'],
  ['GET', /^\/catalog\/barcodes\/[^/]+$/, 'till'],
  ['GET', /^\/payment_intents(\/[^/]+)?$/, 'till'],
  ['GET', /^\/summary$/, 'till'],
  ['GET', /^\/orders$/, 'till'],
  // The audit trail, before the general reads below
  ['GET', /^\/business\/audit$/, 'audit'],
  // Everything else that's readable
  ['GET', /^\/business(\/[a-z_]+)?(\/[^/]+)?$/, 'read'],
  ['GET', /^\/stalls(\/[^/]+)?$/, 'read'],
  ['GET', /^\/terminals\/?$/, 'read'],
  ['GET', /^\/private_takings$/, 'read'],
  ['GET', /^\/splits$/, 'read'],
  ['GET', /^\/events$/, 'read'],
  // Taking payments
  ['POST', /^\/payment_intents\/?$/, 'take_payments'],
  ['POST', /^\/payment_intents\/[^/]+\/(cancel|confirm)$/, 'take_payments'],
  ['POST', /^\/orders\/?$/, 'take_payments'],
  ['POST', /^\/orders\/[^/]+\/(collect|status)$/, 'take_payments'],
  ['POST', /^\/catalog\/similar$/, 'take_payments'],
  // The menu and stalls
  ['POST', /^\/catalog\/(items|import)$/, 'catalog'],
  ['PATCH', /^\/catalog\/items\/[^/]+$/, 'catalog'],
  ['DELETE', /^\/catalog\/items\/[^/]+$/, 'catalog'],
  ['POST', /^\/images$/, 'catalog'],
  ['POST', /^\/stalls$/, 'catalog'],
  ['PATCH', /^\/stalls\/[^/]+$/, 'catalog'],
  ['DELETE', /^\/stalls\/[^/]+$/, 'catalog'],
  // Tills
  ['POST', /^\/terminals\/pairings$/, 'tills'],
  ['PATCH', /^\/terminals\/[^/]+$/, 'tills'],
  ['DELETE', /^\/terminals\/[^/]+$/, 'tills'],
  // The books
  ['POST', /^\/business\/people$/, 'books'],
  ['DELETE', /^\/business\/people\/[^/]+$/, 'books'],
  ['POST', /^\/business\/payroll$/, 'books'],
  ['POST', /^\/business\/payroll\/[^/]+\/payments\/[^/]+$/, 'books'],
  ['POST', /^\/business\/suppliers$/, 'books'],
  ['DELETE', /^\/business\/suppliers\/[^/]+$/, 'books'],
  ['POST', /^\/business\/suppliers\/[^/]+\/payments$/, 'books'],
  // The team and branches
  ['POST', /^\/business\/(members|branches)$/, 'team'],
  ['PATCH', /^\/business\/(members|branches)\/[^/]+$/, 'team'],
  ['DELETE', /^\/business\/(members|branches)\/[^/]+$/, 'team'],
  // Settings
  ['PATCH', /^\/account$/, 'settings'],
  ['GET', /^\/api_keys$/, 'settings'],
  ['POST', /^\/api_keys$/, 'settings'],
  ['DELETE', /^\/api_keys\/[^/]+$/, 'settings'],
  ['GET', /^\/webhook_endpoints$/, 'settings'],
  ['POST', /^\/webhook_endpoints(\/[^/]+\/test)?$/, 'settings'],
  ['DELETE', /^\/webhook_endpoints\/[^/]+$/, 'settings'],
  ['PUT', /^\/private_takings$/, 'settings'],
  ['DELETE', /^\/private_takings$/, 'settings'],
  ['POST', /^\/private_takings\/sweep$/, 'settings'],
  ['POST', /^\/splits(\/prepare)?$/, 'settings'],
  // Only the owner
  ['POST', /^\/account\/owner$/, 'owner'],
]

/** Whether a role may make this request. `path` is the request's path, with or without /v1. */
export function roleMay(role: Role, method: string, path: string): boolean {
  const p = path.replace(/^\/v1(?=\/)/, '').replace(/\/+$/, '') || '/'
  const rule = RULES.find(([m, re]) => m === method.toUpperCase() && re.test(p))
  if (!rule) return false
  const need = rule[2]
  return need === 'any' || CAN[role].includes(need)
}

export const isRole = (value: unknown): value is Role =>
  typeof value === 'string' && (ROLES as readonly string[]).includes(value)

/** A member's session's member, active and on this business; refused otherwise. */
export async function activeMember(memberId: string, merchantId: string): Promise<Member> {
  const member = await db.query.businessMembers.findFirst({
    where: and(
      eq(schema.businessMembers.id, memberId),
      eq(schema.businessMembers.merchantId, merchantId),
    ),
  })
  if (!member || member.status !== 'active')
    throw new KovaError('unauthorized', 'You’re no longer on this business’s team.')
  return member
}
