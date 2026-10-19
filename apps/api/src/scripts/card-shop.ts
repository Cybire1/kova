import { schema, uuidv7 } from '@kova/db'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { generateApiKey } from '../auth.js'
import { db } from '../db.js'

/**
 * Development: a shop to tap Kova Cards at. Prints its key and a pairing code for a phone, so a
 * simulator can become its till with `kova://dev?pair=<code>&mode=terminal`.
 *   tsx --env-file=.env --env-file=.env.monad src/scripts/card-shop.ts [name] [api url]
 */
const name = process.argv[2] ?? 'Corner Bakery'
const api = process.argv[3] ?? 'http://localhost:4400'
const merchantId = uuidv7()
await db.insert(schema.merchants).values({
  id: merchantId,
  name,
  slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${merchantId.slice(-6)}`,
  settlementAddress: privateKeyToAccount(generatePrivateKey()).address,
  network: 'testnet',
  isTest: true,
})
const key = generateApiKey(true)
await db.insert(schema.apiKeys).values({
  id: uuidv7(),
  merchantId,
  name: 'card-shop',
  prefix: key.prefix,
  secretHash: key.secretHash,
  scopes: ['payments:read', 'payments:write'],
  isTest: true,
})
const pairing = (await (
  await fetch(`${api}/v1/terminals/pairings`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key.secret}` },
  })
).json()) as { code: string }
console.log(JSON.stringify({ key: key.secret, code: pairing.code.replace('-', '') }))
process.exit(0)
