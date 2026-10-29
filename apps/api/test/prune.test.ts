import { runMigrations, schema, uuidv7 } from '@kova/db'
import { eq, inArray } from 'drizzle-orm'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { beforeAll, describe, expect, it } from 'vitest'
import { config } from '../src/config.js'
import { db } from '../src/db.js'
import { pruneReport, pruneTransfers } from '../src/workers/prune.js'

/**
 * The transfer index keeps everything that touches Kova and lets go of old transfers between
 * strangers. Against a real database (DATABASE_URL), which also proves every table and column the
 * prune names exists.
 */

beforeAll(async () => {
  await runMigrations(config.DATABASE_URL)
})

const someone = () => privateKeyToAccount(generatePrivateKey()).address.toLowerCase()
const DAY = 86_400_000

async function transfer(from: string, to: string, daysAgo: number) {
  const id = uuidv7()
  await db.insert(schema.transfers).values({
    id,
    network: config.KOVA_NETWORK,
    tokenAddress: `0x${'a'.repeat(40)}`,
    fromAddress: from,
    toAddress: to,
    amount: 1_000_000n,
    txHash: `0x${id.replace(/-/g, '').padEnd(64, '0')}`,
    logIndex: 0,
    blockNumber: 1n,
    createdAt: new Date(Date.now() - daysAgo * DAY),
  })
  return id
}

describe('pruning the transfer index', () => {
  it('lets old transfers between strangers go, and keeps Kova’s and anything recent', async () => {
    const kova = someone()
    await db.insert(schema.noteKeys).values({ address: kova, publicKey: 'k', signature: 's' })
    const oldStrangers = await transfer(someone(), someone(), 45)
    const oldToKova = await transfer(someone(), kova, 45)
    const oldFromKova = await transfer(kova, someone(), 45)
    const newStrangers = await transfer(someone(), someone(), 2)

    const before = await pruneReport(30)
    expect(before.remove).toBeGreaterThanOrEqual(1)
    const removed = await pruneTransfers(30, 2)
    expect(removed).toBe(before.remove)

    const left = await db
      .select({ id: schema.transfers.id })
      .from(schema.transfers)
      .where(inArray(schema.transfers.id, [oldStrangers, oldToKova, oldFromKova, newStrangers]))
    expect(left.map((r) => r.id).sort()).toEqual([oldToKova, oldFromKova, newStrangers].sort())
    expect((await pruneReport(30)).remove).toBe(0)
    await db.delete(schema.noteKeys).where(eq(schema.noteKeys.address, kova))
  })
})
