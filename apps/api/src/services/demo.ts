import { timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { schema, uuidv7 } from '@kova/db'
import {
  AUSD_TESTNET_FAUCET,
  claimTypedData,
  eip3009Abi,
  faucetAbi,
  formatAmount,
  kovaCardAbi,
  linkTypedData,
  permitAbi,
  permitTypedData,
  randomNonce,
  transferAuthorizationTypedData,
} from '@kova/monad'
import { HDKey } from '@scure/bip32'
import { entropyToMnemonic, mnemonicToSeed } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { and, desc, eq, gt, isNull } from 'drizzle-orm'
import {
  type Address,
  bytesToHex,
  encodeFunctionData,
  type Hex,
  hexToBytes,
  keccak256,
  maxUint256,
  stringToHex,
} from 'viem'
import { type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts'
import {
  feePayerAccount,
  network,
  publicClient,
  settlementCurrency,
  settlementToken,
} from '../chain.js'
import { config } from '../config.js'
import { db } from '../db.js'
import { KovaError } from '../errors.js'
import { encodeId } from '../ids.js'
import { relayAuthorization, sendFromRelayer } from '../relay.js'
import {
  cardContract,
  cardsReady,
  completeTap,
  linkCard,
  prepareTap,
  tapTypedData,
} from './cards.js'
import { slugify } from './catalog.js'
import { createIntent, type PaymentIntent } from './intents.js'
import { placeOrder } from './orders.js'
import { settleFromReceipt } from './settle.js'

/**
 * The App Review demo account, on testnet only.
 *
 * Kova has no usernames: a wallet is a passkey. App reviewers need a username and password, and
 * often can't make a passkey on a review device, so KOVA_DEMO_USERNAME and KOVA_DEMO_PASSWORD
 * unlock one shared test wallet instead. Its 32-byte secret (KOVA_DEMO_SECRET) stands where a
 * passkey's PRF output would: the app derives the same wallet from it, the same way.
 *
 * So that a reviewer finds a lived-in app rather than empty screens, Kova keeps the account
 * stocked: test dollars, friends who have paid it, a shop with photographed items and a stall,
 * a Kova Card with taps, purchases at another shop, and fresh sales and orders every few hours,
 * since the till's Today screen counts from midnight.
 */

export const demoReady = () =>
  Boolean(
    config.KOVA_NETWORK === 'testnet' &&
      config.KOVA_DEMO_USERNAME &&
      config.KOVA_DEMO_PASSWORD &&
      config.KOVA_DEMO_SECRET &&
      feePayerAccount,
  )

const DEMO_NAME = 'Sam Taylor'
const SHOP = { name: 'Sam’s Weaves', tagline: 'Handwoven in small batches' }
const OTHER_SHOP = { name: 'Corner Bakery', slug: 'corner-bakery-review' }
const FRIENDS = ['Ade Okafor', 'Lena Park', 'Diego Ruiz'] as const

const ITEMS = [
  {
    name: 'Mountain blanket',
    price: 48_000_000n,
    description: 'Handwoven wool, three weeks on the loom',
    photo: 'blanket.png',
  },
  {
    name: 'Wool scarf',
    price: 22_000_000n,
    description: 'Soft, warm, striped in saffron',
    photo: 'scarf.png',
  },
  {
    name: 'Table runner',
    price: 16_000_000n,
    description: 'Diamond weave, finished by hand',
    photo: 'runner.png',
  },
  {
    name: 'Woven pouch',
    price: 9_000_000n,
    description: 'For coins, keys, small treasures',
    photo: 'pouch.png',
  },
] as const
/** Sold at the till only, so the Stall tab's "Only at the till" has something in it. */
const TILL_ONLY = { name: 'Gift wrap', price: 2_000_000n, description: 'Brown paper and twine' }

const secret = (): Hex => {
  if (!config.KOVA_DEMO_SECRET) throw new KovaError('not_found', 'No demo account here.')
  return config.KOVA_DEMO_SECRET as Hex
}

/** A key of the demo's own, for a role: its customer, its card, a friend. Same secret, same keys. */
const derived = (role: string): PrivateKeyAccount =>
  privateKeyToAccount(
    keccak256(
      new Uint8Array([...hexToBytes(secret()), ...hexToBytes(stringToHex(`kova.demo.${role}`))]),
    ),
  )

/** The wallet the app opens from the secret: Mera's derivation, as for a passkey's PRF output. */
export async function demoWallet(): Promise<PrivateKeyAccount> {
  const seed = await mnemonicToSeed(entropyToMnemonic(hexToBytes(secret()), wordlist))
  const node = HDKey.fromMasterSeed(seed).derive("m/44'/60'/0'/0/0")
  if (!node.privateKey) throw new Error('demo key did not derive')
  return privateKeyToAccount(bytesToHex(node.privateKey))
}

const friends = () => FRIENDS.map((name, i) => ({ name, account: derived(`friend.${i}`) }))

// ── Sign-in ─────────────────────────────────────────────────────────────────────────────────

const equal = (a: string, b: string) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export function checkDemoLogin(username: string, password: string): boolean {
  if (!demoReady()) return false
  const userOk = equal(
    username.trim().toLowerCase(),
    (config.KOVA_DEMO_USERNAME ?? '').toLowerCase(),
  )
  const passOk = equal(password, config.KOVA_DEMO_PASSWORD ?? '')
  return userOk && passOk
}

export async function demoSignIn() {
  return {
    object: 'demo_account',
    secret: secret(),
    name: DEMO_NAME,
    currency: 'USD',
    contacts: friends().map((f) => ({ address: f.account.address, name: f.name })),
  }
}

// ── Stocking ────────────────────────────────────────────────────────────────────────────────

const balanceOf = (address: Address) =>
  publicClient.readContract({
    address: settlementToken.address,
    abi: eip3009Abi,
    functionName: 'balanceOf',
    args: [address],
  })

/** Tops a wallet up to `target` from Kova's treasury, or Agora's testnet faucet when that's low. */
async function topUp(address: Address, target: bigint): Promise<void> {
  const has = await balanceOf(address)
  if (has >= target) return
  const need = target - has
  const treasury = feePayerAccount ? await balanceOf(feePayerAccount.address) : 0n
  if (treasury >= need + 50_000_000n) {
    await sendFromRelayer(
      settlementToken.address,
      encodeFunctionData({ abi: eip3009Abi, functionName: 'transfer', args: [address, need] }),
    )
    return
  }
  await sendFromRelayer(
    AUSD_TESTNET_FAUCET,
    encodeFunctionData({ abi: faucetAbi, functionName: 'requestFunds', args: [address] }),
  )
}

/** Pays a charge from a wallet the way Kova Pay does: an EIP-3009 authorization Kova relays. */
async function payFrom(account: PrivateKeyAccount, intent: PaymentIntent): Promise<void> {
  const authorization = {
    from: account.address,
    to: intent.payTo as Address,
    value: intent.amount,
    validAfter: 0n,
    validBefore: BigInt(Math.floor(Date.now() / 1000) + 600),
    nonce: intent.memo as Hex,
  }
  const signature = await account.signTypedData(
    transferAuthorizationTypedData(settlementToken, network.chainId, authorization),
  )
  const { receipt } = await relayAuthorization(settlementToken, authorization, signature)
  await settleFromReceipt(receipt)
}

/** Sends money between people, as the Send sheet does. */
async function sendFrom(account: PrivateKeyAccount, to: Address, value: bigint): Promise<void> {
  const authorization = {
    from: account.address,
    to,
    value,
    validAfter: 0n,
    validBefore: BigInt(Math.floor(Date.now() / 1000) + 600),
    nonce: randomNonce(),
  }
  const signature = await account.signTypedData(
    transferAuthorizationTypedData(settlementToken, network.chainId, authorization),
  )
  await relayAuthorization(settlementToken, authorization, signature)
}

async function uniqueSlug(name: string) {
  const base = slugify(name) || 'shop'
  for (let i = 0; i < 20; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`
    if (!(await db.query.stalls.findFirst({ where: eq(schema.stalls.slug, slug) }))) return slug
  }
  return `${base}-${Date.now().toString(36)}`
}

/** The demo wallet's own shop, with a stall of photographed items. Opened once. */
async function demoShop(owner: Address) {
  const existing = await db.query.merchants.findFirst({
    where: and(
      eq(schema.merchants.ownerAddress, owner.toLowerCase()),
      eq(schema.merchants.status, 'active'),
    ),
    orderBy: desc(schema.merchants.createdAt),
  })
  if (existing) {
    const stall = await db.query.stalls.findFirst({
      where: and(eq(schema.stalls.merchantId, existing.id), isNull(schema.stalls.archivedAt)),
    })
    if (stall) return { merchant: existing, stall }
  }
  const merchantId = existing?.id ?? uuidv7()
  if (!existing)
    await db.insert(schema.merchants).values({
      id: merchantId,
      name: SHOP.name,
      slug: `sams-weaves-${merchantId.slice(-6)}`,
      settlementAddress: owner.toLowerCase(),
      ownerAddress: owner.toLowerCase(),
      network: 'testnet',
      isTest: true,
    })
  const merchant = (await db.query.merchants.findFirst({
    where: eq(schema.merchants.id, merchantId),
  }))!

  const stallId = uuidv7()
  await db.insert(schema.stalls).values({
    id: stallId,
    merchantId,
    slug: await uniqueSlug(SHOP.name),
    name: SHOP.name,
    tagline: SHOP.tagline,
  })
  let position = 0
  for (const item of ITEMS) {
    const bytes = await readFile(new URL(`../../assets/demo/${item.photo}`, import.meta.url))
    const imageId = uuidv7()
    await db
      .insert(schema.images)
      .values({ id: imageId, merchantId, contentType: 'image/png', bytes, size: bytes.length })
    const itemId = uuidv7()
    await db.insert(schema.catalogItems).values({
      id: itemId,
      merchantId,
      name: item.name,
      description: item.description,
      price: item.price,
      imageId,
      position,
    })
    await db.insert(schema.stallItems).values({ stallId, itemId, position: position++ })
  }
  await db
    .insert(schema.catalogItems)
    .values({ id: uuidv7(), merchantId, ...TILL_ONLY, position: position++ })
  const stall = (await db.query.stalls.findFirst({ where: eq(schema.stalls.id, stallId) }))!
  console.log(`[demo] opened ${SHOP.name} for ${owner}`)
  return { merchant, stall }
}

/** Another shop the demo wallet has bought from, so its history has someone else in it. */
async function otherShop() {
  const existing = await db.query.merchants.findFirst({
    where: eq(schema.merchants.slug, OTHER_SHOP.slug),
  })
  if (existing) return existing
  const id = uuidv7()
  await db.insert(schema.merchants).values({
    id,
    name: OTHER_SHOP.name,
    slug: OTHER_SHOP.slug,
    settlementAddress: derived('bakery').address.toLowerCase(),
    network: 'testnet',
    isTest: true,
  })
  return (await db.query.merchants.findFirst({ where: eq(schema.merchants.id, id) }))!
}

/** Links the demo's Kova Card (a software card: the same key a chip would hold) and taps it twice. */
async function demoCard(holder: PrivateKeyAccount, bakery: typeof schema.merchants.$inferSelect) {
  if (!cardsReady() || !cardContract) return
  const card = derived('card')
  const row = await db.query.kovaCards.findFirst({
    where: eq(schema.kovaCards.address, card.address.toLowerCase()),
  })
  if (!row || row.status !== 'active') {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300)
    const [nonce, permitNonce] = await Promise.all([
      publicClient.readContract({
        address: cardContract,
        abi: kovaCardAbi,
        functionName: 'nonces',
        args: [holder.address],
      }),
      publicClient.readContract({
        address: settlementToken.address,
        abi: permitAbi,
        functionName: 'nonces',
        args: [holder.address],
      }),
    ])
    const holderSignature = await holder.signTypedData(
      linkTypedData(network.chainId, cardContract, {
        holder: holder.address,
        card: card.address,
        dailyLimit: 100_000_000n,
        nonce,
        deadline,
      }),
    )
    const cardSignature = await card.signTypedData(
      claimTypedData(network.chainId, cardContract, {
        card: card.address,
        holder: holder.address,
        deadline,
      }),
    )
    const permit = await holder.signTypedData(
      permitTypedData(settlementToken, network.chainId, {
        owner: holder.address,
        spender: cardContract,
        value: maxUint256,
        nonce: permitNonce,
        deadline,
      }),
    )
    await linkCard({
      holder: holder.address,
      card: card.address,
      dailyLimit: 100_000_000n,
      deadline,
      holderSignature,
      cardSignature,
      permit: { value: maxUint256, deadline, signature: permit },
      pin: '2580',
    })
    console.log(`[demo] linked card ${card.address}`)
  }
  const taps = await db.query.cardTaps.findMany({
    where: and(
      eq(schema.cardTaps.cardAddress, card.address.toLowerCase()),
      eq(schema.cardTaps.status, 'paid'),
    ),
    limit: 2,
  })
  for (const sale of [
    { amount: '3.25', reference: 'Croissant' },
    { amount: '3.75', reference: 'Cinnamon bun' },
  ].slice(taps.length)) {
    const intent = await createIntent({
      merchant: bakery,
      amount: sale.amount,
      currency: settlementCurrency,
      reference: sale.reference,
    })
    const { tap } = await prepareTap({ intent, card: card.address, terminalId: null })
    const signature = await card.signTypedData(tapTypedData(cardContract, tap))
    await completeTap(tap, { cardSignature: signature })
  }
}

let stocking: Promise<void> | null = null

/** Everything the demo account should have. Safe to run again: it only adds what's missing. */
export function stockDemo(): Promise<void> {
  if (!demoReady()) return Promise.resolve()
  stocking ??= (async () => {
    try {
      const wallet = await demoWallet()
      const customer = derived('customer')
      await topUp(wallet.address, 300_000_000n)
      await topUp(customer.address, 200_000_000n)

      const { merchant, stall } = await demoShop(wallet.address)
      const bakery = await otherShop()

      // Friends who have paid Sam, so Home has people in "Send again" and Activity has money in.
      for (const [i, friend] of friends().entries()) {
        const sent = await db.query.transfers.findFirst({
          where: and(
            eq(schema.transfers.fromAddress, friend.account.address.toLowerCase()),
            eq(schema.transfers.toAddress, wallet.address.toLowerCase()),
          ),
        })
        if (sent) continue
        await topUp(friend.account.address, 30_000_000n)
        await sendFrom(friend.account, wallet.address, BigInt([12, 8, 20][i] ?? 10) * 1_000_000n)
      }

      // Things Sam bought at the bakery, by QR.
      const bought = await db.query.payments.findFirst({
        where: eq(schema.payments.payerAddress, wallet.address.toLowerCase()),
      })
      if (!bought)
        for (const sale of [
          { amount: '3.20', reference: 'Flat white' },
          { amount: '6.50', reference: 'Sourdough loaf' },
        ]) {
          const intent = await createIntent({
            merchant: bakery,
            amount: sale.amount,
            currency: settlementCurrency,
            reference: sale.reference,
          })
          await payFrom(wallet, intent)
        }

      await demoCard(wallet, bakery)
      await keepShopBusy(merchant, stall, customer)
    } catch (error) {
      console.error('[demo] stocking failed', error instanceof Error ? error.message : error)
    } finally {
      stocking = null
    }
  })()
  return stocking
}

/**
 * Today's sales and an order to hand over, so the till never opens on an empty day. A sale an
 * hour or two ago is enough: the reviewer's Today counts from their own midnight.
 */
async function keepShopBusy(
  merchant: typeof schema.merchants.$inferSelect,
  stall: typeof schema.stalls.$inferSelect,
  customer: PrivateKeyAccount,
) {
  const items = await db.query.catalogItems.findMany({
    where: and(
      eq(schema.catalogItems.merchantId, merchant.id),
      isNull(schema.catalogItems.archivedAt),
    ),
  })
  const onStall = await db.query.stallItems.findMany({
    where: eq(schema.stallItems.stallId, stall.id),
  })
  const stallItems = items.filter((i) => onStall.some((s) => s.itemId === i.id))
  if (stallItems.length === 0) return
  const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)] as T

  const recentSale = await db.query.paymentIntents.findFirst({
    where: and(
      eq(schema.paymentIntents.merchantId, merchant.id),
      eq(schema.paymentIntents.status, 'paid'),
      gt(schema.paymentIntents.createdAt, new Date(Date.now() - 3 * 3_600_000)),
    ),
  })
  if (!recentSale) {
    const item = pick(stallItems)
    const { intent } = await placeOrder({
      merchant,
      source: 'till',
      items: [{ id: encodeId('catalogItem', item.id), quantity: 1 }],
    })
    await payFrom(customer, intent)
  }

  // One paid stall order waiting to be handed over.
  const waiting = await db.query.orders.findFirst({
    where: and(
      eq(schema.orders.merchantId, merchant.id),
      eq(schema.orders.source, 'stall'),
      isNull(schema.orders.collectedAt),
      gt(schema.orders.createdAt, new Date(Date.now() - 12 * 3_600_000)),
    ),
  })
  if (!waiting) {
    const item = pick(stallItems)
    const { intent } = await placeOrder({
      merchant,
      source: 'stall',
      stall,
      items: [{ id: encodeId('catalogItem', item.id), quantity: 1 }],
      customerName: pick(['Priya', 'Tomás', 'Grace', 'Kwame']),
      note: pick([
        'It’s a gift, could you wrap it?',
        'I’ll pick it up at five.',
        'No rush, thank you!',
      ]),
    })
    await payFrom(customer, intent)
  }
  // Keep the customer and the demo wallet able to pay.
  await topUp(customer.address, 100_000_000n)
  const wallet = await demoWallet()
  await topUp(wallet.address, 150_000_000n)
  console.log(
    `[demo] ${SHOP.name} is stocked; Sam has $${formatAmount(await balanceOf(wallet.address))}`,
  )
}

/** Stocks the demo account at startup and every 20 minutes. */
export function startDemo(): void {
  if (!demoReady()) return
  void stockDemo()
  setInterval(() => void stockDemo(), 20 * 60_000)
}
