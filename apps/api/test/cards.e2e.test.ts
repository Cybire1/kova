import { serve } from '@hono/node-server'
import { schema, uuidv7 } from '@kova/db'
import {
  claimTypedData,
  kovaCardAddress,
  linkTypedData,
  permitAbi,
  permitTypedData,
  unlinkTypedData,
  updateTypedData,
} from '@kova/monad'
import { eq } from 'drizzle-orm'
import { encodeFunctionData, erc20Abi, type Hex, maxUint256 } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { generateApiKey } from '../src/auth.js'
import { feePayerAddress, network, publicClient, settlementToken } from '../src/chain.js'
import { config } from '../src/config.js'
import { db } from '../src/db.js'
import { app } from '../src/index.js'
import { sendFromRelayer } from '../src/relay.js'

/**
 * The Kova Card on Monad testnet, end to end through the real API, relayer and KovaCard contract.
 *
 * The card here is a software key that signs exactly as an Arx HaLo chip does (EIP-712 typed data
 * over secp256k1), so the same calls run when a real chip is tapped on the till. It covers:
 * linking with the wallet's and the card's signatures and a permit; a tap that pays a charge from
 * the wallet with no MON; the PIN over the no-PIN limit, and its lockout; the daily limit; an
 * instant freeze; and unlinking.
 *
 * Requires: Postgres with migrations applied, a relayer with testnet MON and AUSD, and
 * KOVA_CARD_COSIGNER_KEY (the contract's cosigner). Without them, it skips.
 */

const contract = kovaCardAddress(config.KOVA_NETWORK)
const ready = Boolean(feePayerAddress && contract && config.KOVA_CARD_COSIGNER_KEY)

const holder = privateKeyToAccount(generatePrivateKey())
/** The chip's key. On a real card it never leaves the chip; the till asks the chip to sign. */
const card = privateKeyToAccount(generatePrivateKey())
const shop = privateKeyToAccount(generatePrivateKey()).address
const PIN = '4827'

let server: ReturnType<typeof serve>
let baseUrl: string
let apiKey: string

const now = () => Math.floor(Date.now() / 1000)

async function call(path: string, init: RequestInit = {}, auth = false) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: `Bearer ${apiKey}` } : {}),
      ...init.headers,
    },
  })
  return { status: response.status, body: (await response.json()) as Record<string, any> }
}

const post = (path: string, body: unknown, auth = false) =>
  call(path, { method: 'POST', body: JSON.stringify(body) }, auth)

async function nonce(): Promise<bigint> {
  const { body } = await call(`/v1/wallets/${holder.address}/cards`)
  return BigInt(body.nonce)
}

async function balance(address: `0x${string}`) {
  return publicClient.readContract({
    address: settlementToken.address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address],
  })
}

async function newCharge(amount: string): Promise<string> {
  const { status, body } = await post(
    '/v1/payment_intents',
    { amount, reference: `card_${amount}` },
    true,
  )
  expect(status).toBe(201)
  return body.id as string
}

/** The till's side of a tap: read the card, have it sign what Kova prepared, finish. */
async function tap(intent: string, pin?: string) {
  const prepared = await post('/v1/card_taps', { payment_intent: intent, card: card.address }, true)
  if (prepared.status !== 201) return { prepared, done: null }
  const td = prepared.body.typed_data
  const cardSignature = await card.signTypedData({
    domain: td.domain,
    types: td.types,
    primaryType: td.primaryType,
    message: {
      ...td.message,
      amount: BigInt(td.message.amount),
      deadline: BigInt(td.message.deadline),
    },
  })
  const done = await post(
    `/v1/card_taps/${prepared.body.id}/complete`,
    { card_signature: cardSignature, pin },
    true,
  )
  return { prepared, done }
}

beforeAll(async () => {
  if (!ready) return
  const merchantId = uuidv7()
  await db.insert(schema.merchants).values({
    id: merchantId,
    name: 'Corner Bakery',
    slug: `card-${merchantId}`,
    settlementAddress: shop,
    network: 'testnet',
    isTest: true,
  })
  const generated = generateApiKey(true)
  apiKey = generated.secret
  await db.insert(schema.apiKeys).values({
    id: uuidv7(),
    merchantId,
    name: 'till',
    prefix: generated.prefix,
    secretHash: generated.secretHash,
    scopes: ['payments:read', 'payments:write'],
    isTest: true,
  })
  server = serve({ fetch: app.fetch, port: 0 })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('server did not bind')
  baseUrl = `http://127.0.0.1:${address.port}`

  // $12 into the holder's wallet from Kova's testnet treasury. The holder never holds MON.
  await sendFromRelayer(
    settlementToken.address,
    encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: [holder.address, 12_000_000n],
    }),
  )
}, 120_000)

afterAll(() => {
  server?.close()
})

