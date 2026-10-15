import { schema, uuidv7 } from '@kova/db'
import {
  eip3009Abi,
  explorerTxUrl,
  formatAmount,
  parseSignedAuthorization,
  tokenByAddress,
} from '@kova/monad'
import { and, desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { type Address, getAddress, isAddress, isAddressEqual } from 'viem'
import { z } from 'zod'
import { network, publicClient, settlementToken } from '../chain.js'
import { config } from '../config.js'
import { db } from '../db.js'
import { KovaError, notFound } from '../errors.js'
import { decodeId, encodeId } from '../ids.js'
import { clientIp, limit } from '../limits.js'
import { relayAuthorization } from '../relay.js'

/**
 * Links: send dollars to anyone, by a link. The sender's wallet sends the dollars to a fresh
 * one-time address and puts that address's key in the link, after the # so it never reaches a
 * server. Whoever opens the link signs, with that key, a transfer of everything at the address to
 * their own wallet, and Kova submits it and pays the gas. The sender kept the key, so an unclaimed
 * link can be taken back the same way.
 *
 * Kova only keeps what the page needs to greet the recipient: who sent it, the note, and whether it
 * has been claimed. Whoever holds the link holds the dollars, like cash in an envelope.
 */

type Link = typeof schema.paymentLinks.$inferSelect

const createBody = z.object({
  link_address: z.string().refine(isAddress, 'Expected the link’s address'),
  sender_address: z.string().refine(isAddress, 'Expected the sender’s address'),
  sender_name: z.string().trim().max(60).optional(),
  note: z.string().trim().max(140).optional(),
  display_currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
})

async function balanceOf(address: Address) {
  return publicClient.readContract({
    address: settlementToken.address,
    abi: eip3009Abi,
    functionName: 'balanceOf',
    args: [address],
  })
}

async function find(id: string) {
  const uuid = decodeId('paymentLink', id)
  const link = uuid
    ? await db.query.paymentLinks.findFirst({ where: eq(schema.paymentLinks.id, uuid) })
    : undefined
  if (!link) throw notFound('link', id)
  return link
}

export function serializeLink(link: Link) {
  return {
    object: 'payment_link',
    id: encodeId('paymentLink', link.id),
    network: link.network,
    status: link.status,
    amount: formatAmount(link.amount),
    currency: settlementToken.symbol,
    token: settlementToken.address,
    chain_id: network.chainId,
    link_address: getAddress(link.linkAddress),
    sender_address: getAddress(link.senderAddress),
    sender_name: link.senderName,
    note: link.note,
    display_currency: link.displayCurrency,
    claimed_by: link.claimedBy ? getAddress(link.claimedBy) : null,
    claim_tx: link.claimTx,
    claim_explorer_url: link.claimTx ? explorerTxUrl(network, link.claimTx as `0x${string}`) : null,
    claimed_at: link.claimedAt?.toISOString() ?? null,
    created_at: link.createdAt.toISOString(),
  }
}

export const linkRoutes = new Hono()
  /** Records a link once its dollars are at its address. The amount is what the address holds. */
  .post('/links', async (c) => {
    limit(
      `links-ip:${clientIp(c)}`,
      30,
      600_000,
      'That’s a lot of links from here. Try again shortly.',
    )
    const parsed = createBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success)
      throw new KovaError('invalid_request', parsed.error.issues[0]?.message ?? 'Invalid link')
    const body = parsed.data
    const linkAddress = getAddress(body.link_address)
    const existing = await db.query.paymentLinks.findFirst({
      where: eq(schema.paymentLinks.linkAddress, linkAddress.toLowerCase()),
    })
    if (existing) return c.json(serializeLink(existing))
    const amount = await balanceOf(linkAddress)
    if (amount <= 0n)
      throw new KovaError('conflict', 'The link has no dollars yet. Send them first.')
    const [link] = await db
      .insert(schema.paymentLinks)
      .values({
        id: uuidv7(),
        network: config.KOVA_NETWORK,
        linkAddress: linkAddress.toLowerCase(),
        senderAddress: getAddress(body.sender_address).toLowerCase(),
        senderName: body.sender_name || null,
        note: body.note || null,
        amount,
        displayCurrency: body.display_currency ?? null,
      })
      .returning()
    if (!link) throw new KovaError('internal', 'Could not save the link')
    return c.json(serializeLink(link), 201)
  })

  /** A sender's links, newest first, so the app can show which were claimed. */
  .get('/links', async (c) => {
    const sender = c.req.query('sender') ?? ''
    if (!isAddress(sender))
      throw new KovaError('invalid_request', 'Expected ?sender=<wallet address>')
    const rows = await db.query.paymentLinks.findMany({
      where: and(
        eq(schema.paymentLinks.senderAddress, sender.toLowerCase()),
        eq(schema.paymentLinks.network, config.KOVA_NETWORK),
      ),
      orderBy: desc(schema.paymentLinks.createdAt),
      limit: 50,
    })
    return c.json({ object: 'list', data: rows.map(serializeLink) })
  })

  /** Public: what the link page shows before it's claimed. */
  .get('/public/links/:id', async (c) => c.json(serializeLink(await find(c.req.param('id')))))

  /**
   * Public: claims a link. The body is a transfer authorization signed with the link's key, for
   * everything at the link's address, to the claimer's wallet (or back to the sender). Kova submits
   * it and pays the gas.
   */
  .post('/public/links/:id/claim', async (c) => {
    limit(
      `claim-ip:${clientIp(c)}`,
      30,
      600_000,
      'That’s a lot of tries from here. Try again shortly.',
    )
    const link = await find(c.req.param('id'))
    if (link.status !== 'open')
      throw new KovaError(
        'conflict',
        link.status === 'returned'
          ? 'The sender took these dollars back.'
          : 'This link has already been claimed.',
      )
    const signed = parseSignedAuthorization(await c.req.json().catch(() => null))
    if (!signed) throw new KovaError('invalid_request', 'Expected a signed transfer authorization.')
    const { authorization, signature } = signed
    const token = tokenByAddress(config.KOVA_NETWORK, signed.token)
    if (!token || !isAddressEqual(token.address, settlementToken.address))
      throw new KovaError('invalid_request', 'Claim the dollar this link holds.')
    if (!isAddressEqual(authorization.from, link.linkAddress as Address))
      throw new KovaError('invalid_request', 'This approval isn’t from this link.')
    const held = await balanceOf(link.linkAddress as Address)
    if (held <= 0n) throw new KovaError('conflict', 'This link has already been claimed.')
    if (authorization.value !== held)
      throw new KovaError('invalid_request', 'Claim everything the link holds.')

    const { receipt, ms } = await relayAuthorization(token, authorization, signature)
    const toSender = isAddressEqual(authorization.to, link.senderAddress as Address)
    const [updated] = await db
      .update(schema.paymentLinks)
      .set({
        status: toSender ? 'returned' : 'claimed',
        claimedBy: authorization.to.toLowerCase(),
        claimTx: receipt.transactionHash,
        claimedAt: new Date(),
      })
      .where(and(eq(schema.paymentLinks.id, link.id), eq(schema.paymentLinks.status, 'open')))
      .returning()
    return c.json({ ...serializeLink(updated ?? link), ms: Math.round(ms) })
  })
