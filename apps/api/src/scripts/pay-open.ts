/**
 * Pays the charges that are currently waiting, the way a customer would.
 *
 * Useful when you have a charge on screen and want to watch it settle:
 *   pnpm pay:open
 *
 * Testnet only. The payer is a throwaway customer funded from the local API's faucet.
 */
import { schema } from '@kova/db'
import { and, eq } from 'drizzle-orm'
import { config } from '../config.js'
import { db } from '../db.js'
import { encodeId } from '../ids.js'
import { fund, getCheckout, newCustomer, pay } from './customer.js'

async function main() {
  if (config.KOVA_NETWORK !== 'testnet') throw new Error('pay:open is testnet only')
  const api = `http://localhost:${config.PORT}`

  const open = await db.query.paymentIntents.findMany({
    where: and(
      eq(schema.paymentIntents.status, 'requires_payment'),
      eq(schema.paymentIntents.network, 'testnet'),
    ),
  })
  const payable = open.filter((intent) => intent.expiresAt.getTime() > Date.now())
  if (payable.length === 0) {
    console.log('nothing waiting')
    process.exit(0)
  }

  const customer = newCustomer()
  await fund(api, customer.address)
  for (const intent of payable) {
    const checkout = await getCheckout(api, encodeId('paymentIntent', intent.id))
    const paid = await pay(api, checkout, customer)
    console.log(
      `${intent.reference ?? checkout.id}: ${paid.status} in ${paid.roundTripMs}ms  ${paid.payment.explorer_url}`,
    )
  }
  process.exit(0)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
