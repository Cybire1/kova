/** Times a relayed payment end to end, to find where the milliseconds go. Needs the API running locally. */
import { eq } from 'drizzle-orm'
import { publicClient, settlementCurrency } from '../chain.js'
import { config } from '../config.js'
import { db, schema } from '../db.js'
import { encodeId } from '../ids.js'
import { createIntent } from '../services/intents.js'
import { fund, getCheckout, newCustomer, pay } from './customer.js'

async function time<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const started = performance.now()
  const result = await fn()
  console.log(`${label.padEnd(34)} ${(performance.now() - started).toFixed(0)}ms`)
  return result
}

const api = `http://localhost:${config.PORT}`
const merchant = await db.query.merchants.findFirst({
  where: eq(schema.merchants.slug, 'demo-merchant'),
})
if (!merchant) throw new Error('run setup:dev')

const customer = newCustomer()
await time('faucet (test dollars land)', () => fund(api, customer.address))

// The first payment to a merchant costs more gas (a fresh balance slot); later rounds are the steady state.
for (let round = 1; round <= 3; round++) {
  const intent = await createIntent({ merchant, amount: '1.00', currency: settlementCurrency })
  const checkout = await getCheckout(api, encodeId('paymentIntent', intent.id))
  console.log(`\n--- round ${round}`)
  const paid = await time('tap to PAID (sign + relay + settle)', () => pay(api, checkout, customer))
  console.log(`${'  of which the relay'.padEnd(34)} ${paid.payment.ms}ms`)
}

// The raw chain round trip, as a floor.
console.log()
await time('eth_blockNumber (RPC floor)', () => publicClient.getBlockNumber())
process.exit(0)
