/**
 * Kova for Business, end to end on Monad testnet, through a Kova API: a business opens its shop
 * from its wallet, keeps a payroll book, pays three people privately in one run (each to a
 * one-time address made from their own key, with a sealed note), checks each one landed, and pays
 * a supplier. Then one of the people finds their pay and opens the note with their own keys.
 *
 * Usage: OWNER_KEY=0x… tsx src/scripts/business-check.ts [api] [--seed-only]
 *   OWNER_KEY holds a dollar or so of AUSD (it pays). --seed-only fills the book without paying,
 *   for screenshots. The shop's session key is written to $BUSINESS_KEY_FILE when set.
 */
import { writeFileSync } from 'node:fs'
import {
  formatAmount,
  generateStealthPayment,
  networkByChainId,
  openStealthMemo,
  parseAmount,
  personalStealthKeysMessage,
  randomNonce,
  stealthKeysFromSignature,
  stealthMetaAddress,
  stealthRegistrationMessage,
  tokenByAddress,
  toSignedAuthorization,
  transferAuthorizationTypedData,
} from '@kova/monad'
import { type Address, type Hex, isAddressEqual, recoverMessageAddress } from 'viem'
import { generatePrivateKey, type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts'

const args = process.argv.slice(2)
const api = args.find((a) => a.startsWith('http')) ?? 'http://localhost:4412'
const seedOnly = args.includes('--seed-only')
const ownerKey = process.env.OWNER_KEY as Hex | undefined
if (!ownerKey) throw new Error('OWNER_KEY is required')

const health = (await (await fetch(`${api}/health`)).json()) as {
  chain_id: number
  network: string
  settlement_token: { address: Address }
}
if (health.network !== 'testnet') throw new Error('business-check is testnet only')
const net = networkByChainId(health.chain_id)
const token = tokenByAddress(net.id, health.settlement_token.address)
if (!token) throw new Error('unknown settlement token')

let failures = 0
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures += 1
}

async function call<T>(path: string, init: RequestInit & { key?: string } = {}): Promise<T> {
  const response = await fetch(`${api}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.key ? { authorization: `Bearer ${init.key}` } : {}),
    },
  })
  const body = (await response.json().catch(() => ({}))) as T & { error?: { message: string } }
  if (!response.ok)
    throw new Error(`${init.method ?? 'GET'} ${path}: ${body.error?.message ?? response.status}`)
  return body
}

const owner = privateKeyToAccount(ownerKey)
const business = 'Mama Put Kitchen'

// 1. The business opens its shop from its wallet: the wallet signs, no password.
const domain = process.env.SIGN_IN_DOMAIN ?? 'localhost:3012'
const challenge = await call<{ message: string }>('/v1/sign_in/challenge', {
  method: 'POST',
  body: JSON.stringify({
    address: owner.address,
    domain,
    uri: `http://${domain}`,
    purpose: 'open_shop',
  }),
})
const shop = await call<{ id: string; key: string }>('/v1/merchants', {
  method: 'POST',
  body: JSON.stringify({
    name: business,
    settlement_address: owner.address,
    country: 'NG',
    owner: {
      message: challenge.message,
      signature: await owner.signMessage({ message: challenge.message }),
    },
  }),
})
const key = shop.key
if (process.env.BUSINESS_KEY_FILE)
  writeFileSync(process.env.BUSINESS_KEY_FILE, key, { mode: 0o600 })
console.log(`business ${business} (${shop.id}), paid for by ${owner.address}`)

