import { schema } from '@kova/db'
import { eq } from 'drizzle-orm'
import { type Address, getAddress } from 'viem'
import { db } from '../db.js'

/**
 * Whether an address is a shop's KovaSplitter, for the relayer: a payment to one is submitted
 * through it, so the sale is shared out as it lands. A short cache keeps this off the payment's
 * critical path after the first look.
 */
const known = new Map<string, { splitter: boolean; at: number }>()
const TTL = 60_000

export async function splitterAt(address: Address): Promise<Address | null> {
  const key = address.toLowerCase()
  const cached = known.get(key)
  if (cached && Date.now() - cached.at < TTL) return cached.splitter ? getAddress(key) : null
  const row = await db.query.merchants.findFirst({
    columns: { id: true },
    where: eq(schema.merchants.splitterAddress, key),
  })
  known.set(key, { splitter: Boolean(row), at: Date.now() })
  return row ? getAddress(key) : null
}

/** After a shop's splits change. */
export function forgetSplitter(address: string) {
  known.delete(address.toLowerCase())
}
