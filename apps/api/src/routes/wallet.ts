import { schema, uuidv7 } from '@kova/db'
import {
  AUSD_TESTNET_FAUCET,
  decodeMemo,
  eip3009Abi,
  explorerTxUrl,
  formatAmount,
  noteKeyMessage,
  OFFLINE_MAX,
  OFFLINE_VALIDITY,
  parseSealedNote,
  parseSignedAuthorization,
  parseStealthMetaAddress,
  SEALED_MEMO_MAX,
  stealthRegistrationMessage,
  tokenByAddress,
  vaultMessage,
} from '@kova/monad'
import { and, asc, eq, gt, inArray, lt, or } from 'drizzle-orm'
import { Hono } from 'hono'
import {
  type Address,
  getAddress,
  type Hex,
  isAddress,
  isAddressEqual,
  recoverMessageAddress,
} from 'viem'
import { z } from 'zod'
import { feePayerAddress, network, publicClient, settlementToken, walletClient } from '../chain.js'
import { config } from '../config.js'
import { db } from '../db.js'
import { KovaError, notFound } from '../errors.js'
import { clientIp as ip, limit } from '../limits.js'
import { relayAuthorization } from '../relay.js'
import {
  chainDepositActivity,
  chainDepositQuote,
  chainDepositSources,
} from '../services/chain-deposits.js'
import { depositAddress, depositsTo, isSource, SOURCES } from '../services/deposits.js'
import { giveTestDollars } from '../services/faucet.js'
import { cashOutFor, topUpFor } from '../services/ramp.js'
import { indexedThrough } from '../workers/watcher.js'

/**
 * Kova Pay's side of Monad. There is no account and no key: a wallet is its address, and it
 * proves itself by signing.
 *
 * - POST /transfers relays a transfer between people that the sender signed; Kova pays the gas.
 *   An offline payment (`offline: true`) was signed with no signal and travelled as a code: it may
 *   wait up to a week, carries $100 at most, and either phone may hand it in.
 * - GET /public/offline-payments/:from/:nonce says whether an offline payment has settled.
 * - GET /wallets/:address/transfers lists what moved in or out, from Kova's index of the chain.
 * - POST /faucet sends test dollars, five a day for each wallet, on testnet only.
 * - GET and PUT /wallets/:address/note-key publish the key a wallet's private notes are sealed to.
 * - GET /wallets/:address/deposit-sources, POST /wallets/:address/deposit-address and GET
 *   /wallets/:address/deposits bring dollars in from other chains (Aurora Intents, mainnet only).
 * - GET /wallets/:address/cash-out gives the off-ramp settings for the web's cash-out page.
 * - GET /wallets/:address/top-up gives a card or bank top-up link (Ramp Network, mainnet only).
 * - GET and PUT /vaults/:id keep a wallet's encrypted backup (name, currency, contacts). Kova
 *   stores ciphertext it can't read; only the vault's own key, from the same passkey, replaces it.
 */

/** An approval to send is used within seconds; one that lives longer is only a risk to its signer. */
const MAX_SEND_VALIDITY = 3_600n

/** What a private send carries for its recipient: ERC-5564 scheme 1's ephemeral key and view tag. */
const stealthBody = z.object({
  ephemeral_public_key: z.string().regex(/^0x0[23][0-9a-fA-F]{64}$/),
  view_tag: z.string().regex(/^0x[0-9a-fA-F]{2}$/),
  /** The sender's memo (who, their name, a note), sealed for the recipient alone: Kova stores it unread. */
  sealed: z
    .string()
    .regex(/^0x01[0-9a-fA-F]+$/)
    .max(2 + 2 * SEALED_MEMO_MAX)
    .refine((v) => v.length % 2 === 0 && v.length >= 2 + 2 * 41, 'Not a sealed memo')
    .optional(),
})

type TransferRow = typeof schema.transfers.$inferSelect

