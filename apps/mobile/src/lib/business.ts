import { explorerTxUrl, generateStealthPayment, parseAmount } from '@kova/monad'
import { type Address, getAddress, type Hash, type LocalAccount } from 'viem'
import {
  type PayrollPayment,
  type PayrollRun,
  recordSupplierPayment,
  reportPayrollPayment,
  type Supplier,
  type SupplierPayment,
} from './api'
import { sendMoney } from './chain'
import { network } from './config'
import { fetchReceivingKey } from './private-core'
import { spend } from './session'

/**
 * Kova for Business on the phone: the owner's wallet paying the payroll and the suppliers the
 * shop keeps in its book (apps/api src/routes/business.ts).
 *
 * A payroll is approved once: Face ID opens the wallet for the whole run, and each person's pay is
 * signed here and sent privately, to a one-time address made from their own private-receiving key
 * (checked against their wallet's signature), with a sealed note saying who paid and why. Kova
 * relays each one, pays the gas, and checks it on Monad before the book calls it paid.
 */

export type Reach = 'checking' | 'private' | 'none'

/** Whether each wallet can be paid privately: a private-receiving key its own wallet signed. */
export async function reachOf(wallets: string[]): Promise<Record<string, Reach>> {
  const found = await Promise.all(
    wallets.map(
      async (w) =>
        [
          w.toLowerCase(),
          (await fetchReceivingKey(getAddress(w)).catch(() => null)) ? 'private' : 'none',
        ] as const,
    ),
  )
  return Object.fromEntries(found)
}

export type LineState =
  | { state: 'waiting' }
  | { state: 'paying' }
  | { state: 'paid'; ms: number; explorer: string }
  | { state: 'failed'; why: string }

const why = (error: unknown) =>
  error instanceof Error && error.message ? error.message : 'It didn’t go through.'

/** Pays a payroll Kova has just written into the book: one approval, then each person privately. */
export async function payPayroll(options: {
  approve: (amount: bigint) => Promise<LocalAccount>
  business: string
  run: PayrollRun
  wallets: Record<string, string>
  onLine: (payment: string, state: LineState) => void
}): Promise<void> {
  const { approve, business, run, wallets, onLine } = options
  const queue = run.payments.filter((p) => p.status === 'pending')
  const total = queue.reduce((sum, p) => sum + parseAmount(p.amount), 0n)
  const account = await approve(total)
  let paid = 0n
  const work = async (p: PayrollPayment) => {
    onLine(p.id, { state: 'paying' })
    try {
      const wallet = wallets[p.id]
      if (!wallet) throw new Error('No wallet for them in the book.')
      const meta = await fetchReceivingKey(getAddress(wallet))
      if (!meta)
        throw new Error(
          `${p.name.split(' ')[0]} can’t receive privately yet: they open Kova once to turn it on.`,
        )
      const made = generateStealthPayment(meta, {
        from: account.address,
        name: business,
        note: run.label,
        kind: 'send',
      })
      const sent = await sendMoney(account, made.stealthAddress, parseAmount(p.amount), undefined, {
        ephemeralPublicKey: made.ephemeralPublicKey,
        viewTag: made.viewTag,
        sealed: made.sealed,
      })
      await reportPayrollPayment(run.id, p.id, {
        stealth_address: made.stealthAddress,
        tx_hash: sent.hash,
      })
      paid += parseAmount(p.amount)
      onLine(p.id, {
        state: 'paid',
        ms: sent.ms,
        explorer: explorerTxUrl(network, sent.hash as Hash),
      })
    } catch (error) {
      await reportPayrollPayment(run.id, p.id, { failure: why(error).slice(0, 300) }).catch(
        () => {},
      )
      onLine(p.id, { state: 'failed', why: why(error) })
    }
  }
  for (let i = 0; i < queue.length; i += 2) await Promise.all(queue.slice(i, i + 2).map(work))
  if (paid > 0n) spend(paid)
}

/** Pays a supplier from the wallet, then writes it into the book once Monad shows it. */
export async function paySupplier(options: {
  approve: (amount: bigint) => Promise<LocalAccount>
  supplier: Supplier
  amount: string
  note?: string
}): Promise<{ payment: SupplierPayment; ms: number }> {
  const { approve, supplier, amount, note } = options
  const value = parseAmount(amount)
  const account = await approve(value)
  const sent = await sendMoney(account, getAddress(supplier.wallet_address) as Address, value)
  spend(value)
  const payment = await recordSupplierPayment(supplier.id, {
    amount,
    tx_hash: sent.hash,
    note: note || null,
  })
  return { payment, ms: sent.ms }
}

export const usd = (value: string | number) =>
  `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`

export const amountOk = (value: string) =>
  /^\d{1,6}(\.\d{1,2})?$/.test(value.trim()) && Number(value) > 0

export const monthName = () => new Date().toLocaleDateString('en-GB', { month: 'long' })

export const whenLabel = (at: string) =>
  new Date(at).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
