import { Hono } from 'hono'
import { z } from 'zod'
import { KovaError } from '../errors.js'
import { clientIp } from '../limits.js'
import { askJev, jevReady } from '../services/jev.js'

/**
 * "Spending categories": Kova Pay sends a few payments in plain words ("Paid Mama Ada's Kitchen:
 * 2 × Jollof rice") and Jev sorts each into a category for the monthly picture. Nothing is
 * stored: the wallet keeps its own history, and this only answers.
 */
export const CATEGORIES = {
  food: 'Eating and drinking out: restaurants, cafés, street food, bakeries, bars',
  groceries: 'Groceries and household shopping at markets and supermarkets',
  travel: 'Flights, hotels and trips',
  transport: 'Rides, taxis, buses, fuel and parking',
  shopping: 'Clothes, electronics, beauty and other shopping',
  bills: 'Bills, rent, airtime, data and subscriptions',
  health: 'Pharmacy, clinics and health',
  people: 'Money sent to family and friends',
  other: 'Anything that fits none of these',
} as const

const hits = new Map<string, number[]>()

const body = z.object({
  payments: z
    .array(z.object({ id: z.string().min(1).max(64), text: z.string().trim().min(1).max(200) }))
    .min(1)
    .max(40),
})

export const insightRoutes = new Hono().post('/insights/categories', async (c) => {
  const ip = clientIp(c)
  const now = Date.now()
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 600_000)
  if (recent.length >= 30) throw new KovaError('rate_limited', 'Try again in a few minutes.')
  hits.set(ip, [...recent, now])

  const parsed = body.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success)
    throw new KovaError('invalid_request', 'Expected { payments: [{ id, text }] }')
  if (!jevReady()) return c.json({ object: 'categories', ready: false, data: {} })

  // Each payment is its own question about its own field, answered independently.
  const payments = parsed.data.payments
  const state = Object.fromEntries(payments.map((p, i) => [`p${i}`, p.text]))
  const questions = Object.fromEntries(
    payments.map((_, i) => [
      `p${i}`,
      {
        type: 'choice' as const,
        instructions: `Which spending category best fits the payment described in \`p${i}\`?`,
        criteria: { ...CATEGORIES },
      },
    ]),
  )
  const answers = await askJev(state, questions, 6000)
  const data: Record<string, string> = {}
  payments.forEach((p, i) => {
    const choice = answers?.[`p${i}`]?.choice
    if (choice && choice in CATEGORIES) data[p.id] = choice
  })
  return c.json({ object: 'categories', ready: true, data })
})