/** Who was paid, for transfers that paid a Kova charge: the shop's name and its reference. */
type Shops = Map<string, { name: string; reference: string | null }>

async function shopsPaid(rows: TransferRow[]): Promise<Shops> {
  const ids = [
    ...new Set(
      rows
        .map((r) => (r.nonce ? decodeMemo(r.nonce as Hex) : null))
        .filter((m) => m?.kind === 'payment')
        .map((m) => m?.id as string),
    ),
  ]
  if (ids.length === 0) return new Map()
  const intents = await db
    .select({
      id: schema.paymentIntents.id,
      reference: schema.paymentIntents.reference,
      name: schema.merchants.name,
    })
    .from(schema.paymentIntents)
    .innerJoin(schema.merchants, eq(schema.merchants.id, schema.paymentIntents.merchantId))
    .where(inArray(schema.paymentIntents.id, ids))
  return new Map(intents.map((i) => [i.id, { name: i.name, reference: i.reference }]))
}

type Notes = Map<
  string,
  { sealed: (typeof schema.paymentNotes.$inferSelect)['sealed']; auth_nonce: string }
>

async function notesFor(rows: TransferRow[]): Promise<Notes> {
  const hashes = [...new Set(rows.map((r) => r.txHash))]
  if (hashes.length === 0) return new Map()
  const found = await db
    .select()
    .from(schema.paymentNotes)
    .where(inArray(schema.paymentNotes.txHash, hashes))
  return new Map(found.map((n) => [n.txHash, { sealed: n.sealed, auth_nonce: n.authNonce }]))
}

/** Kova's treasury sends dollars for naira: a top-up landing, or a cash-out's dollars coming back. */
type NairaMoves = Map<string, 'top_up' | 'cash_out_refund'>

async function nairaMovesFor(rows: TransferRow[]): Promise<NairaMoves> {
  const hashes = [...new Set(rows.map((r) => r.txHash))]
  if (hashes.length === 0) return new Map()
  const [topUps, refunds] = await Promise.all([
    db
      .select({ txHash: schema.nairaTopUps.txHash })
      .from(schema.nairaTopUps)
      .where(inArray(schema.nairaTopUps.txHash, hashes)),
    db
      .select({ txHash: schema.cashOuts.refundTxHash })
      .from(schema.cashOuts)
      .where(inArray(schema.cashOuts.refundTxHash, hashes)),
  ])
  const moves: NairaMoves = new Map()
  for (const t of topUps) if (t.txHash) moves.set(t.txHash, 'top_up')
  for (const r of refunds) if (r.txHash) moves.set(r.txHash, 'cash_out_refund')
  return moves
}

function serializeTransfer(
  row: TransferRow,
  shops: Shops = new Map(),
  notes: Notes = new Map(),
  naira: NairaMoves = new Map(),
) {
  const memo = row.nonce ? decodeMemo(row.nonce as Hex) : null
  const token = tokenByAddress(config.KOVA_NETWORK, row.tokenAddress as Address)
  return {
    object: 'transfer',
    id: `${row.txHash}:${row.logIndex}`,
    currency: token?.currency ?? null,
    token: getAddress(row.tokenAddress),
    from: getAddress(row.fromAddress),
    to: getAddress(row.toAddress),
    amount: formatAmount(row.amount),
    amount_base: row.amount.toString(),
    tx_hash: row.txHash,
    block: row.blockNumber.toString(),
    /** What the money was, when a Kova memo says: a payment, a refund, a payout. */
    kind: memo?.kind ?? null,
    /** The shop a payment went to, when it paid a Kova charge. */
    shop: memo?.kind === 'payment' ? (shops.get(memo.id) ?? null) : null,
    /** When Kova saw it land: within seconds of the block, as the watcher follows Monad. */
    created_at: row.createdAt.toISOString(),
    /** Test dollars (Agora's faucet, or Kova's testnet treasury topping up) rather than from a person. */
    faucet:
      config.KOVA_NETWORK === 'testnet' &&
      !row.nonce &&
      !naira.has(row.txHash) &&
      (row.fromAddress === AUSD_TESTNET_FAUCET.toLowerCase() ||
        row.fromAddress === feePayerAddress?.toLowerCase()),
    /** Dollars from Kova's treasury for naira: a top-up landing, or a cash-out's dollars coming back. */
    naira: naira.get(row.txHash) ?? null,
    explorer_url: explorerTxUrl(network, row.txHash as Hex),
    /** The sender's private note, sealed for the two of them: Kova can't read it. */
    note: notes.get(row.txHash) ?? null,
  }
}