// 2. Three people, each with a Kova wallet that has published its own private-receiving key.
async function person(
  name: string,
): Promise<{ name: string; account: PrivateKeyAccount; viewing: Hex; spending: Hex }> {
  const account = privateKeyToAccount(generatePrivateKey())
  const keys = stealthKeysFromSignature(
    await account.signMessage({ message: personalStealthKeysMessage(account.address) }),
  )
  const meta = stealthMetaAddress(keys)
  await call(`/v1/wallets/${account.address}/stealth`, {
    method: 'PUT',
    body: JSON.stringify({
      meta_address: meta,
      signature: await account.signMessage({
        message: stealthRegistrationMessage(account.address, meta),
      }),
    }),
  })
  return { name, account, viewing: keys.viewingPrivateKey, spending: keys.spendingPrivateKey }
}
const staff = await Promise.all([
  person('Tunde Bakare'),
  person('Amaka Obi'),
  person('Kemi Adeyemi'),
])
const pay = seedOnly ? ['250', '180', '120'] : ['0.05', '0.05', '0.05']
const people: { id: string; wallet_address: string }[] = []
for (const [i, s] of staff.entries())
  people.push(
    await call<{ id: string; wallet_address: string }>('/v1/business/people', {
      method: 'POST',
      key,
      body: JSON.stringify({ name: s.name, wallet_address: s.account.address, amount: pay[i] }),
    }),
  )
// Someone who hasn't opened Kova yet: in the book, flagged, and left out of private pay.
const newcomer = privateKeyToAccount(generatePrivateKey())
await call('/v1/business/people', {
  method: 'POST',
  key,
  body: JSON.stringify({ name: 'Chidi Okafor', wallet_address: newcomer.address, amount: '150' }),
})
check(
  (await call<{ data: unknown[] }>('/v1/business/people', { key })).data.length === 4,
  'the payroll book holds four people',
)

// Two suppliers abroad.
const supplierWallet = privateKeyToAccount(generatePrivateKey()).address
const supplier = await call<{ id: string }>('/v1/business/suppliers', {
  method: 'POST',
  key,
  body: JSON.stringify({
    name: 'Shenzhen Parts Co',
    wallet_address: supplierWallet,
    country: 'China',
    currency: 'USD',
  }),
})
await call('/v1/business/suppliers', {
  method: 'POST',
  key,
  body: JSON.stringify({
    name: 'Lisbon Coffee Roasters',
    wallet_address: privateKeyToAccount(generatePrivateKey()).address,
    country: 'Portugal',
    currency: 'EUR',
  }),
})
check(
  (await call<{ data: unknown[] }>('/v1/business/suppliers', { key })).data.length === 2,
  'two suppliers saved, with their countries and currencies',
)

if (seedOnly) {
  console.log(failures === 0 ? '\nseeded' : `\n${failures} check(s) failed`)
  process.exit(failures === 0 ? 0 : 1)
}

/** Kova relays a transfer the owner signed; `stealth` makes it a private payment. */
async function send(
  to: Address,
  value: bigint,
  stealth?: { ephemeral_public_key: Hex; view_tag: Hex; sealed: Hex | null },
) {
  const t = token as NonNullable<typeof token>
  const authorization = {
    from: owner.address,
    to,
    value,
    validAfter: 0n,
    validBefore: BigInt(Math.floor(Date.now() / 1000) + 600),
    nonce: randomNonce(),
  }
  const signature = await owner.signTypedData(
    transferAuthorizationTypedData(t, net.chainId, authorization),
  )
  const started = performance.now()
  const sent = await call<{ tx_hash: Hex }>('/v1/transfers', {
    method: 'POST',
    body: JSON.stringify({
      ...toSignedAuthorization(t.address, authorization, signature),
      ...(stealth ? { stealth } : {}),
    }),
  })
  return { tx: sent.tx_hash, ms: Math.round(performance.now() - started) }
}

