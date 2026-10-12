import {
  checkStealthAddress,
  parseStealthViewKey,
  randomNonce,
  type SignedAuthorization,
  STEALTH_SCHEME_ID,
  type StealthKeys,
  stealthKeysFromSignature,
  stealthPrivateKey,
  toSignedAuthorization,
  transferAuthorizationTypedData,
} from '@kova/monad'
import { type Address, getAddress, type Hex, isAddressEqual } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { moveTakings, type StealthReceipt, type TakingsMove } from './api'
import { balancesOf } from './chain'
import { network, settlementToken, shareWebUrl } from './config'
import { toBase } from './money'

/**
 * Private takings on the phone, with no React Native in it so it runs the same in Node.
 *
 * When a shop turns them on, every charge pays a fresh one-time address (ERC-5564) that only the
 * shop's keys can find and open, so nobody reading Monad can add its sales up. The keys come from
 * one signature by the shop owner's wallet; Kova only ever sees the public half. Here the phone
 * finds its sales with the viewing key, and moves them home with the spending key: one transfer
 * authorization per sale, signed by that sale's own address, which Kova submits and pays gas for.
 */

/** What finds a shop's sales: the viewing key and the spending public key. It can't move a cent. */
export interface TakingsView {
  viewingPrivateKey: Hex
  spendingPublicKey: Hex
}

/** A private sale this phone found with the shop's viewing key. */
export interface PrivateSale extends StealthReceipt {
  /** Base units (6 decimals). */
  base: bigint
  /** In the shop's wallet already. */
  moved: boolean
}

export const keysFromSignature = (signature: Hex): StealthKeys => stealthKeysFromSignature(signature)

export const viewFrom = (viewKey: string): TakingsView => parseStealthViewKey(viewKey)

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/**
 * The receipts that are this shop's. Kova lists them, but a sale only counts once the phone has
 * found its address with the shop's own viewing key. Each check is an elliptic-curve multiplication
 * (about 60 ms on a phone), so addresses found before (`known`) aren't checked again, and money
 * still waiting is checked first: `onFound` hears the sales found so far, once the waiting ones are
 * done and then as the history fills in, so the total is on screen before the rest are checked.
 */
export async function findSales(
  view: TakingsView,
  receipts: StealthReceipt[],
  known: ReadonlySet<string>,
  onFound?: (sales: PrivateSale[]) => void,
): Promise<{ sales: PrivateSale[]; found: string[] }> {
  const mine: (PrivateSale | null)[] = receipts.map(() => null)
  const found: string[] = []
  const so = () => mine.filter((s): s is PrivateSale => s !== null)
  const order = receipts.map((_, i) => i)
  // Waiting money first: it's what the total and the move need.
  order.sort((a, b) => Number(receipts[a]?.swept_tx !== null) - Number(receipts[b]?.swept_tx !== null))
  const waiting = receipts.filter((r) => r.swept_tx === null).length
  let checked = 0
  for (const [n, i] of order.entries()) {
    const receipt = receipts[i]
    if (!receipt) continue
    const address = receipt.stealth_address.toLowerCase()
    let ours = known.has(address)
    if (!ours && receipt.scheme_id === STEALTH_SCHEME_ID) {
      try {
        ours =
          checkStealthAddress(view, {
            ephemeralPublicKey: receipt.ephemeral_public_key,
            viewTag: receipt.view_tag,
            stealthAddress: receipt.stealth_address,
          }) !== null
      } catch {
        ours = false
      }
      if (ours) found.push(address)
      checked += 1
      // Let the screen draw between checks, and show what's found so far now and then.
      if (checked % 4 === 0) await tick()
      if (onFound && n >= waiting && checked % 24 === 0) onFound(so())
    }
    if (ours) mine[i] = { ...receipt, base: toBase(receipt.amount), moved: receipt.swept_tx !== null }
    if (onFound && n === waiting - 1 && checked > 0) onFound(so())
  }
  return { sales: so(), found }
}

/** What waits at one-time addresses: the unmoved sales, added up. */
export function waitingIn(sales: PrivateSale[]): { amount: bigint; count: number } {
  let amount = 0n
  let count = 0
  for (const sale of sales)
    if (!sale.moved) {
      amount += sale.base
      count += 1
    }
  return { amount, count }
}

