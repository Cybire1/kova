/**
 * A real visit to a stall's table, for the film: a fresh customer orders from table 3 and pays,
 * then buys four more times to fill the stamp card, then gets the cheapest item free (paid for $0).
 * Every number the film shows comes from this run; it writes them to film/public/spot/run.json.
 *
 * Usage: FUNDER_KEY=0x… tsx src/scripts/table-run.ts <api> <slug> [table] [table|stamps|all]
 * `table` stops after the table order, so the shop can mark it ready on camera; `stamps` then carries
 * on with the same customer (CUSTOMER_KEY, printed by the first part).
 * Testnet only. The customer's dollars come from FUNDER_KEY, sent the way Kova Pay sends (signed, and
 * submitted by Kova); every payment after that is signed by the customer the same way, so nobody holds MON.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  networkByChainId,
  tokenByAddress,
  toSignedAuthorization,
  transferAuthorizationTypedData,
} from '@kova/monad'
import { type Hex, parseUnits, toHex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { type Checkout, getCheckout, pay } from './customer.js'

const [api = 'https://api-monad.up.railway.app', slug = 'adas-bakery', table = '3', part = 'all'] =
  process.argv.slice(2)
const funderKey = process.env.FUNDER_KEY as Hex | undefined
if (!funderKey) throw new Error('FUNDER_KEY is required')

interface Stall {
  name: string
  loyalty_every: number | null
  items: { id: string; name: string; price: string }[]
}
interface Placed {
  id: string
  reward: { name: string; amount: string } | null
  checkout: { id: string; amount: string }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${api}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json' },
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(body)}`)
  return body as T
}

const health = await call<{
  chain_id: number
  network: string
  settlement_token: { address: Hex }
}>('/health')
if (health.network !== 'testnet') throw new Error('table-run is testnet only')
const network = networkByChainId(health.chain_id)
const stall = await call<Stall>(`/v1/public/stalls/${slug}`)
if (!stall.loyalty_every) throw new Error(`${stall.name} has no stamp card: set one first`)
const item = (name: string) => {
  const found = stall.items.find((i) => i.name === name)
  if (!found) throw new Error(`${stall.name} doesn't sell ${name}`)
  return found
}

const resumed = process.env.CUSTOMER_KEY as Hex | undefined
const customerKey = resumed ?? generatePrivateKey()
const customer = privateKeyToAccount(customerKey)
if (!resumed) {
  const funder = privateKeyToAccount(funderKey)
  const token = tokenByAddress(network.id, health.settlement_token.address)
  if (!token) throw new Error('unknown settlement token')
  const send = {
    from: funder.address,
    to: customer.address,
    value: parseUnits('40', 6),
    validAfter: 0n,
    validBefore: BigInt(Math.floor(Date.now() / 1000) + 600),
    nonce: toHex(BigInt(generatePrivateKey()), { size: 32 }),
  }
  const sendSig = await funder.signTypedData(
    transferAuthorizationTypedData(token, network.chainId, send),
  )
  const funded = await call<{ tx_hash?: string }>('/v1/transfers', {
    method: 'POST',
    body: JSON.stringify(toSignedAuthorization(token.address, send, sendSig)),
  })
  console.log(
    `customer ${customer.address}, funded $40 (${funded.tx_hash ?? JSON.stringify(funded)})`,
  )
}

async function visit(lines: [string, number][], atTable?: string) {
  const placed = await call<Placed>(`/v1/public/stalls/${slug}/orders`, {
    method: 'POST',
    body: JSON.stringify({
      items: lines.map(([name, quantity]) => ({ id: item(name).id, quantity })),
      customer_name: 'Sam',
      payer: customer.address,
      ...(atTable ? { table: atTable } : {}),
    }),
  })
  const checkout: Checkout = await getCheckout(api, placed.checkout.id)
  const paid = await pay(api, checkout, customer)
  const row = {
    order: placed.id,
    checkout: placed.checkout.id,
    amount: checkout.amount,
    reward: placed.reward,
    tx: paid.payment.tx_hash,
    explorer: paid.payment.explorer_url,
    seconds: (paid.roundTripMs / 1000).toFixed(2),
  }
  console.log(JSON.stringify(row))
  return row
}

const runFile = new URL('../../../../film/public/spot/run.json', import.meta.url)
let first: Awaited<ReturnType<typeof visit>>
if (part === 'stamps') {
  first = JSON.parse(readFileSync(runFile, 'utf8')).tableOrder
} else {
  first = await visit(
    [
      ['Flat white', 1],
      ['Croissant', 1],
    ],
    table,
  )
  if (part === 'table') {
    writeFileSync(
      runFile,
      `${JSON.stringify({ slug, table, customer: customer.address, total: `$${first.amount}`, seconds: first.seconds, tableOrder: first, every: stall.loyalty_every }, null, 2)}\n`,
    )
    // A throwaway testnet key, kept out of the log, so the second part can carry on as the same customer.
    const keyFile = join(tmpdir(), 'kova-table-run.key')
    writeFileSync(keyFile, customerKey, { mode: 0o600 })
    console.log(`customer key in ${keyFile}: CUSTOMER_KEY=$(cat ${keyFile})`)
    process.exit(0)
  }
}
const visits = [first]
for (let i = 1; i < stall.loyalty_every; i++) visits.push(await visit([['Croissant', 1]]))
const card = await call<{ stamps: number; ready: boolean }>(
  `/v1/public/stalls/${slug}/stamps?payer=${customer.address}`,
)
console.log('card', JSON.stringify(card))
const free = await visit([['Croissant', 1]])
const after = await call<{ stamps: number }>(
  `/v1/public/stalls/${slug}/stamps?payer=${customer.address}`,
)

const run = {
  note: `Real run at ${stall.name} on Monad testnet, ${new Date().toISOString()} (apps/api/src/scripts/table-run.ts).`,
  slug,
  table,
  customer: customer.address,
  total: `$${first.amount}`,
  seconds: first.seconds,
  tableOrder: first,
  every: stall.loyalty_every,
  stamps: visits,
  cardBeforeFree: card,
  free,
  stampsAfterFree: after.stamps,
}
writeFileSync(runFile, `${JSON.stringify(run, null, 2)}\n`)
console.log('wrote film/public/spot/run.json')
