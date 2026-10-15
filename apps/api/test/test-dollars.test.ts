import { runMigrations } from '@kova/db'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { beforeAll, describe, expect, it } from 'vitest'
import { config } from '../src/config.js'
import { claimTestDollars, inAbout, releaseTestDollars } from '../src/services/faucet.js'

/**
 * Test dollars come once a day for each wallet. The claim is the part that protects Kova's
 * treasury, so it is tested against a real database; sending is the chain's part.
 *
 * Requires a local Postgres (DATABASE_URL); migrations are applied here.
 */

const HOUR = 60 * 60 * 1000
const wallet = () => privateKeyToAccount(generatePrivateKey()).address

beforeAll(async () => {
  await runMigrations(config.DATABASE_URL)
})

describe('test dollars, once a day', () => {
  it('pays a wallet once, then says when it can have more', async () => {
    const who = wallet()
    const now = new Date('2026-09-27T09:00:00Z')
    expect(await claimTestDollars(who, now)).toEqual({ ok: true })
    const again = await claimTestDollars(who, new Date(now.getTime() + 3 * HOUR))
    expect(again).toEqual({ ok: false, nextAt: new Date('2026-09-28T09:00:00Z') })
  })

  it('pays again a day later, and counts the day from then', async () => {
    const who = wallet()
    const first = new Date('2026-09-27T09:00:00Z')
    await claimTestDollars(who, first)
    const nextDay = new Date(first.getTime() + 24 * HOUR + 1)
    expect(await claimTestDollars(who, nextDay)).toEqual({ ok: true })
    expect(await claimTestDollars(who, new Date(nextDay.getTime() + HOUR))).toMatchObject({
      ok: false,
    })
  })

  it('pays only one of two taps at the same moment', async () => {
    const who = wallet()
    const now = new Date()
    const results = await Promise.all([
      claimTestDollars(who, now),
      claimTestDollars(who, now),
      claimTestDollars(who, now),
    ])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
  })

  it('treats the address the same however it is written', async () => {
    const who = wallet()
    await claimTestDollars(who)
    expect(await claimTestDollars(who.toLowerCase() as `0x${string}`)).toMatchObject({ ok: false })
  })

  it('gives the day back when nothing was sent', async () => {
    const who = wallet()
    await claimTestDollars(who)
    await releaseTestDollars(who)
    expect(await claimTestDollars(who)).toEqual({ ok: true })
  })
})

describe('when a wallet can have more', () => {
  const now = new Date('2026-09-27T09:00:00Z')
  const later = (ms: number) => new Date(now.getTime() + ms)
  it('says it in hours or minutes', () => {
    expect(inAbout(later(7 * HOUR), now)).toBe('in 7 hours')
    expect(inAbout(later(HOUR + 5 * 60_000), now)).toBe('in an hour')
    expect(inAbout(later(40 * 60_000), now)).toBe('in 40 minutes')
    expect(inAbout(later(20_000), now)).toBe('in a minute')
  })
})