// 3. One payroll, three people, privately.
const label = 'October salary'
const run = await call<{ id: string; payments: { id: string; name: string; amount: string }[] }>(
  '/v1/business/payroll',
  {
    method: 'POST',
    key,
    body: JSON.stringify({
      label,
      payments: staff.map((s, i) => ({ person: people[i]?.id, name: s.name, amount: pay[i] })),
    }),
  },
)
const paidTo: Record<string, Address> = {}
for (const [i, p] of run.payments.entries()) {
  const s = staff[i] as (typeof staff)[number]
  const key_ = await call<{ meta_address: string; signature: Hex }>(
    `/v1/wallets/${s.account.address}/stealth`,
  )
  const signer = await recoverMessageAddress({
    message: stealthRegistrationMessage(s.account.address, key_.meta_address),
    signature: key_.signature,
  })
  if (!isAddressEqual(signer, s.account.address))
    throw new Error('a private key Kova returned isn’t theirs')
  const made = generateStealthPayment(key_.meta_address, {
    from: owner.address,
    name: business,
    note: label,
    kind: 'send',
  })
  const sent = await send(made.stealthAddress, parseAmount(p.amount), {
    ephemeral_public_key: made.ephemeralPublicKey,
    view_tag: made.viewTag,
    sealed: made.sealed,
  })
  const recorded = await call<{ status: string }>(
    `/v1/business/payroll/${run.id}/payments/${p.id}`,
    {
      method: 'POST',
      key,
      body: JSON.stringify({ stealth_address: made.stealthAddress, tx_hash: sent.tx }),
    },
  )
  paidTo[s.name] = made.stealthAddress
  check(
    recorded.status === 'paid',
    `${s.name}: $${p.amount} privately in ${sent.ms} ms, checked on Monad: ${sent.tx}`,
  )
}
const after = await call<{ status: string; paid: number; paid_total: string }>(
  `/v1/business/payroll/${run.id}`,
  { key },
)
check(
  after.status === 'paid' && after.paid === 3,
  `the run is paid: ${after.paid} people, $${after.paid_total}`,
)

// 4. A payment that didn't happen can't be written in as paid.
const fake = await call<{ id: string; payments: { id: string }[] }>('/v1/business/payroll', {
  method: 'POST',
  key,
  body: JSON.stringify({ label: 'Not real', payments: [{ name: 'Nobody', amount: '0.05' }] }),
})
const firstTx = (
  await call<{ payments: { tx_hash: Hex }[] }>(`/v1/business/payroll/${run.id}`, { key })
).payments[0]?.tx_hash
const lie = await fetch(`${api}/v1/business/payroll/${fake.id}/payments/${fake.payments[0]?.id}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
  body: JSON.stringify({ stealth_address: supplierWallet, tx_hash: firstTx }),
})
check(lie.status === 400, 'a transaction that paid someone else is refused as proof')

// 5. Tunde finds his pay with his own keys and opens the note.
const tunde = staff[0] as (typeof staff)[number]
const feed = await call<{
  data: { stealth_address: string; ephemeral_public_key: Hex; sealed: Hex | null }[]
}>('/v1/public/stealth/announcements?limit=1000')
const his = feed.data.find(
  (d) => d.stealth_address.toLowerCase() === paidTo[tunde.name]?.toLowerCase(),
)
const memo = his
  ? openStealthMemo(tunde.viewing, {
      ephemeralPublicKey: his.ephemeral_public_key,
      stealthAddress: paidTo[tunde.name] as Address,
      sealed: his.sealed,
    })
  : null
check(
  memo?.name === business && memo.note === label,
  `${tunde.name} opens the note: “${memo?.note}” from ${memo?.name}`,
)

// 6. A supplier, paid in seconds.
const supplierPaid = await send(supplierWallet, parseAmount('0.05'))
const recordedSupplier = await call<{ amount: string }>(
  `/v1/business/suppliers/${supplier.id}/payments`,
  {
    method: 'POST',
    key,
    body: JSON.stringify({ amount: '0.05', tx_hash: supplierPaid.tx, note: 'Spare parts' }),
  },
)
check(
  recordedSupplier.amount === '0.05',
  `paid Shenzhen Parts Co $0.05 in ${supplierPaid.ms} ms: ${supplierPaid.tx}`,
)

const summary = await call<{
  payroll: { paid_this_month: string }
  suppliers: { paid_this_month: string }
}>('/v1/business', { key })
check(
  summary.payroll.paid_this_month === formatAmount(parseAmount('0.15')),
  `this month: $${summary.payroll.paid_this_month} in payroll`,
)
check(
  summary.suppliers.paid_this_month === '0.05',
  `and $${summary.suppliers.paid_this_month} to suppliers`,
)

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
