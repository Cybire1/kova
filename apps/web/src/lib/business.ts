import { type NetworkId, parseAmount } from '@kova/monad'
import { type Address, getAddress, isAddressEqual } from 'viem'
import type { LocalAccount } from 'viem/accounts'
import { openWalletSigner } from '@/lib/wallet/signer'
import { sendMoney } from '@/lib/wallet/chain'
import { fetchPrivateKey, privatePayment } from '@/lib/wallet/private'
import { sessionAccount, spend } from '@/lib/wallet/session'
import type { WebWallet } from '@/lib/wallet/takings'

/**
 * Kova for Business in the browser: the payroll book, suppliers and the team, as the API keeps
 * them (apps/api src/routes/business.ts), and the owner's wallet paying them.
 *
 * The owner's passkey opens the wallet once for a whole payroll: every person's pay is signed in
 * this tab and handed to Kova, which relays it and pays the gas. Each one goes privately, to a
 * one-time address made from that person's own private-receiving key (checked against their
 * wallet's signature, so Kova can't swap in its own), with a sealed note that says who paid and
 * why. Monad shows the business paying addresses nobody can tie to its people.
 */

export interface Business {
  name: string
  owner_address: string | null
  settlement_address: string
  month_starts: string
  payroll: {
    paid_this_month: string
    payments_this_month: number
    runs_this_month: number
    people: number
  }
  suppliers: {
    paid_this_month: string
    paid_today: string
    payments_this_month: number
    count: number
  }
}

export interface Person {
  id: string
  name: string
  wallet_address: string
  amount: string | null
}

export interface PayrollPayment {
  id: string
  person: string | null
  name: string
  amount: string
  status: 'pending' | 'paid' | 'failed'
  stealth_address: string | null
  tx_hash: string | null
  explorer_url: string | null
  failure: string | null
  paid_at: string | null
}

export interface PayrollRun {
  id: string
  label: string
  total: string
  paid_total: string
  people: number
  paid: number
  failed: number
  status: 'paying' | 'paid' | 'partial'
  created_at: string
  payments: PayrollPayment[]
}

export interface Supplier {
  id: string
  name: string
  wallet_address: string
  country: string | null
  currency: string
  paid_total: string
  payments: number
  last_paid_at: string | null
}

export interface SupplierPayment {
  id: string
  supplier: string
  supplier_name?: string
  amount: string
  note: string | null
  tx_hash: string
  explorer_url: string
  paid_at: string
}

/** One key that can spend the business's dollars, as the Keys screen made it. */
export interface TeamKey {
  id: string
  kind: string
  name: string
  daily_limit: string | null
  spent_today: string | null
  frozen: boolean
  ends_at: string | null
  created_at: string
}

export interface Team {
  /** False when this server has no keys yet: the Team view says so instead of an empty list. */
  available: boolean
  data: TeamKey[]
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/business${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    cache: 'no-store',
  })
  const body = (await response.json().catch(() => ({}))) as { error?: string } & T
  if (!response.ok) throw new Error(body.error || `Kova didn’t answer (${response.status}).`)
  return body
}

export const businessApi = {
  summary: () => call<Business>(''),
  people: () => call<{ data: Person[] }>('/people').then((r) => r.data),
  addPerson: (person: { name: string; wallet_address: string; amount?: string | null }) =>
    call<Person>('/people', { method: 'POST', body: JSON.stringify(person) }),
  removePerson: (id: string) => call<{ deleted: true }>(`/people/${id}`, { method: 'DELETE' }),
  runs: () => call<{ data: PayrollRun[] }>('/payroll').then((r) => r.data),
  run: (id: string) => call<PayrollRun>(`/payroll/${id}`),
  startRun: (label: string, payments: { person: string | null; name: string; amount: string }[]) =>
    call<PayrollRun>('/payroll', { method: 'POST', body: JSON.stringify({ label, payments }) }),
  reportPaid: (
    run: string,
    payment: string,
    result: { stealth_address: string; tx_hash: string } | { failure: string },
  ) =>
    call<PayrollPayment>(`/payroll/${run}/payments/${payment}`, {
      method: 'POST',
      body: JSON.stringify(result),
    }),
  suppliers: () => call<{ data: Supplier[] }>('/suppliers').then((r) => r.data),
  addSupplier: (supplier: {
    name: string
    wallet_address: string
    country?: string | null
    currency: string
  }) => call<Supplier>('/suppliers', { method: 'POST', body: JSON.stringify(supplier) }),
  removeSupplier: (id: string) => call<{ deleted: true }>(`/suppliers/${id}`, { method: 'DELETE' }),
  supplierPayments: (supplier?: string) =>
    call<{ data: SupplierPayment[] }>(
      `/supplier_payments${supplier ? `?supplier=${supplier}` : ''}`,
    ).then((r) => r.data),
  recordSupplierPayment: (
    supplier: string,
    payment: { amount: string; tx_hash: string; note?: string | null },
  ) =>
    call<SupplierPayment>(`/suppliers/${supplier}/payments`, {
      method: 'POST',
      body: JSON.stringify(payment),
    }),
  team: () => call<Team>('/team'),
}

