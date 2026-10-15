/**
 * Pays one checkout the way a customer's wallet would, against any Kova API:
 *   pnpm pay:checkout pi_06gd2a8qmns8desag4t5149j2r [https://api.example.com]
 *
 * It reads the public checkout, gets a throwaway customer test dollars from that API's faucet,
 * signs an authorization for exactly this charge and hands it to the API, whose relayer pays
 * the gas. Useful for watching a stall order, a till sale or a web charge land. Testnet only.
 */
import { fund, getCheckout, newCustomer, pay } from './customer.js'

async function main() {
  const [id, api = process.env.KOVA_API_URL ?? `http://localhost:${process.env.PORT ?? 4000}`] =
    process.argv.slice(2)
  if (!id) throw new Error('usage: pay:checkout <checkout id> [api url]')

  const checkout = await getCheckout(api, id)
  if (checkout.status !== 'requires_payment')
    throw new Error(`checkout ${id} is ${checkout.status}`)
  if (checkout.network !== 'testnet') throw new Error('pay:checkout is testnet only')

  const customer = newCustomer()
  await fund(api, customer.address)
  const paid = await pay(api, checkout, customer)
  console.log(
    `${paid.status}: ${checkout.amount} ${checkout.currency} to ${checkout.merchant_name} in ${paid.roundTripMs}ms (relay ${paid.payment.ms}ms)`,
  )
  console.log(`  ${paid.payment.explorer_url}`)
  process.exit(paid.status === 'paid' ? 0 : 1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
