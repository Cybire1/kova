import { isAddress } from 'viem'

/**
 * Send to any network: the parts with no React in them, so they can be tested on their own.
 *
 * Kova holds dollars on Monad. A send to another network goes out as USDC through Circle's CCTP:
 * burned on Monad (Circle domain 15), signed off by Circle, minted on the other network. With
 * their gas covered, Circle's forwarding service mints it for them and takes its fee in USDC, so
 * they can spend it the moment it lands. Sui and Aptos have no forwarding: the recipient would have
 * to collect it there with their own gas.
 *
 * Moving the money is behind `CrossChainSender` (lib/crosschain.ts picks the one in use): Setsuna's
 * sponsored bridge on mainnet (crosschain-setsuna.ts), a stand-in that moves nothing in development.
 */

export type Family = 'evm' | 'solana' | 'move'

export type NetworkId =
  | 'monad'
  | 'base'
  | 'ethereum'
  | 'arbitrum'
  | 'optimism'
  | 'polygon'
  | 'avalanche'
  | 'unichain'
  | 'linea'
  | 'world'
  | 'sonic'
  | 'sei'
  | 'hyperevm'
  | 'ink'
  | 'arc'
  | 'codex'
  | 'plume'
  | 'xdc'
  | 'edge'
  | 'solana'
  | 'sui'
  | 'aptos'

export type Network = {
  id: NetworkId
  name: string
  /** The short code on the boarding pass, like an airport's. */
  code: string
  family: Family
  /** Circle's CCTP domain. */
  domain: number
  /** EVM chain id, to read a network out of an `ethereum:0x…@8453` code. */
  chainId?: number
  /** About how long a send takes to land, in seconds. */
  seconds: number
  /** What they'd pay gas in, to collect it themselves. */
  gasToken: string
  /** Circle's forwarding fee in USDC base units, used until the live one comes back. Null: no forwarding there. */
  fallbackFee: bigint | null
  /** Where a transaction can be looked at. Null where Kova doesn't know a trustworthy explorer yet. */
  explorer: { name: string; tx: (hash: string) => string } | null
}

/** Kova's own network: a send here isn't a cross-network send at all. */
export const MONAD_DOMAIN = 15

/**
 * How long a send out of Monad takes. Circle attests at standard finality and its forwarding
 * service mints on arrival: Setsuna's mainnet sends to Base landed within a couple of minutes.
 */
const OUT = 120

const scan = (name: string, base: string) => ({ name, tx: (h: string) => `${base}${h}` })

/**
 * Every network a send can reach, in the order the picker shows them. Domains and chain ids are
 * Circle's CCTP V2 list (as Setsuna's SDK carries it); fees are Circle's medium forwarding fee from
 * Monad, read from its fee API on 6 Nov 2026.
 */