const faucetBody = z.object({
  address: z.string().refine((v) => isAddress(v), 'That isn’t a wallet address'),
})

const noteKeyBody = z.object({
  public_key: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
})

function walletAddress(c: { req: { param: (name: string) => string } }): Address {
  const address = c.req.param('address')
  if (!isAddress(address)) throw new KovaError('invalid_request', 'That isn’t a wallet address.')
  return getAddress(address)
}

const vaultBody = z.object({
  ciphertext: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .max(96_000),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
  signed_at: z.number().int().positive(),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
})

function vaultId(c: { req: { param: (name: string) => string } }): Address {
  const id = c.req.param('id')
  if (!isAddress(id)) throw new KovaError('invalid_request', 'Not a vault id.')
  return getAddress(id)
}

export const walletRoutes = new Hono()
  .post('/transfers', async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
    const signed = parseSignedAuthorization(body)
    if (!signed) throw new KovaError('invalid_request', 'Expected a signed transfer authorization.')
    const note = body?.note === undefined || body.note === null ? null : parseSealedNote(body.note)
    if (body?.note && !note)
      throw new KovaError('invalid_request', 'That note isn’t sealed the way Kova expects.')
    // A private send: the dollars go to a one-time address made for the recipient, and this is
    // what they need to find it. Kova publishes it with no recipient (GET /public/stealth/announcements).
    const stealth =
      body?.stealth === undefined || body.stealth === null
        ? null
        : stealthBody.safeParse(body.stealth)
    if (stealth && !stealth.success)
      throw new KovaError(
        'invalid_request',
        'A private send needs { ephemeral_public_key, view_tag } and, if any, a sealed memo.',
      )
    const { authorization, signature } = signed
    const token = tokenByAddress(config.KOVA_NETWORK, signed.token)
    if (!token) throw new KovaError('invalid_request', 'Kova only sends the dollars it settles in.')
    // Charges have their own door, which checks the charge. A Kova memo here is refused, so
    // nothing can pay a charge without that check.
    if (decodeMemo(authorization.nonce))
      throw new KovaError('invalid_request', 'Pay a charge through its checkout.')
    const now = BigInt(Math.floor(Date.now() / 1000))
    // Signed with no signal and carried as a code, an offline payment waits for whichever phone
    // gets online first, so it may live a week; anything else is used within seconds.
    const offline = body?.offline === true
    if (offline) {
      if (authorization.validAfter !== 0n)
        throw new KovaError(
          'invalid_request',
          'An offline payment is valid from the moment it’s signed.',
        )
      if (authorization.value > OFFLINE_MAX)
        throw new KovaError('policy_declined', 'An offline payment carries $100 at most.')
      if (authorization.validBefore > now + OFFLINE_VALIDITY + 600n)
        throw new KovaError('invalid_request', 'An offline payment can wait a week at most.')
    } else if (authorization.validBefore > now + MAX_SEND_VALIDITY)
      throw new KovaError('invalid_request', 'An approval to send can last an hour at most.')

    // Offline payments arrive in bursts, all at once when a phone gets signal back.
    limit(
      `${offline ? 'send-offline' : 'send'}:${authorization.from.toLowerCase()}`,
      offline ? 60 : 20,
      600_000,
      'That’s a lot of sends in a few minutes. Try again shortly.',
    )
    limit(`send-ip:${ip(c)}`, 60, 600_000, 'That’s a lot of sends from here. Try again shortly.')

    const { receipt, ms } = await relayAuthorization(token, authorization, signature)
    if (note) {
      // The money has moved whatever happens here; a note that fails to save is only a note.
      await db
        .insert(schema.paymentNotes)
        .values({
          txHash: receipt.transactionHash,
          fromAddress: authorization.from.toLowerCase(),
          toAddress: authorization.to.toLowerCase(),
          authNonce: authorization.nonce,
          sealed: note,
        })
        .onConflictDoNothing()
        .catch((error) =>
          console.error('[notes] not saved', error instanceof Error ? error.message : error),
        )
    }
    if (stealth?.success)
      await db
        .insert(schema.stealthAnnouncements)
        .values({
          id: uuidv7(),
          network: config.KOVA_NETWORK,
          stealthAddress: authorization.to.toLowerCase(),
          ephemeralPublicKey: stealth.data.ephemeral_public_key.toLowerCase(),
          viewTag: stealth.data.view_tag.toLowerCase(),
          fromAddress: authorization.from.toLowerCase(),
          amount: authorization.value,
          tokenAddress: token.address.toLowerCase(),
          txHash: receipt.transactionHash,
          sealed: stealth.data.sealed?.toLowerCase() ?? null,
        })
        .onConflictDoNothing()
        .catch((error) =>
          console.error('[stealth] not announced', error instanceof Error ? error.message : error),
        )
    return c.json({
      object: 'transfer',
      tx_hash: receipt.transactionHash,
      block: receipt.blockNumber.toString(),
      explorer_url: explorerTxUrl(network, receipt.transactionHash),
      ms: Math.round(ms),
    })
  })
  /** Public: whether an offline payment has settled, and its transaction once Kova has seen it. */
  .get('/public/offline-payments/:from/:nonce', async (c) => {
    const from = c.req.param('from')
    const nonce = c.req.param('nonce').toLowerCase()
    if (!isAddress(from) || !/^0x[0-9a-f]{64}$/.test(nonce))
      throw new KovaError('invalid_request', 'Expected a sender address and a 32-byte nonce.')
    const tokenParam = c.req.query('token')
    const token =
      tokenParam && isAddress(tokenParam)
        ? tokenByAddress(config.KOVA_NETWORK, getAddress(tokenParam))
        : settlementToken
    if (!token) throw new KovaError('invalid_request', 'Kova doesn’t know that dollar.')
    const row = await db.query.transfers.findFirst({
      where: and(
        eq(schema.transfers.network, config.KOVA_NETWORK),
        eq(schema.transfers.fromAddress, from.toLowerCase()),
        eq(schema.transfers.nonce, nonce),
      ),
    })
    if (row)
      return c.json({
        object: 'offline_payment',
        status: 'settled',
        tx_hash: row.txHash,
        explorer_url: explorerTxUrl(network, row.txHash as Hex),
        settled_at: row.createdAt.toISOString(),
      })
    // Not in Kova's index yet: the token itself knows whether the authorization was used.
    const used = await publicClient
      .readContract({
        address: token.address,
        abi: eip3009Abi,
        functionName: 'authorizationState',
        args: [getAddress(from), nonce as Hex],
      })
      .catch(() => null)
    return c.json({
      object: 'offline_payment',
      status: used ? 'settled' : 'waiting',
      tx_hash: null,
      explorer_url: null,
      settled_at: null,
    })
  })
  .get('/wallets/:address/transfers', async (c) => {
    const address = c.req.param('address')
    if (!isAddress(address)) throw new KovaError('invalid_request', 'That isn’t a wallet address.')
    const afterText = c.req.query('after_block') ?? '0'
    if (!/^\d{1,20}$/.test(afterText))
      throw new KovaError('invalid_request', 'after_block must be a block number.')
    const direction = c.req.query('direction') ?? 'in'
    if (direction !== 'in' && direction !== 'out' && direction !== 'all')
      throw new KovaError('invalid_request', 'direction is in, out or all.')

    const who = address.toLowerCase()
    const side =
      direction === 'in'
        ? eq(schema.transfers.toAddress, who)
        : direction === 'out'
          ? eq(schema.transfers.fromAddress, who)
          : or(eq(schema.transfers.toAddress, who), eq(schema.transfers.fromAddress, who))
    const page = 200
    const [rows, through] = await Promise.all([
      db.query.transfers.findMany({
        where: and(
          eq(schema.transfers.network, config.KOVA_NETWORK),
          gt(schema.transfers.blockNumber, BigInt(afterText)),
          side,
        ),
        orderBy: [asc(schema.transfers.blockNumber), asc(schema.transfers.logIndex)],
        limit: page,
      }),
      indexedThrough(),
    ])
    // A full page may end mid-block: resume from the block before the last one, and let the
    // wallet drop the few it has already seen.
    const last = rows.at(-1)
    const cursor =
      rows.length === page && last ? last.blockNumber - 1n : (through ?? BigInt(afterText))
    const [shops, notes, naira] = await Promise.all([
      shopsPaid(rows),
      notesFor(rows),
      nairaMovesFor(rows),
    ])
    return c.json({
      object: 'list',
      data: rows.map((row) => serializeTransfer(row, shops, notes, naira)),
      indexed_through: cursor.toString(),
      has_more: rows.length === page,
    })
  })
  /** A wallet's private-receiving meta-address, with the wallet's own signature over it. */
  .get('/wallets/:address/stealth', async (c) => {
    const address = walletAddress(c)
    const key = await db.query.walletStealthKeys.findFirst({
      where: eq(schema.walletStealthKeys.address, address.toLowerCase()),
    })
    if (!key) throw notFound('private receiving key', address)
    return c.json({
      object: 'stealth_key',
      address,
      meta_address: key.metaAddress,
      signature: key.signature,
    })
  })
  .put('/wallets/:address/stealth', async (c) => {
    const address = walletAddress(c)
    const parsed = z
      .object({
        meta_address: z.string().max(200),
        signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
      })
      .safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success)
      throw new KovaError('invalid_request', 'Expected { meta_address, signature }.')
    const { meta_address, signature } = parsed.data
    try {
      parseStealthMetaAddress(meta_address)
    } catch {
      throw new KovaError('invalid_request', 'That isn’t a stealth meta-address (st:eth:0x…).')
    }
    const signer = await recoverMessageAddress({
      message: stealthRegistrationMessage(address, meta_address),
      signature: signature as Hex,
    }).catch(() => null)
    if (!signer || !isAddressEqual(signer, address))
      throw new KovaError(
        'forbidden',
        'Only the wallet itself can publish its private receiving key.',
      )
    limit(
      `stealth-key:${address.toLowerCase()}`,
      20,
      3_600_000,
      'That’s a lot of new keys in an hour. Try again later.',
    )
    await db
      .insert(schema.walletStealthKeys)
      .values({ address: address.toLowerCase(), metaAddress: meta_address, signature })
      .onConflictDoUpdate({
        target: schema.walletStealthKeys.address,
        set: { metaAddress: meta_address, signature, updatedAt: new Date() },
      })
    return c.json({ object: 'stealth_key', address, meta_address })
  })
  .get('/wallets/:address/note-key', async (c) => {
    const address = walletAddress(c)
    const key = await db.query.noteKeys.findFirst({
      where: eq(schema.noteKeys.address, address.toLowerCase()),
    })
    if (!key) throw notFound('note key', address)
    return c.json({
      object: 'note_key',
      address,
      public_key: key.publicKey,
      signature: key.signature,
    })
  })
  .put('/wallets/:address/note-key', async (c) => {
    const address = walletAddress(c)
    const parsed = noteKeyBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success)
      throw new KovaError('invalid_request', 'Expected { public_key, signature }.')
    const { public_key, signature } = parsed.data
    const signer = await recoverMessageAddress({
      message: noteKeyMessage(address, public_key),
      signature: signature as Hex,
    }).catch(() => null)
    if (!signer || !isAddressEqual(signer, address))
      throw new KovaError('forbidden', 'Only the wallet itself can publish its note key.')
    limit(
      `note-key:${address.toLowerCase()}`,
      20,
      3_600_000,
      'That’s a lot of new keys in an hour. Try again later.',
    )
    await db
      .insert(schema.noteKeys)
      .values({ address: address.toLowerCase(), publicKey: public_key, signature })
      .onConflictDoUpdate({
        target: schema.noteKeys.address,
        set: { publicKey: public_key, signature, updatedAt: new Date() },
      })
    return c.json({ object: 'note_key', address, public_key })
  })
  .get('/wallets/:address/top-up', (c) => {
    const wallet = walletAddress(c)
    const currency = (c.req.query('currency') ?? 'USD').toUpperCase()
    const dollars = Number(c.req.query('amount') ?? '')
    const returnTo = c.req.query('return_to')
    // Only Kova's own pages and app may be where Ramp sends people back.
    const safeReturn =
      returnTo && /^(https:\/\/mykova\.app\/|kova:\/\/)/.test(returnTo) ? returnTo : undefined
    return c.json({
      object: 'top_up',
      ...topUpFor(wallet, currency, Number.isFinite(dollars) ? dollars : undefined, safeReturn),
    })
  })
  .get('/wallets/:address/cash-out', (c) => {
    const wallet = walletAddress(c)
    const currency = (c.req.query('currency') ?? 'USD').toUpperCase()
    return c.json({ object: 'cash_out', ...cashOutFor(wallet, currency) })
  })
  .get('/wallets/:address/chain-deposit-sources', async (c) => {
    walletAddress(c)
    limit(
      `chain-deposit-sources:${ip(c)}`,
      120,
      60_000,
      'Too many deposit requests. Try again shortly.',
    )
    return c.json({ object: 'chain_deposit_sources', ...(await chainDepositSources()) })
  })
  .post('/wallets/:address/chain-deposit-quote', async (c) => {
    const wallet = walletAddress(c)
    limit(
      `chain-deposit-quote:${ip(c)}`,
      60,
      3_600_000,
      'Too many deposit quotes. Try again shortly.',
    )
    return c.json({
      object: 'chain_deposit_quote',
      ...(await chainDepositQuote(wallet, await c.req.json().catch(() => null))),
    })
  })
  .get('/wallets/:address/chain-deposits', async (c) => {
    const wallet = walletAddress(c)
    limit(`chain-deposits:${ip(c)}`, 600, 60_000, 'Too many tracking requests. Try again shortly.')
    return c.json({ object: 'list', data: await chainDepositActivity(wallet) })
  })
  .get('/wallets/:address/deposit-sources', (c) => {
    walletAddress(c)
    return c.json({
      object: 'deposit_sources',
      live: config.KOVA_NETWORK === 'mainnet' && Boolean(config.AURORA_INTENTS_KEY),
      network: config.KOVA_NETWORK,
      arrives_as: config.AURORA_DESTINATION_ASSET,
      sources: Object.entries(SOURCES).map(([id, s]) => ({ id, ...s })),
    })
  })
  .post('/wallets/:address/deposit-address', async (c) => {
    const wallet = walletAddress(c)
    const { source } = (await c.req.json().catch(() => ({}))) as { source?: unknown }
    if (!isSource(source))
      throw new KovaError('invalid_request', `source is one of ${Object.keys(SOURCES).join(', ')}.`)
    limit(
      `deposit-address-ip:${ip(c)}`,
      60,
      3_600_000,
      'That’s a lot of addresses from here. Try again later.',
    )
    return c.json({ object: 'deposit_address', ...(await depositAddress(wallet, source)) })
  })
  .get('/wallets/:address/deposits', async (c) => {
    walletAddress(c)
    const address = c.req.query('address')
    if (!address || address.length > 128)
      throw new KovaError('invalid_request', 'address is a deposit address from this wallet.')
    limit(`deposits-ip:${ip(c)}`, 600, 3_600_000, 'Checking a lot from here. Try again shortly.')
    return c.json({ object: 'list', data: await depositsTo(address) })
  })
  .get('/vaults/:id', async (c) => {
    const id = vaultId(c)
    const vault = await db.query.walletVaults.findFirst({
      where: eq(schema.walletVaults.id, id.toLowerCase()),
    })
    if (!vault) throw notFound('vault', id)
    return c.json({
      object: 'vault',
      id,
      ciphertext: vault.ciphertext,
      nonce: vault.nonce,
      updated_at: vault.updatedAt.toISOString(),
    })
  })
  .put('/vaults/:id', async (c) => {
    const id = vaultId(c)
    const parsed = vaultBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success)
      throw new KovaError(
        'invalid_request',
        'Expected { ciphertext, nonce, signed_at, signature }.',
      )
    const { ciphertext, nonce, signed_at, signature } = parsed.data
    if (Math.abs(Date.now() / 1000 - signed_at) > 300)
      throw new KovaError('invalid_request', 'This backup was signed too long ago. Try again.')
    const signer = await recoverMessageAddress({
      message: vaultMessage(id, ciphertext, nonce, signed_at),
      signature: signature as Hex,
    }).catch(() => null)
    if (!signer || !isAddressEqual(signer, id))
      throw new KovaError('forbidden', 'Only this vault’s own key can replace it.')
    limit(
      `vault:${id.toLowerCase()}`,
      60,
      3_600_000,
      'That’s a lot of backups in an hour. Try again later.',
    )
    limit(
      `vault-ip:${ip(c)}`,
      120,
      3_600_000,
      'That’s a lot of backups from here. Try again later.',
    )

    const signedAt = BigInt(signed_at)
    const [saved] = await db
      .insert(schema.walletVaults)
      .values({ id: id.toLowerCase(), ciphertext, nonce, signedAt })
      .onConflictDoUpdate({
        target: schema.walletVaults.id,
        set: { ciphertext, nonce, signedAt, updatedAt: new Date() },
        // An older signature never replaces a newer backup.
        setWhere: lt(schema.walletVaults.signedAt, signedAt),
      })
      .returning()
    if (!saved) throw new KovaError('conflict', 'A newer backup is already saved.')
    return c.json({ object: 'vault', id, updated_at: saved.updatedAt.toISOString() })
  })
  .post('/faucet', async (c) => {
    if (config.KOVA_NETWORK !== 'testnet')
      throw new KovaError('forbidden', 'Test dollars are for testnet only.')
    const parsed = faucetBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) throw new KovaError('invalid_request', 'Expected { address }.')
    if (!walletClient)
      throw new KovaError('chain_error', 'Test dollars are not switched on for this server yet.')
    const address = getAddress(parsed.data.address)
    // Each wallet has five a day (kept in the database); this only slows one place making many wallets.
    limit(
      `faucet-ip:${ip(c)}`,
      20,
      86_400_000,
      'Lots of test dollars from here today. Try again tomorrow.',
    )

    const drip = await giveTestDollars(address)
    return c.json({
      object: 'faucet',
      amount: drip.amount,
      currency: 'AUSD',
      source: 'kova',
      tx_hash: drip.txHash,
      explorer_url: explorerTxUrl(network, drip.txHash),
      next_at: drip.nextAt.toISOString(),
    })
  })
