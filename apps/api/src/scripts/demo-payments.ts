/**
 * Puts realistic traffic through a local Kova: creates charges for the demo merchant and
 * pays most of them through Kova's relayer, leaving one waiting.
 *
 * Usage: pnpm demo:payments [count]
 * Testnet only. The payer is a throwaway customer funded from the local API's faucet.
 */
import { schema } from '@kova/db'
import { eq } from 'drizzle-orm'
import { settlementCurrency } from '../chain.js'
import { config } from '../config.js'
import { db } from '../db.js'
import { encodeId } from '../ids.js'
import { createIntent } from '../services/intents.js'
import { fund, getCheckout, newCustomer, pay } from './customer.js'

const basket = [
  ['Flat white and a croissant', '7.75'],
  ['Sourdough loaf', '6.50'],
  ['Iced latte, 2', '9.50'],
  ['Chocolate cookie', '2.50'],
  ['Fried rice + chicken', '9.00'],
  ['Bottled water', '0.75'],
] as const

async function main() {
  if (config.KOVA_NETWORK !== 'testnet') throw new Error('demo:payments is testnet only')
  const api = `http://localhost:${config.PORT}`

  const merchant = await db.query.merchants.findFirst({
    where: eq(schema.merchants.slug, 'demo-merchant'),
  })
  if (!merchant) throw new Error('run `pnpm setup:dev` first')

  // The customer holds dollars and no MON: Kova's relayer pays the gas.
  const customer = newCustomer()
  await fund(api, customer.address)

  const count = Math.min(Number(process.argv[2] ?? 4), basket.length)
  for (let i = 0; i < count; i++) {
    const [reference, amount] = basket[i] as [string, string]
    const intent = await createIntent({ merchant, amount, currency: settlementCurrency, reference })

    // Leave the last one unpaid, so the dashboard shows a charge still waiting.
    if (i === count - 1) {
      console.log(`${reference.padEnd(24)} ${amount.padStart(6)}  waiting`)
      break
    }

    const checkout = await getCheckout(api, encodeId('paymentIntent', intent.id))
    const paid = await pay(api, checkout, customer)
    console.log(
      `${reference.padEnd(24)} ${amount.padStart(6)}  ${paid.status} in ${paid.roundTripMs}ms`,
    )
    await new Promise((r) => setTimeout(r, 600))
  }
  process.exit(0)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