export const NETWORKS: readonly Network[] = [
  {
    id: 'base',
    name: 'Base',
    code: 'BASE',
    family: 'evm',
    domain: 6,
    chainId: 8453,
    seconds: OUT,
    gasToken: 'ETH',
    fallbackFee: 53_569n,
    explorer: scan('Basescan', 'https://basescan.org/tx/'),
  },
  {
    id: 'monad',
    name: 'Monad',
    code: 'MON',
    family: 'evm',
    domain: MONAD_DOMAIN,
    chainId: 143,
    seconds: 1,
    gasToken: 'MON',
    fallbackFee: 0n,
    explorer: scan('MonadVision', 'https://monadvision.com/tx/'),
  },
  {
    id: 'ethereum',
    name: 'Ethereum',
    code: 'ETH',
    family: 'evm',
    domain: 0,
    chainId: 1,
    seconds: OUT,
    gasToken: 'ETH',
    fallbackFee: 1_037_102n,
    explorer: scan('Etherscan', 'https://etherscan.io/tx/'),
  },
  {
    id: 'arbitrum',
    name: 'Arbitrum',
    code: 'ARB',
    family: 'evm',
    domain: 3,
    chainId: 42161,
    seconds: OUT,
    gasToken: 'ETH',
    fallbackFee: 72_935n,
    explorer: scan('Arbiscan', 'https://arbiscan.io/tx/'),
  },
  {
    id: 'optimism',
    name: 'OP Mainnet',
    code: 'OP',
    family: 'evm',
    domain: 2,
    chainId: 10,
    seconds: OUT,
    gasToken: 'ETH',
    fallbackFee: 52_107n,
    explorer: scan('OP Etherscan', 'https://optimistic.etherscan.io/tx/'),
  },
  {
    id: 'polygon',
    name: 'Polygon',
    code: 'POL',
    family: 'evm',
    domain: 7,
    chainId: 137,
    seconds: OUT,
    gasToken: 'POL',
    fallbackFee: 58_454n,
    explorer: scan('Polygonscan', 'https://polygonscan.com/tx/'),
  },
  {
    id: 'avalanche',
    name: 'Avalanche',
    code: 'AVAX',
    family: 'evm',
    domain: 1,
    chainId: 43114,
    seconds: OUT,
    gasToken: 'AVAX',
    fallbackFee: 61_581n,
    explorer: scan('Snowtrace', 'https://snowtrace.io/tx/'),
  },
  {
    id: 'unichain',
    name: 'Unichain',
    code: 'UNI',
    family: 'evm',
    domain: 10,
    chainId: 130,
    seconds: OUT,
    gasToken: 'ETH',
    fallbackFee: 50_888n,
    explorer: scan('Uniscan', 'https://uniscan.xyz/tx/'),
  },
  {
    id: 'linea',
    name: 'Linea',
    code: 'LINEA',
    family: 'evm',
    domain: 11,
    chainId: 59144,
    seconds: OUT,
    gasToken: 'ETH',
    fallbackFee: 188_473n,
    explorer: scan('Lineascan', 'https://lineascan.build/tx/'),
  },
  {
    id: 'world',
    name: 'World Chain',
    code: 'WLD',
    family: 'evm',
    domain: 14,
    chainId: 480,
    seconds: OUT,
    gasToken: 'ETH',
    fallbackFee: 50_918n,
    explorer: scan('Worldscan', 'https://worldscan.org/tx/'),
  },
  {
    id: 'sonic',
    name: 'Sonic',
    code: 'S',
    family: 'evm',
    domain: 13,
    chainId: 146,
    seconds: OUT,
    gasToken: 'S',
    fallbackFee: 50_629n,
    explorer: scan('Sonicscan', 'https://sonicscan.org/tx/'),
  },
  {
    id: 'sei',
    name: 'Sei',
    code: 'SEI',
    family: 'evm',
    domain: 16,
    chainId: 1329,
    seconds: OUT,
    gasToken: 'SEI',
    fallbackFee: 51_268n,
    explorer: scan('Seitrace', 'https://seitrace.com/tx/'),
  },
  {
    id: 'hyperevm',
    name: 'HyperEVM',
    code: 'HYPE',
    family: 'evm',
    domain: 19,
    chainId: 999,
    seconds: OUT,
    gasToken: 'HYPE',
    fallbackFee: 82_167n,
    explorer: scan('HyperEVMScan', 'https://hyperevmscan.io/tx/'),
  },
  {
    id: 'ink',
    name: 'Ink',
    code: 'INK',
    family: 'evm',
    domain: 21,
    chainId: 57073,
    seconds: OUT,
    gasToken: 'ETH',
    fallbackFee: 50_596n,
    explorer: scan('Ink Explorer', 'https://explorer.inkonchain.com/tx/'),
  },
  {
    id: 'arc',
    name: 'Arc',
    code: 'ARC',
    family: 'evm',
    domain: 26,
    chainId: 5042,
    seconds: OUT,
    gasToken: 'USDC',
    fallbackFee: 17_448n,
    explorer: null,
  },
  {
    id: 'codex',
    name: 'Codex',
    code: 'CODEX',
    family: 'evm',
    domain: 12,
    chainId: 81224,
    seconds: OUT,
    gasToken: 'ETH',
    fallbackFee: 53_282n,
    explorer: scan('Codex Explorer', 'https://explorer.codex.xyz/tx/'),
  },
  {
    id: 'plume',
    name: 'Plume',
    code: 'PLUME',
    family: 'evm',
    domain: 22,
    chainId: 98866,
    seconds: OUT,
    gasToken: 'PLUME',
    fallbackFee: 53_970n,
    explorer: scan('Plume Explorer', 'https://explorer.plume.org/tx/'),
  },
  {
    id: 'xdc',
    name: 'XDC',
    code: 'XDC',
    family: 'evm',
    domain: 18,
    chainId: 50,
    seconds: OUT,
    gasToken: 'XDC',
    fallbackFee: 50_115n,
    explorer: scan('XDCScan', 'https://xdcscan.com/tx/'),
  },
  {
    id: 'edge',
    name: 'Edge',
    code: 'EDGE',
    family: 'evm',
    domain: 28,
    chainId: 3343,
    seconds: OUT,
    gasToken: 'ETH',
    fallbackFee: 70_032n,
    explorer: null,
  },
  {
    id: 'solana',
    name: 'Solana',
    code: 'SOL',
    family: 'solana',
    domain: 5,
    seconds: OUT,
    gasToken: 'SOL',
    fallbackFee: 120_161n,
    explorer: scan('Solscan', 'https://solscan.io/tx/'),
  },
  {
    id: 'sui',
    name: 'Sui',
    code: 'SUI',
    family: 'move',
    domain: 8,
    seconds: OUT,
    gasToken: 'SUI',
    fallbackFee: null,
    explorer: scan('Suiscan', 'https://suiscan.xyz/mainnet/tx/'),
  },
  {
    id: 'aptos',
    name: 'Aptos',
    code: 'APT',
    family: 'move',
    domain: 9,
    seconds: OUT,
    gasToken: 'APT',
    fallbackFee: null,
    explorer: {
      name: 'Aptos Explorer',
      tx: (h) => `https://explorer.aptoslabs.com/txn/${h}?network=mainnet`,
    },
  },
]

