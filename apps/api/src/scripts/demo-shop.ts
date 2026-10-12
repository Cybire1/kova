/**
 * The shared demo shop that "Explore the demo shop" opens: Ada's Bakery, with its menu and photos,
 * six tables, a five-stamp card, and a few real sales so the dashboard has a day to show.
 *
 * Usage: FUNDER_KEY=0x… tsx src/scripts/demo-shop.ts <api> [--sales <stall slug>]
 * `--sales` only adds the sample sales to a demo shop made before (if funding timed out the first time).
 * Testnet only. Writes the shop's secret key and its settlement wallet's key to apps/api/.env.demo-shop
 * (gitignored) and prints neither; the web's DEMO_API_KEY is then set from that file.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { networkByChainId, toSignedAuthorization, tokenByAddress, transferAuthorizationTypedData } from '@kova/monad'
import { type Hex, parseUnits, toHex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { getCheckout, pay } from './customer.js'

const api = process.argv[2] ?? 'https://api-monad.up.railway.app'
const funderKey = process.env.FUNDER_KEY as Hex | undefined
if (!funderKey) throw new Error('FUNDER_KEY is required')

const ASSETS = new URL('../../../mobile/assets/demo/', import.meta.url)
const MENU = [
  { name: 'Sourdough loaf', price: '6.50', description: 'Slow-proved, with a crackly crust', category: 'Breads', stock: 8, photo: 'bakery-loaf.png' },
  { name: 'Baguette', price: '3.00', description: 'Baked three times a day', category: 'Breads', stock: 14, photo: 'bakery-baguette.png' },
  { name: 'Croissant', price: '3.25', description: 'All butter, baked this morning', category: 'Pastries', stock: 12, photo: 'bakery-croissant.png' },
  { name: 'Cinnamon bun', price: '3.75', description: 'Cardamom sugar on top', category: 'Pastries', stock: 9, photo: 'bakery-bun.png' },
  { name: 'Chocolate cookie', price: '2.50', description: 'Sea salt and dark chocolate', category: 'Pastries', stock: 20, photo: 'bakery-cookie.png' },
  { name: 'Carrot cake', price: '5.00', description: 'Cream cheese frosting', category: 'Cakes', stock: 6, photo: 'bakery-cake.png' },
  { name: 'Flat white', price: '4.50', description: 'Double shot, whole milk', category: 'Coffee', stock: null, photo: 'bakery-flatwhite.png' },
  { name: 'Iced latte', price: '4.75', description: 'Over ice, oat milk on request', category: 'Coffee', stock: null, photo: 'bakery-latte.png' },
]

async function call<T>(path: string, init: RequestInit & { key?: string; raw?: boolean } = {}): Promise<T> {
  const { key, raw, ...rest } = init
  const res = await fetch(`${api}${path}`, {
    ...rest,
    headers: { ...(raw ? {} : { 'content-type': 'application/json' }), ...(key ? { authorization: `Bearer ${key}` } : {}) },
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(body)}`)
  return body as T
}

const health = await call<{ chain_id: number; network: string; settlement_token: { address: Hex } }>('/health')
if (health.network !== 'testnet') throw new Error('demo-shop is testnet only')
const network = networkByChainId(health.chain_id)
const token = tokenByAddress(network.id, health.settlement_token.address)
if (!token) throw new Error('unknown settlement token')

const salesOnly = process.argv[3] === '--sales' ? process.argv[4] : undefined
let slug: string
let itemIds: string[]
if (salesOnly) {
  const stall = await call<{ slug: string; items: { id: string; name: string }[] }>(`/v1/public/stalls/${salesOnly}`)
  slug = stall.slug
  itemIds = MENU.map((m) => stall.items.find((i) => i.name === m.name)?.id ?? '')
} else {
  // The shop, paid into a wallet of its own, its key kept with the shop's secret key.
  const settlementKey = generatePrivateKey()
  const settlement = privateKeyToAccount(settlementKey)
  const shop = await call<{ id: string; key: string; name: string }>('/v1/merchants', {
    method: 'POST',
    body: JSON.stringify({ name: 'Ada’s Bakery', settlement_address: settlement.address, country: 'GB' }),
  })
  const envFile = new URL('../../.env.demo-shop', import.meta.url)
  writeFileSync(envFile, `# The shared demo shop (Ada's Bakery, ${shop.id}), made by src/scripts/demo-shop.ts.\nDEMO_API_KEY=${shop.key}\nDEMO_SHOP_SETTLEMENT_KEY=${settlementKey}\n`, { mode: 0o600 })
  console.log(`shop ${shop.id}: keys written to apps/api/.env.demo-shop`)

  itemIds = []
  for (const item of MENU) {
    const { photo, ...fields } = item
    const image = await call<{ id: string }>('/v1/images', { method: 'POST', body: readFileSync(new URL(photo, ASSETS)), key: shop.key, raw: true })
    const created = await call<{ id: string }>('/v1/catalog/items', { method: 'POST', body: JSON.stringify({ ...fields, image_id: image.id }), key: shop.key })
    itemIds.push(created.id)
  }
  const stall = await call<{ id: string; slug: string }>('/v1/stalls', {
    method: 'POST',
    body: JSON.stringify({ name: 'Ada’s Bakery', tagline: 'Bread, buns and good coffee', item_ids: itemIds, table_count: 6, loyalty_every: 5 }),
    key: shop.key,
  })
  slug = stall.slug
  console.log(`stall /s/${slug} with ${itemIds.length} items, 6 tables, a 5-stamp card`)
}

// A few real sales, so the dashboard has a morning to show: a customer funded the way Kova Pay sends.
const funder = privateKeyToAccount(funderKey)
const customer = privateKeyToAccount(generatePrivateKey())
const send = { from: funder.address, to: customer.address, value: parseUnits('25', 6), validAfter: 0n, validBefore: BigInt(Math.floor(Date.now() / 1000) + 600), nonce: toHex(BigInt(generatePrivateKey()), { size: 32 }) }
await call('/v1/transfers', { method: 'POST', body: JSON.stringify(toSignedAuthorization(token.address, send, await funder.signTypedData(transferAuthorizationTypedData(token, network.chainId, send)))) })
const id = (name: string) => itemIds[MENU.findIndex((m) => m.name === name)] as string
const sales: { lines: [string, number][]; table?: string; name: string }[] = [
  { lines: [['Flat white', 1], ['Croissant', 1]], table: '3', name: 'Sam' },
  { lines: [['Sourdough loaf', 1]], name: 'Lucía' },
  { lines: [['Iced latte', 2], ['Cinnamon bun', 1]], table: '5', name: 'Maya' },
]
for (const sale of sales) {
  const placed = await call<{ checkout: { id: string } }>(`/v1/public/stalls/${slug}/orders`, {
    method: 'POST',
    body: JSON.stringify({ items: sale.lines.map(([n, q]) => ({ id: id(n), quantity: q })), customer_name: sale.name, payer: customer.address, ...(sale.table ? { table: sale.table } : {}) }),
  })
  const paid = await pay(api, await getCheckout(api, placed.checkout.id), customer)
  console.log(`sale for ${sale.name}: $${paid.amount} in ${(paid.roundTripMs / 1000).toFixed(2)} s`)
}