describe.skipIf(!ready)('Kova Card on Monad', () => {
  it('links a card with the wallet’s and the card’s signatures, and a permit', async () => {
    if (!contract) throw new Error('no contract')
    const deadline = BigInt(now() + 300)
    const holderSignature = await holder.signTypedData(
      linkTypedData(network.chainId, contract, {
        holder: holder.address,
        card: card.address,
        dailyLimit: 10_000_000n,
        nonce: await nonce(),
        deadline,
      }),
    )
    const cardSignature = await card.signTypedData(
      claimTypedData(network.chainId, contract, {
        card: card.address,
        holder: holder.address,
        deadline,
      }),
    )
    const permitNonce = await publicClient.readContract({
      address: settlementToken.address,
      abi: permitAbi,
      functionName: 'nonces',
      args: [holder.address],
    })
    const permitSignature = await holder.signTypedData(
      permitTypedData(settlementToken, network.chainId, {
        owner: holder.address,
        spender: contract,
        value: maxUint256,
        nonce: permitNonce,
        deadline,
      }),
    )

    const linked = await post('/v1/cards/link', {
      holder: holder.address,
      card: card.address,
      daily_limit: '10',
      deadline: Number(deadline),
      holder_signature: holderSignature,
      card_signature: cardSignature,
      permit: {
        value: maxUint256.toString(),
        deadline: Number(deadline),
        signature: permitSignature,
      },
      pin: PIN,
    })
    expect(linked.status, JSON.stringify(linked.body)).toBe(201)
    expect(linked.body.daily_limit).toBe('10.00')
    expect(linked.body.left_today).toBe('10.00')
    expect(linked.body.last_four).toMatch(/^\d{4}$/)

    const status = await call(`/v1/cards/${card.address}`)
    expect(status.body.linked).toBe(true)
  }, 120_000)

  it('pays a charge with a tap: wallet to shop, no MON, settled with its memo', async () => {
    const intent = await newCharge('2.40')
    const before = await balance(holder.address)
    const started = performance.now()
    const { prepared, done } = await tap(intent)
    expect(prepared.body.pin_required).toBe(false)
    expect(done?.status, JSON.stringify(done?.body)).toBe(200)
    console.log(
      `card tap paid in ${Math.round(performance.now() - started)}ms · ${done?.body.payment.explorer_url}`,
    )

    expect(await balance(holder.address)).toBe(before - 2_400_000n)
    expect(await balance(shop)).toBe(2_400_000n)
    const charge = await call(`/v1/payment_intents/${intent}`, {}, true)
    expect(charge.body.status).toBe('paid')
    expect(charge.body.payment.payer.toLowerCase()).toBe(holder.address.toLowerCase())

    // The same signed tap can't pay twice.
    const again = await post(
      `/v1/card_taps/${prepared.body.id}/complete`,
      { card_signature: '0x00' },
      true,
    )
    expect(again.status).toBe(409)
  }, 120_000)

  it('asks for the PIN over the no-PIN limit, and pauses the card after three wrong ones', async () => {
    // Lower this card's no-PIN limit to $1 so a test-sized charge needs the PIN.
    await db
      .update(schema.kovaCards)
      .set({ noPinLimit: 1_000_000n })
      .where(eq(schema.kovaCards.address, card.address.toLowerCase()))

    const intent = await newCharge('1.50')
    const noPin = await tap(intent)
    expect(noPin.prepared.body.pin_required).toBe(true)
    expect(noPin.done?.status).toBe(400)
    expect(noPin.done?.body.error.details.pin_required).toBe(true)

    const right = await tap(intent, PIN)
    expect(right.done?.status, JSON.stringify(right.done?.body)).toBe(200)

    const next = await newCharge('1.25')
    for (const tries of [2, 1]) {
      const wrong = await tap(next, '1357')
      expect(wrong.done?.status).toBe(400)
      expect(wrong.done?.body.error.details.tries_left).toBe(tries)
    }
    const third = await tap(next, '1357')
    expect(third.done?.status).toBe(422)
    // Paused: even the right PIN waits.
    const paused = await tap(next, PIN)
    expect(paused.prepared.status).toBe(422)

    await db
      .update(schema.kovaCards)
      .set({ lockedUntil: null, failedPins: 0, noPinLimit: 25_000_000n })
      .where(eq(schema.kovaCards.address, card.address.toLowerCase()))
  }, 180_000)

  it('holds the daily limit the holder set on-chain', async () => {
    // $10 a day, $3.90 spent: a $6.50 charge is over.
    const intent = await newCharge('6.50')
    const { prepared } = await tap(intent)
    expect(prepared.status).toBe(422)
    expect(prepared.body.error.message).toMatch(/daily limit/)
  }, 60_000)

  it('freezes at once and unfreezes, by the holder’s signature', async () => {
    if (!contract) throw new Error('no contract')
    const change = async (frozen: boolean) => {
      const deadline = BigInt(now() + 300)
      const signature = await holder.signTypedData(
        updateTypedData(network.chainId, contract, {
          holder: holder.address,
          card: card.address,
          dailyLimit: 10_000_000n,
          frozen,
          nonce: await nonce(),
          deadline,
        }),
      )
      return post(`/v1/cards/${card.address}/update`, {
        daily_limit: '10',
        frozen,
        deadline: Number(deadline),
        holder_signature: signature,
      })
    }
    const frozen = await change(true)
    expect(frozen.status, JSON.stringify(frozen.body)).toBe(200)
    expect(frozen.body.frozen).toBe(true)
    const intent = await newCharge('1.00')
    expect((await tap(intent)).prepared.status).toBe(422)

    const thawed = await change(false)
    expect(thawed.body.frozen).toBe(false)
    expect((await tap(intent)).done?.status).toBe(200)
  }, 180_000)

  it('unlinks for good: the card is just a piece of plastic again', async () => {
    if (!contract) throw new Error('no contract')
    const deadline = BigInt(now() + 300)
    const signature = await holder.signTypedData(
      unlinkTypedData(network.chainId, contract, {
        holder: holder.address,
        card: card.address,
        nonce: await nonce(),
        deadline,
      }),
    )
    const gone = await post(`/v1/cards/${card.address}/unlink`, {
      deadline: Number(deadline),
      holder_signature: signature as Hex,
    })
    expect(gone.status, JSON.stringify(gone.body)).toBe(200)
    expect((await call(`/v1/cards/${card.address}`)).body.linked).toBe(false)
    const intent = await newCharge('1.00')
    expect((await tap(intent)).prepared.status).toBe(404)
  }, 120_000)
})