export function network(id: NetworkId): Network {
  const found = NETWORKS.find((n) => n.id === id)
  if (!found) throw new Error(`Unknown network ${id}`)
  return found
}

export const isNetworkId = (value: unknown): value is NetworkId =>
  typeof value === 'string' && NETWORKS.some((n) => n.id === value)

/** Whether Circle delivers there and takes its fee in USDC, so the recipient needs no gas. */
export const canCoverGas = (n: Network) => n.fallbackFee !== null && n.id !== 'monad'

/** "1 s", "2 min". */
export const eta = (seconds: number) =>
  seconds < 60 ? `${seconds} s` : `${Math.round(seconds / 60)} min`

// --- Reading an address --------------------------------------------------------------------

export type Unsupported = 'Tron' | 'Bitcoin' | 'TON'

export type Detected =
  | { kind: 'evm'; address: string; hint?: NetworkId }
  | { kind: 'solana'; address: string }
  | { kind: 'move'; address: string }
  | { kind: 'unsupported'; address: string; family: Unsupported }

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

/** A base58 string's bytes, or null if it isn't base58. */
export function base58Decode(text: string): Uint8Array | null {
  if (!text) return null
  const bytes: number[] = []
  for (const ch of text) {
    let carry = B58.indexOf(ch)
    if (carry < 0) return null
    for (let i = 0; i < bytes.length; i++) {
      carry += (bytes[i] ?? 0) * 58
      bytes[i] = carry & 0xff
      carry >>= 8
    }
    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }
  let zeros = 0
  while (zeros < text.length && text[zeros] === '1') zeros++
  return new Uint8Array([...new Array(zeros).fill(0), ...bytes.reverse()])
}

/** How many bytes a base58 string decodes to, or null if it isn't base58. */
export function base58Bytes(text: string): number | null {
  return base58Decode(text)?.length ?? null
}

/**
 * What a pasted or scanned address is, from its shape alone: 0x and 40 hex is an EVM wallet (any
 * of the EVM networks, so the person picks); 32 to 44 base58 characters that decode to 32 bytes is
 * Solana; 0x and 64 hex is Sui or Aptos. Tron, Bitcoin and TON are recognised so Kova can say it
 * can't send there yet, rather than "that isn't an address". Wallet QR prefixes (solana:,
 * ethereum:…@chain) are read too.
 */
