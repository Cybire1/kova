import { runMigrations } from '@kova/db'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { config } from '../src/config.js'
import { app } from '../src/index.js'

/**
 * The iPhone beta's waitlist: anyone can ask with an email; only Kova's team (x-kova-admin) can
 * read the list or mark people invited. Requires a local Postgres (DATABASE_URL).
 */

const saved = config.KOVA_ADMIN_SECRET
const SECRET = 'test-admin-secret-0123456789'

beforeAll(async () => {
  await runMigrations(config.DATABASE_URL)
})

afterEach(() => {
  config.KOVA_ADMIN_SECRET = saved
})

const someone = () => `beta-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`

function join(
  payload: unknown,
  ip = `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
) {
  return app.request('/v1/public/ios-beta', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(payload),
  })
}

describe('the iPhone beta waitlist', () => {
  it('takes an email, once, whatever its case', async () => {
    const email = someone()
    const first = await join({ email, name: 'Ada', source: 'iphone-page' })
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({ status: 'joined', invited: false })

    const again = await join({ email: email.toUpperCase() })
    expect(again.status).toBe(200)
    expect(await again.json()).toMatchObject({ status: 'already' })
  })

  it('records where someone asked from, the wallet’s invite included', async () => {
    for (const source of ['iphone-page', 'home', 'try', 'wallet'])
      expect((await join({ email: someone(), source })).status).toBe(200)
  })

  it('refuses something that isn’t an email, and a source it doesn’t know', async () => {
    expect((await join({ email: 'not-an-email' })).status).toBe(400)
    expect((await join({ email: someone(), source: 'billboard' })).status).toBe(400)
  })

  it('slows down one place signing up again and again', async () => {
    const ip = '10.9.9.9'
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) statuses.push((await join({ email: someone() }, ip)).status)
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true)
    expect(statuses[10]).toBe(429)
  })

  it('keeps the list for Kova’s team only', async () => {
    config.KOVA_ADMIN_SECRET = undefined
    expect(
      (await app.request('/v1/ios-beta.csv', { headers: { 'x-kova-admin': SECRET } })).status,
    ).toBe(404)

    config.KOVA_ADMIN_SECRET = SECRET
    expect((await app.request('/v1/ios-beta.csv')).status).toBe(404)
    expect(
      (await app.request('/v1/ios-beta.csv', { headers: { 'x-kova-admin': `${SECRET}x` } })).status,
    ).toBe(404)
  })

  it('exports the list as CSV and marks people invited', async () => {
    config.KOVA_ADMIN_SECRET = SECRET
    const email = someone()
    await join({ email, name: 'Tunde, from Lagos', country: 'Nigeria', source: 'home' })

    const before = await app.request('/v1/ios-beta.csv', { headers: { 'x-kova-admin': SECRET } })
    expect(before.status).toBe(200)
    expect(before.headers.get('content-type')).toContain('text/csv')
    const row = (await before.text()).split('\n').find((line) => line.startsWith(email))
    expect(row).toMatch(
      new RegExp(
        `^${email.replace(/[.]/g, '\\.')},"Tunde, from Lagos",Nigeria,home,\\d{4}-\\d\\d-\\d\\dT[^,]+,$`,
      ),
    )

    const invited = await app.request('/v1/ios-beta/invited', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-kova-admin': SECRET },
      body: JSON.stringify({ emails: [email] }),
    })
    expect(await invited.json()).toMatchObject({ marked: 1 })

    const after = await (
      await app.request('/v1/ios-beta.csv', { headers: { 'x-kova-admin': SECRET } })
    ).text()
    expect(after.split('\n').find((line) => line.startsWith(email))).toMatch(
      /,\d{4}-\d\d-\d\dT[^,]+Z$/,
    )
    expect(await (await join({ email })).json()).toMatchObject({ status: 'already', invited: true })
  })
})
