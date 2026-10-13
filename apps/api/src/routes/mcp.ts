import { formatAmount, parseAmount } from '@kova/monad'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { Hono } from 'hono'
import { getAddress, isAddress } from 'viem'
import { z } from 'zod'
import { KovaError } from '../errors.js'
import { limit } from '../limits.js'
import {
  agentForToken,
  agentPay,
  agentPayCharge,
  chargeIdFrom,
  describeAgent,
  type KeyPaymentRow,
  type KeyRow,
  paymentRow,
  paymentsOf,
} from '../services/spend-keys.js'

/**
 * Kova's MCP server: an AI agent (Claude, or any MCP client) pays with the key its owner gave it.
 *
 *   claude mcp add --transport http kova https://<api>/mcp --header "Authorization: Bearer kova_agent_…"
 *
 * Stateless: each request is answered by a fresh server for the token's key. The tools do only
 * what the agent's own endpoints do (routes/spend-keys.ts), under the same rules: the KovaCard
 * contract on Monad caps the key's day, and a payment over the ask-first line waits for its owner.
 */

const MAX_TEXT = 60_000
const text = (value: string) => ({ content: [{ type: 'text' as const, text: value.slice(0, MAX_TEXT) }] })

function said(payment: KeyPaymentRow): string {
  const amount = `$${formatAmount(payment.amount)}`
  switch (payment.status) {
    case 'paid':
      return `Paid ${amount} to ${payment.description ?? getAddress(payment.recipient)} on Monad. Transaction ${payment.txHash}. Payment id ${payment.id}.`
    case 'pending_approval':
      return `${amount} is over what this key pays without asking, so it's waiting for its owner to approve it in Kova. Payment id ${payment.id}: check it with kova_payment in a minute.`
    case 'denied':
      return `Refused: ${payment.reason ?? 'the key’s rules don’t allow it.'} Nothing was paid.`
    case 'declined':
      return `The owner declined ${amount}. Nothing was paid.`
    default:
      return `It didn't go through (${payment.status}): ${payment.reason ?? 'unknown'}. Nothing was paid.`
  }
}

function serverFor(key: KeyRow): McpServer {
  const server = new McpServer({ name: 'kova', version: '1.0.0' })

  server.registerTool(
    'kova_status',
    {
      title: 'What this Kova key can spend',
      description:
        'Shows the Kova key you pay with: what it has left this period, the most one payment can be, the amount above which its owner must approve, who it may pay, and when it ends. Check this before paying.',
      inputSchema: {},
    },
    async () => text(JSON.stringify(await describeAgent(key), null, 2)),
  )

  server.registerTool(
    'kova_pay',
    {
      title: 'Pay a wallet',
      description:
        'Sends US dollars (AUSD on Monad) from your owner’s Kova wallet to a wallet address, within this key’s limits. Kova pays the network fee. Use kova_pay_charge instead for a Kova shop’s charge or pay link.',
      inputSchema: {
        to: z.string().describe('The wallet address to pay (0x…).'),
        amount: z.string().describe('Dollars, like "2" or "4.50".'),
        note: z.string().max(200).optional().describe('What it’s for, shown to the owner.'),
      },
    },
    async ({ to, amount, note }) => {
      if (!isAddress(to)) return text('That isn’t a wallet address. Nothing was paid.')
      limit(`agent-pay:${key.id}`, 60, 60_000, 'Too many payments this minute.')
      try {
        return text(said(await agentPay(key, { to: getAddress(to), amount: parseAmount(amount), note })))
      } catch (error) {
        return text(`${error instanceof Error ? error.message : 'It didn’t go through.'} Nothing was paid.`)
      }
    },
  )

  server.registerTool(
    'kova_pay_charge',
    {
      title: 'Pay a Kova charge',
      description:
        'Pays a Kova shop’s charge (from a till’s QR code, a stall order or a payment link) for exactly what it asks, so the shop sees it paid. Pass the link or its pi_… id.',
      inputSchema: { charge: z.string().describe('The charge’s pay link or its pi_… id.') },
    },
    async ({ charge }) => {
      const id = chargeIdFrom(charge)
      if (!id) return text('That isn’t a Kova charge or pay link. Nothing was paid.')
      limit(`agent-pay:${key.id}`, 60, 60_000, 'Too many payments this minute.')
      try {
        return text(said(await agentPayCharge(key, id)))
      } catch (error) {
        return text(`${error instanceof Error ? error.message : 'It didn’t go through.'} Nothing was paid.`)
      }
    },
  )

  server.registerTool(
    'kova_payment',
    {
      title: 'Check a payment',
      description: 'Looks up one of this key’s payments by id: whether its owner approved it yet, and whether it paid.',
      inputSchema: { payment_id: z.string() },
    },
    async ({ payment_id }) => {
      const payment = await paymentRow(payment_id)
      if (!payment || payment.walletKeyId !== key.id) return text('No such payment for this key.')
      return text(said(payment))
    },
  )

  server.registerTool(
    'kova_history',
    {
      title: 'Recent payments',
      description: 'The last payments this key made or was refused, newest first.',
      inputSchema: {},
    },
    async () => {
      const rows = await paymentsOf([key.id], 20)
      if (rows.length === 0) return text('This key hasn’t paid anything yet.')
      return text(
        rows
          .map(
            (p) =>
              `${p.createdAt.toISOString()}  ${p.status.padEnd(16)} $${formatAmount(p.amount).padStart(8)}  ${p.description ?? p.recipient}${p.reason ? `  (${p.reason})` : ''}`,
          )
          .join('\n'),
      )
    },
  )

  return server
}

export const mcpRoutes = new Hono()

mcpRoutes.all('/mcp', async (c) => {
  const header = c.req.header('authorization') ?? ''
  let key: KeyRow
  try {
    key = await agentForToken(header.startsWith('Bearer ') ? header.slice(7).trim() : undefined)
  } catch (error) {
    if (error instanceof KovaError)
      return c.json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: error.message } }, 401, {
        'WWW-Authenticate': 'Bearer realm="kova", error="invalid_token"',
      })
    throw error
  }
  const server = serverFor(key)
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  await server.connect(transport)
  try {
    return await transport.handleRequest(c.req.raw)
  } finally {
    void server.close()
  }
})