export function detectAddress(input: string): Detected | null {
  let value = input.trim()
  if (!value) return null

  const sol = /^solana:([1-9A-HJ-NP-Za-km-z]{32,44})(?:\?.*)?$/.exec(value)
  if (sol?.[1]) value = sol[1]

  let hint: NetworkId | undefined
  const eip681 = /^ethereum:(?:pay-)?(0x[0-9a-fA-F]{40})(?:@(\d+))?(?:[/?].*)?$/.exec(value)
  if (eip681?.[1]) {
    value = eip681[1]
    const chainId = eip681[2] ? Number(eip681[2]) : undefined
    hint = NETWORKS.find((n) => chainId !== undefined && n.chainId === chainId)?.id
  }

  if (/^0x[0-9a-fA-F]{40}$/.test(value)) {
    if (!isAddress(value)) return null
    return hint ? { kind: 'evm', address: value, hint } : { kind: 'evm', address: value }
  }
  if (/^0x[0-9a-fA-F]{64}$/.test(value)) return { kind: 'move', address: value.toLowerCase() }
  if (/^(EQ|UQ)[A-Za-z0-9_-]{46}$/.test(value))
    return { kind: 'unsupported', address: value, family: 'TON' }
  if (/^bc1[02-9ac-hj-np-z]{11,71}$/i.test(value))
    return { kind: 'unsupported', address: value, family: 'Bitcoin' }

  const size = base58Bytes(value)
  if (size === null) return null
  if (value.length >= 32 && value.length <= 44 && size === 32)
    return { kind: 'solana', address: value }
  if (/^T/.test(value) && value.length === 34 && size === 25)
    return { kind: 'unsupported', address: value, family: 'Tron' }
  if (/^[13]/.test(value) && value.length >= 26 && value.length <= 35 && size === 25)
    return { kind: 'unsupported', address: value, family: 'Bitcoin' }
  return null
}

/** The networks an address of this kind can receive on, of those `reach` lists. */
export function networksFor(kind: Family, reach?: readonly NetworkId[]): Network[] {
  return NETWORKS.filter((n) => n.family === kind && (!reach || reach.includes(n.id)))
}

/** Why Kova could tell, in a line under the address. */
export function howKnown(found: Detected): string {
  switch (found.kind) {
    case 'evm':
      return found.hint
        ? `The code says ${network(found.hint).name}.`
        : '0x and 40 characters: an EVM address.'
    case 'solana':
      return `${found.address.length} characters, no 0x: that’s how Kova knew.`
    case 'move':
      return '0x and 64 more characters. Sui and Aptos both look like this.'
    case 'unsupported':
      return `This looks like a ${found.family} address.`
  }
}

/** 0x7a3F…91cE, 7xKX…gAsU. */
export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

// --- Fees ----------------------------------------------------------------------------------

export const FEE_API = 'https://iris-api.circle.com/v2/burn/USDC/fees'

/** Circle's fee endpoint from Monad to `to`, with the forwarding fee. */
export const feeUrl = (to: Network) =>
  `${FEE_API}/${MONAD_DOMAIN}/${to.domain}${canCoverGas(to) ? '?forward=true' : ''}`

/**
 * The forwarding fee out of Circle's answer: the medium one for a standard transfer (finality
 * 2000). Null if it isn't there or isn't a number.
 */
export function readForwardFee(body: unknown): bigint | null {
  if (!Array.isArray(body)) return null
  const standard =
    body.find((row) => row && typeof row === 'object' && row.finalityThreshold === 2000) ?? body[0]
  const med = standard?.forwardFee?.med
  return typeof med === 'number' && Number.isFinite(med) && med >= 0
    ? BigInt(Math.round(med))
    : null
}

/**
 * The fee ceiling a send signs for: Circle's fee and 5%, since it drifts between the quote and the
 * send and Circle keeps the whole ceiling. The picker shows this, so its numbers match the review.
 */
export const feeCeiling = (fee: bigint) => (fee * 105n + 99n) / 100n

export type Quote = {
  network: NetworkId
  /** What leaves your balance. */
  amount: bigint
  /** What they get, in USDC base units. */
  receive: bigint
  fee: bigint
  coverGas: boolean
  seconds: number
  /** Why it can't go as it is (too small, a fee service down…), fit to show. Empty when it can. */
  problems: string[]
  /** Whatever the sender needs back to send this quote. */
  ticket?: unknown
}