/** The short form people can compare at a glance: 0x067D…20a2. */
export const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`

export interface MoveProgress {
  step: 'unlocking' | 'checking' | 'signing' | 'moving'
  done: number
  total: number
}

export interface MoveOutcome {
  /** Base units that reached the shop's wallet. */
  amount: bigint
  /** Sales moved. */
  count: number
  /** Kova's answer for each, in order. */
  moves: TakingsMove[]
  /** The newest move's transaction, to see on Monadscan. */
  explorerUrl: string | null
  /** Sales whose move didn't go through, and the first reason given. */
  failed: number
  reason: string | null
  /** Addresses that held nothing: already moved some other way. */
  empty: number
  to: Address
  /** From the first signature to Kova's last answer. */
  ms: number
}

/** Kova's relay speaks of payments; a move is the shop's own money going home. Said for what it is. */
export function moveProblem(error: string): string {
  if (/did not confirm|in time/i.test(error)) return 'Monad was slow to confirm it. Nothing is lost: move it again in a moment.'
  if (/everything the address holds/i.test(error)) return 'Its balance changed while moving. Try again.'
  if (/not one of this shop/i.test(error)) return 'Kova doesn’t list that address as this shop’s.'
  return error
}

/** How long a move stays valid: well inside the hour Kova allows, even with a phone clock running fast. */
const VALID_FOR_S = 30 * 60
/** The most moves Kova takes in one request. */
const BATCH = 50

/**
 * Moves sales into the shop's wallet. Each sale's address signs its own transfer (with the key
 * only the shop's spending key can make), for everything it holds as read from Monad, or the sale's
 * amount if the read fails. Kova submits them in batches of 50 and pays the gas.
 */
export async function moveSales(input: {
  keys: StealthKeys
  sales: PrivateSale[]
  to: Address
  onProgress?: (progress: MoveProgress) => void
}): Promise<MoveOutcome> {
  const { keys, sales, onProgress } = input
  const to = getAddress(input.to)
  const total = sales.length
  const started = Date.now()
  onProgress?.({ step: 'checking', done: 0, total })
  const held = await balancesOf(sales.map((s) => s.stealth_address))

  const moves: TakingsMove[] = []
  let empty = 0
  let signed = 0
  for (let i = 0; i < sales.length; i += BATCH) {
    const authorizations: SignedAuthorization[] = []
    for (const sale of sales.slice(i, i + BATCH)) {
      const value = held.get(sale.stealth_address.toLowerCase()) ?? sale.base
      signed += 1
      if (value === 0n) {
        empty += 1
        continue
      }
      const account = privateKeyToAccount(stealthPrivateKey(keys, sale.ephemeral_public_key))
      // The key the spending key made must open exactly this sale's address, or nothing is signed.
      if (!isAddressEqual(account.address, sale.stealth_address)) {
        moves.push({ from: sale.stealth_address, error: 'This sale’s address didn’t open with your keys.' })
        continue
      }
      const authorization = {
        from: account.address,
        to,
        value,
        validAfter: 0n,
        validBefore: BigInt(Math.floor(Date.now() / 1000) + VALID_FOR_S),
        nonce: randomNonce(),
      }
      const signature = await account.signTypedData(transferAuthorizationTypedData(settlementToken, network.chainId, authorization))
      authorizations.push(toSignedAuthorization(settlementToken.address, authorization, signature))
      onProgress?.({ step: 'signing', done: signed, total })
      await tick()
    }
    if (!authorizations.length) continue
    onProgress?.({ step: 'moving', done: signed, total })
    moves.push(...(await moveTakings(authorizations)))
  }

  let amount = 0n
  let count = 0
  let failed = 0
  let reason: string | null = null
  let explorerUrl: string | null = null
  for (const move of moves) {
    if ('error' in move) {
      // "Already moved": it left some other way between the read and the move. Nothing is lost.
      if (/already moved/i.test(move.error)) empty += 1
      else {
        failed += 1
        reason ??= moveProblem(move.error)
      }
      continue
    }
    amount += toBase(move.amount)
    count += 1
    explorerUrl = move.explorer_url
  }
  return { amount, count, moves, explorerUrl, failed, reason, empty, to, ms: Date.now() - started }
}

/**
 * The accountant's view: Kova's web page for this network, with the view key after the # (which
 * browsers never send to a server). It finds and lists every sale, and can't move any of them.
 */
export const booksLink = (viewKey: string, shopName: string) =>
  `${shareWebUrl}/books#${viewKey}&name=${encodeURIComponent(shopName.trim() || 'Your shop')}`