/** Whether each wallet can be paid privately: its own signed private-receiving key, or none. */
export type Reach = 'checking' | 'private' | 'none'

export async function reachOf(wallets: string[]): Promise<Record<string, Reach>> {
  const entries = await Promise.all(
    wallets.map(async (w) => {
      const meta = await fetchPrivateKey(getAddress(w)).catch(() => null)
      return [w.toLowerCase(), meta ? 'private' : 'none'] as const
    }),
  )
  return Object.fromEntries(entries)
}

/**
 * The owner's wallet, opened for one job worth `amount`: a session this tab already has, when its
 * limits cover that much (and the spend is counted against it), or the passkey asked once. `done`
 * ends what this opened, which zeroes the key.
 */
async function openOwner(
  owner: WebWallet,
  amount: bigint,
): Promise<{ account: LocalAccount; done: (spent: bigint) => void }> {
  const open = sessionAccount(amount)
  if (open && isAddressEqual(open.address, getAddress(owner.address)))
    return { account: open, done: (spent) => spent > 0n && spend(spent) }
  const { session, account } = await openWalletSigner(owner)
  if (!isAddressEqual(account.address, getAddress(owner.address))) {
    session.end()
    throw new Error(
      'That passkey opens a different Kova wallet. Choose the one this business belongs to.',
    )
  }
  return { account, done: () => session.end() }
}

export type LineState =
  | { state: 'waiting' }
  | { state: 'paying' }
  | { state: 'paid'; ms: number; explorer: string }
  | { state: 'failed'; why: string }

/**
 * Pays a payroll that Kova has just written into the book: one passkey for everyone, then each
 * person's pay signed here and sent privately, two at a time, each reported back as it lands.
 */
export async function payPayroll(options: {
  owner: WebWallet
  network: NetworkId
  business: string
  run: PayrollRun
  wallets: Record<string, string>
  onLine: (payment: string, state: LineState) => void
}): Promise<void> {
  const { owner, network, business, run, wallets, onLine } = options
  const queue = run.payments.filter((p) => p.status === 'pending')
  const { account, done } = await openOwner(
    owner,
    queue.reduce((sum, p) => sum + parseAmount(p.amount), 0n),
  )
  let paid = 0n
  try {
    const work = async (p: PayrollPayment) => {
      onLine(p.id, { state: 'paying' })
      try {
        const wallet = wallets[p.id]
        if (!wallet) throw new Error('No wallet for them in the book.')
        const meta = await fetchPrivateKey(getAddress(wallet))
        if (!meta)
          throw new Error(
            `${p.name.split(' ')[0]} can’t receive privately yet: they open Kova once to turn it on.`,
          )
        // Who paid and why, sealed so only their viewing key opens it.
        const made = privatePayment(meta, {
          from: account.address,
          name: business,
          note: run.label,
          kind: 'send',
        })
        const moved = await sendMoney(
          network,
          account,
          made.address,
          parseAmount(p.amount),
          undefined,
          made.announcement,
        )
        await businessApi.reportPaid(run.id, p.id, {
          stealth_address: made.address,
          tx_hash: moved.hash,
        })
        paid += parseAmount(p.amount)
        onLine(p.id, { state: 'paid', ms: moved.ms, explorer: moved.explorer })
      } catch (error) {
        const why =
          error instanceof Error && error.message ? error.message : 'It didn’t go through.'
        await businessApi.reportPaid(run.id, p.id, { failure: why.slice(0, 300) }).catch(() => {})
        onLine(p.id, { state: 'failed', why })
      }
    }
    for (let i = 0; i < queue.length; i += 2) await Promise.all(queue.slice(i, i + 2).map(work))
  } finally {
    done(paid)
  }
}

/** Pays a supplier from the owner's wallet, then writes it into the book once Monad shows it. */
export async function paySupplier(options: {
  owner: WebWallet
  network: NetworkId
  supplier: Supplier
  amount: string
  note?: string
}): Promise<{ payment: SupplierPayment; ms: number }> {
  const { owner, network, supplier, amount, note } = options
  const value = parseAmount(amount)
  const { account, done } = await openOwner(owner, value)
  let spent = 0n
  try {
    const moved = await sendMoney(
      network,
      account,
      getAddress(supplier.wallet_address as Address),
      value,
    )
    spent = value
    const payment = await businessApi.recordSupplierPayment(supplier.id, {
      amount,
      tx_hash: moved.hash,
      note: note || null,
    })
    return { payment, ms: moved.ms }
  } finally {
    done(spent)
  }
}