/** You send `amount`; with their gas covered the fee comes out of it, so they get a little less. */
export function quote(
  n: Network,
  amount: bigint,
  coverGas: boolean,
  liveFee: bigint | null,
): Quote {
  const cover = coverGas && canCoverGas(n)
  const fee = cover ? feeCeiling(liveFee ?? n.fallbackFee ?? 0n) : 0n
  return {
    network: n.id,
    amount,
    receive: amount > fee ? amount - fee : 0n,
    fee,
    coverGas: cover,
    seconds: n.seconds,
    problems: [],
  }
}

// --- Sending -------------------------------------------------------------------------------

/**
 * Where a send is. `burn`: leaving Monad. `attest`: Circle is checking the burn. `mint`: being
 * minted on their network (gas covered). `landed`: in their wallet. `ready`: signed by Circle and
 * waiting for them to collect it (gas not covered).
 */
export type Stage = 'burn' | 'attest' | 'mint' | 'landed' | 'ready'

export type SendUpdate = {
  stage: Stage
  burnTx?: string
  mintTx?: string
}

export type SendOrder = {
  network: NetworkId
  /** The wallet sending, on Monad. */
  owner: string
  recipient: string
  quote: Quote
}

/** Typed data the wallet signs (after Face ID), as viem takes it. */
export type TypedData = {
  domain: Record<string, unknown>
  types: Record<string, readonly { name: string; type: string }[]>
  primaryType: string
  message: Record<string, unknown>
}

export type Sign = (typedData: TypedData) => Promise<`0x${string}`>

export type SendResult = { burnTx: string; mintTx: string | null; stage: 'landed' | 'ready' }

/** A send failed after the money left Monad: it will still land, so the screen must not offer to send again. */
export class AfterBurn extends Error {
  readonly burnTx: string
  constructor(message: string, burnTx: string) {
    super(message)
    this.burnTx = burnTx
  }
}

/**
 * What moves the money. `onUpdate` drives the in-flight screen; the promise settles once the send
 * has landed (or is ready for them to collect), or rejects with a message fit to show. A rejection
 * after the burn is an `AfterBurn`.
 */
export interface CrossChainSender {
  /** True for the stand-in that moves nothing, so the screens can say so. */
  readonly demo: boolean
  /** The networks it can send to. */
  readonly reach: readonly NetworkId[]
  /** Whether "cover their gas" can be switched off (otherwise it's always on). */
  readonly coverOptional: boolean
  /** The smallest send, in base units. */
  readonly minimum: bigint
  /** Its own quote (swap, fees), when it has one; otherwise Kova's from Circle's fee API. */
  quote?(n: Network, amount: bigint, coverGas: boolean): Promise<Quote>
  send(order: SendOrder, sign: Sign, onUpdate: (update: SendUpdate) => void): Promise<SendResult>
}

const fakeHash = (seed: number) => {
  let h = ''
  let x = seed % 2147483647 || 1
  for (let i = 0; i < 64; i++) {
    x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff
    h += ((x >>> 16) % 16).toString(16)
  }
  return `0x${h}`
}

/**
 * A stand-in for development builds on testnet, where Setsuna's bridge doesn't run: walks through
 * the stages on a quick clock, signs nothing and moves nothing.
 */
export const demoSender: CrossChainSender = {
  demo: true,
  reach: NETWORKS.map((n) => n.id),
  coverOptional: true,
  minimum: 1_000_000n,
  async send(order, _sign, onUpdate) {
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
    const seed = Date.now()
    const burnTx = fakeHash(seed)
    onUpdate({ stage: 'burn' })
    await wait(900)
    onUpdate({ stage: 'attest', burnTx })
    await wait(2500)
    if (!order.quote.coverGas) {
      onUpdate({ stage: 'ready', burnTx })
      return { burnTx, mintTx: null, stage: 'ready' }
    }
    onUpdate({ stage: 'mint', burnTx })
    await wait(1200)
    const mintTx = fakeHash(seed + 7)
    onUpdate({ stage: 'landed', burnTx, mintTx })
    return { burnTx, mintTx, stage: 'landed' }
  },
}
