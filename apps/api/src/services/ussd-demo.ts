import { schema, uuidv7 } from '@kova/db'
import { formatAmount, normalizePhone } from '@kova/monad'
import { and, desc, eq, like, lt } from 'drizzle-orm'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { network } from '../chain.js'
import { config } from '../config.js'
import { db } from '../db.js'
import { KovaError } from '../errors.js'
import { hashSecret, sealKey } from '../secrets.js'
import { giveTestDollars } from './faucet.js'
import { createIntent } from './intents.js'
import { pocketBalance, pocketsReady, tillCodeFor } from './pockets.js'
import { DEMO_PHONE_PREFIX, demoMessages, forgetDemoPhone } from './sms.js'
import { ussdReply } from './ussd.js'

/**
 * "Try Kova on a basic phone" (mykova.app/ussd): a page draws a feature phone and drives Kova's
 * real USSD menu (services/ussd.ts) with it. Only the phone network is replaced by the page.
 *
 * Each visit gets a demo number (+999, a country code no network uses, so it can never be anyone's
 * phone), a real pocket on Monad testnet holding $5 of test dollars with a PIN shown on the page,
 * and a real charge at a test shop's till with its 6-digit code. Dialling pays it through the same
 * pocket spend and relayer as any phone; the till flips to paid when Monad confirms it. Texts to a
 * demo number are kept for the page (services/sms.ts), never sent. A demo pocket has no owner
 * anyone holds, closes after an hour, and only ever holds test dollars.
 *
 * Testnet only, and only with KOVA_USSD_DEMO=1.
 */

export const DEMO_PIN = '1357'
const DEMO_CAP = 20_000_000n // $20 a day
const DEMO_FOR_MS = 60 * 60_000
const DEMO_ITEM = { name: 'Croissant', price: '3.25' }

export const ussdDemoReady = () =>
  config.KOVA_NETWORK === 'testnet' && config.KOVA_USSD_DEMO === '1' && pocketsReady()

function needDemo() {
  if (!ussdDemoReady())
    throw new KovaError('not_found', 'The basic-phone demo isn’t switched on right now.')
}

const isDemoPhone = (phone: string | null): phone is string =>
  Boolean(phone?.startsWith(DEMO_PHONE_PREFIX))

async function demoShop() {
  const stall = await db.query.stalls.findFirst({
    where: eq(schema.stalls.slug, config.KOVA_USSD_DEMO_SHOP),
  })
  const merchant = stall
    ? await db.query.merchants.findFirst({ where: eq(schema.merchants.id, stall.merchantId) })
    : undefined
  if (!merchant) throw new KovaError('not_found', 'The demo shop isn’t set up on this server.')
  return merchant
}

/** A fresh charge at the demo shop's till, with the 6-digit code a phone pays it by. */
export async function newDemoTill() {
  needDemo()
  const merchant = await demoShop()
  const intent = await createIntent({
    merchant,
    amount: DEMO_ITEM.price,
    currency: 'AUSD',
    reference: DEMO_ITEM.name,
    metadata: { demo: 'ussd' },
    expiresInSeconds: 30 * 60,
  })
  const code = await tillCodeFor(intent)
  if (!code) throw new KovaError('internal', 'The till couldn’t make a code. Try again.')
  return { id: intent.id, code, shop: merchant.name, item: DEMO_ITEM.name, amount: DEMO_ITEM.price }
}

/** A demo number with a funded pocket, its PIN, and a till to pay. */
export async function startDemo() {
  needDemo()
  const phone = `${DEMO_PHONE_PREFIX}${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`
  const id = uuidv7()
  const key = generatePrivateKey()
  const pocket = privateKeyToAccount(key).address
  // Nobody keeps this key: a demo pocket has no owner who could take its test dollars back.
  const owner = privateKeyToAccount(generatePrivateKey()).address
  await db.insert(schema.ussdPockets).values({
    id,
    ownerAddress: owner.toLowerCase(),
    phone,
    pocketAddress: pocket.toLowerCase(),
    sealedKey: sealKey(key, id),
    pinHash: await hashSecret(DEMO_PIN),
    cap: DEMO_CAP,
    status: 'active',
    lastSignedAt: Math.floor(Date.now() / 1000),
  })
  const drip = await giveTestDollars(pocket)
  // Kova texts the arrival itself, as for any pocket (services/pockets.ts), so the page shows that.
  return {
    object: 'ussd_demo' as const,
    network: network.id,
    phone,
    pin: DEMO_PIN,
    dial: config.KOVA_USSD_CODE,
    pocket,
    funded_tx: drip.txHash,
    explorer: network.explorerUrl,
    expires_at: new Date(Date.now() + DEMO_FOR_MS).toISOString(),
    till: await newDemoTill(),
  }
}

/** One screen of the real menu: what's been typed this session, joined by "*", as a network sends it. */
export async function pressDemo(input: { session: string; phone: string; text: string }) {
  needDemo()
  const phone = normalizePhone(input.phone)
  if (!isDemoPhone(phone)) throw new KovaError('invalid_request', 'That isn’t a demo number.')
  const reply = await ussdReply({
    sessionId: `demo-${input.session}`,
    phoneNumber: phone,
    text: input.text,
  })
  return { reply }
}

/** What the page shows around the phone: new texts, the pocket's balance, and whether the till got paid. */
export async function demoState(phoneInput: string, tillId: string | undefined, since: number) {
  needDemo()
  const phone = normalizePhone(phoneInput)
  if (!isDemoPhone(phone)) throw new KovaError('invalid_request', 'That isn’t a demo number.')
  const pocket = await db.query.ussdPockets.findFirst({
    where: eq(schema.ussdPockets.phone, phone),
  })
  if (!pocket) throw new KovaError('not_found', 'This demo has ended. Start a new one.')
  let till: { status: string; tx_hash: string | null } | null = null
  if (tillId && /^[0-9a-f-]{36}$/.test(tillId)) {
    const intent = await db.query.paymentIntents.findFirst({
      where: eq(schema.paymentIntents.id, tillId),
    })
    if (intent?.metadata?.demo === 'ussd') {
      const paid = await db.query.payments.findFirst({
        where: eq(schema.payments.intentId, intent.id),
        orderBy: [desc(schema.payments.createdAt)],
      })
      till = { status: intent.status, tx_hash: paid?.txHash ?? null }
    }
  }
  return {
    messages: demoMessages(phone, since),
    balance: formatAmount(await pocketBalance(pocket)),
    active: pocket.status === 'active',
    till,
  }
}

/** Demo pockets close after an hour; their texts go too. */
export async function closeOldDemos() {
  if (config.KOVA_NETWORK !== 'testnet') return
  const closed = await db
    .update(schema.ussdPockets)
    .set({ status: 'closed', updatedAt: new Date() })
    .where(
      and(
        like(schema.ussdPockets.phone, `${DEMO_PHONE_PREFIX}%`),
        eq(schema.ussdPockets.status, 'active'),
        lt(schema.ussdPockets.createdAt, new Date(Date.now() - DEMO_FOR_MS)),
      ),
    )
    .returning({ phone: schema.ussdPockets.phone })
  for (const row of closed) forgetDemoPhone(row.phone)
}
