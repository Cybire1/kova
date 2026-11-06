import { BRIDGE_CHAINS, createSetsuna } from '@setsunaprotocol/sdk'
import { type Address, formatUnits, getAddress } from 'viem'
import { publicClient } from './chain'
import { settlementToken } from './config'
import {
  AfterBurn,
  type CrossChainSender,
  NETWORKS,
  type Network,
  type NetworkId,
  network,
  type Quote,
} from './crosschain-core'
import { checkSponsored, type SponsoredRequest } from './setsuna-check'

/**
 * Sends to other networks through Setsuna's sponsored bridge (Monad mainnet only): the person signs
 * one EIP-3009 authorization after Face ID; Setsuna's relayer pays the Monad gas, swaps the AUSD
 * to USDC on Curve (never below 99.8%) and burns it through Circle's CCTP; Circle's forwarding
 * service mints it on the other network and takes its fee in USDC. Kova holds no MON for this and
 * Setsuna charges nothing. Before anything is signed, Kova rebuilds and checks every detail of the
 * request itself (setsuna-check.ts).
 *
 * Setsuna's limits: at least 1 AUSD, 10 sends per wallet a day, and a daily gas budget shared by
 * every app that uses it (the relayer answers 503 when it's spent).
 */

const setsuna = createSetsuna({ client: publicClient as never })

/** Only where Circle delivers (no recipient gas): Sui, Aptos and the like would need them to claim it. */
const reach: NetworkId[] = NETWORKS.filter(
  (n) =>
    n.id !== 'monad' && BRIDGE_CHAINS.some((c) => c.domain === n.domain && c.gasInUSDC === true),
).map((n) => n.id)

const dollars = (base: bigint) => formatUnits(base, 6)

function toQuote(n: Network, amount: bigint, q: Awaited<ReturnType<typeof setsuna.bridge.quote>>) {
  return {
    network: n.id,
    amount,
    receive: BigInt(q.receive.raw),
    fee: BigInt(q.maxFee.raw),
    coverGas: true,
    seconds: n.seconds,
    problems: q.problems,
    ticket: q,
  } satisfies Quote
}

/** The relayer's refusals are already plain English; a spent gas budget comes back as a bare 503. */
function plain(e: unknown): string {
  const text = e instanceof Error ? e.message : ''
  if (/\b503\b/.test(text))
    return 'Kova’s free sends to other networks are used up for today. Nothing moved. Try again later.'
  if (/Network request failed|fetch/i.test(text))
    return 'Couldn’t reach the bridge. Check your connection. Nothing moved.'
  return text || 'That didn’t go through. Nothing moved.'
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export const setsunaSender: CrossChainSender = {
  demo: false,
  reach,
  coverOptional: false,
  minimum: 1_000_000n,

  async quote(n, amount) {
    const q = await setsuna.bridge.quote({
      token: 'AUSD',
      amount: dollars(amount),
      destinationDomain: n.domain,
    })
    return toQuote(n, amount, q)
  },

  async send(order, sign, onUpdate) {
    const n = network(order.network)
    const owner = getAddress(order.owner) as Address

    // Quote again just before signing: Circle's fee and the pool move, and the signature locks both.
    let fresh: Awaited<ReturnType<typeof setsuna.bridge.quote>>
    try {
      fresh = await setsuna.bridge.quote({
        token: 'AUSD',
        amount: dollars(order.quote.amount),
        destinationDomain: n.domain,
      })
    } catch (e) {
      throw new Error(plain(e))
    }
    if (!fresh.ok) throw new Error(fresh.problems.join(' ') || 'This send can’t go right now.')
    const receive = BigInt(fresh.receive.raw)
    if (receive < (order.quote.receive * 995n) / 1000n)
      throw new Error(
        `Circle’s fee went up: they’d now get ${dollars(receive)} USDC. Check it and slide again.`,
      )

    const request = setsuna.bridge.buildSponsored({
      owner,
      recipient: order.recipient,
      quote: fresh,
    })
    try {
      checkSponsored(request as unknown as SponsoredRequest, {
        ausd: settlementToken.address as Address,
        owner,
        amount: order.quote.amount,
        domain: n.domain,
        family: n.family,
        recipient: order.recipient,
        maxFee: BigInt(fresh.maxFee.raw),
        now: Math.floor(Date.now() / 1000),
      })
    } catch {
      throw new Error(
        'Kova stopped this send: the bridge asked to sign something other than what you chose. Nothing was signed.',
      )
    }

    const signature = await sign(request.typedData as never)
    onUpdate({ stage: 'burn' })
    let burnTx: string
    try {
      const sent = await setsuna.bridge.submitSponsored({ ...request, signature, app: 'kova' })
      burnTx = sent.burnTx
    } catch (e) {
      throw new Error(plain(e))
    }
    onUpdate({ stage: 'attest', burnTx })

    // Follow Circle until it has minted on their network: usually a couple of minutes.
    const until = Date.now() + 20 * 60_000
    let attested = false
    while (Date.now() < until) {
      const status = await setsuna.bridge.getStatus(burnTx as `0x${string}`)
      if (status.state === 'delivered' && status.destinationTx) {
        onUpdate({ stage: 'landed', burnTx, mintTx: status.destinationTx })
        return { burnTx, mintTx: status.destinationTx, stage: 'landed' }
      }
      if (status.state === 'attested' && !attested) {
        attested = true
        onUpdate({ stage: 'mint', burnTx })
      }
      await sleep(4000)
    }
    throw new AfterBurn(
      `It left Monad and Circle has it, but it’s taking longer than usual to land on ${n.name}. It will still arrive.`,
      burnTx,
    )
  },
}
