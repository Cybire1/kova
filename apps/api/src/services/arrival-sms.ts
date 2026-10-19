import { schema } from '@kova/db'
import { formatAmount } from '@kova/monad'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { type Address, erc20Abi, getAddress } from 'viem'
import { publicClient } from '../chain.js'
import { config } from '../config.js'
import { db } from '../db.js'
import { sendSmsLater, smsReady } from './sms.js'

/**
 * A text when dollars arrive for someone Kova knows by phone: an active USSD pocket (whose owner may
 * have no app or data at all, so a text is the only way they'd know) or a wallet whose number was
 * verified. Called by the watcher only for transfers it hadn't indexed before, so replaying blocks
 * never texts twice. Best effort: a text that doesn't send never touches the payment.
 *
 * Pocket spends text their own receipts (pockets.ts), so transfers out of a pocket are skipped here.
 */

export interface Arrival {
  tokenAddress: string
  fromAddress: string
  toAddress: string
  amount: bigint
}

/** Below a cent isn't worth a text. */
const MIN_AMOUNT = 10_000n

export const arrivalTextsReady = () =>
  smsReady() && (config.KOVA_PHONE_SEND_ENABLED === '1' || config.KOVA_USSD_ENABLED === '1')

const prefix = () => (config.KOVA_NETWORK === 'testnet' ? 'Kova TEST' : 'Kova')

async function balanceText(token: string, holder: string): Promise<string> {
  const balance = await publicClient
    .readContract({
      address: getAddress(token),
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [getAddress(holder) as Address],
    })
    .catch(() => null)
  return balance === null ? '' : ` Balance $${formatAmount(balance)}.`
}

export async function notifyArrivals(arrivals: Arrival[]): Promise<void> {
  if (!arrivalTextsReady()) return
  const incoming = arrivals.filter(
    (a) => a.amount >= MIN_AMOUNT && a.fromAddress.toLowerCase() !== a.toAddress.toLowerCase(),
  )
  if (!incoming.length) return
  const to = [...new Set(incoming.map((a) => a.toAddress.toLowerCase()))]
  const from = [...new Set(incoming.map((a) => a.fromAddress.toLowerCase()))]
  const [pockets, phones, sendingPockets] = await Promise.all([
    db.query.ussdPockets.findMany({
      where: and(
        inArray(schema.ussdPockets.pocketAddress, to),
        eq(schema.ussdPockets.status, 'active'),
      ),
    }),
    db.query.phoneAccounts.findMany({
      where: and(
        inArray(schema.phoneAccounts.wallet, to),
        eq(schema.phoneAccounts.network, config.KOVA_NETWORK),
        isNotNull(schema.phoneAccounts.verifiedAt),
      ),
    }),
    db.query.ussdPockets.findMany({ where: inArray(schema.ussdPockets.pocketAddress, from) }),
  ])
  const fromPocket = new Set(sendingPockets.map((p) => p.pocketAddress.toLowerCase()))
  for (const a of incoming) {
    if (fromPocket.has(a.fromAddress.toLowerCase())) continue
    const amount = `$${formatAmount(a.amount)}`
    const pocket = pockets.find((p) => p.pocketAddress.toLowerCase() === a.toAddress.toLowerCase())
    if (pocket) {
      const dial = config.KOVA_USSD_CODE ? ` Dial ${config.KOVA_USSD_CODE} to use it.` : ''
      sendSmsLater(
        pocket.phone,
        `${prefix()}: ${amount} arrived in your USSD pocket.${await balanceText(a.tokenAddress, pocket.pocketAddress)}${dial}`,
      )
      continue
    }
    const account = phones.find((p) => p.wallet?.toLowerCase() === a.toAddress.toLowerCase())
    if (account)
      sendSmsLater(account.phone, `${prefix()}: you received ${amount} in your Kova wallet.`)
  }
}
