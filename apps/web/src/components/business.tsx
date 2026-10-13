'use client'

import type { NetworkId } from '@kova/monad'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { isAddress } from 'viem'
import {
  type Business,
  businessApi,
  type LineState,
  type PayrollRun,
  type Person,
  payPayroll,
  paySupplier,
  type Reach,
  reachOf,
  type Supplier,
  type SupplierPayment,
  type Team,
} from '@/lib/business'
import { passkeyDomain, passkeyHome } from '@/lib/passkey'
import {
  displayCurrencies,
  formatLocal,
  isDisplayCurrency,
  type LiveRates,
  ratesFrom,
} from '@/lib/wallet/money'
import { rememberedWallet, type WebWallet } from '@/lib/wallet/takings'
import { Art, Icon } from './brand'
import { PageHead } from './shell'

// --- Small things ----------------------------------------------------------------------------------

const usd = (value: string | number) =>
  `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`

const sum = (values: string[]) => values.reduce((total, v) => total + (Number(v) || 0), 0)

const whenLabel = (at: string) =>
  new Date(at).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

const monthName = () => new Date().toLocaleDateString('en-GB', { month: 'long' })

const amountOk = (value: string) => /^\d{1,6}(\.\d{1,2})?$/.test(value.trim()) && Number(value) > 0

const initial = (name: string) => name.trim().charAt(0).toUpperCase() || '·'

const problemText = (error: unknown) =>
  error instanceof Error && error.message ? error.message : 'That didn’t work. Try again.'

export interface BusinessShop {
  name: string
  owner: string | null
  settlement: string
  network: NetworkId
}

/**
 * The wallet that can pay for this business in this browser, or why it can't: passkeys only open
 * on Kova's own domain, and only the owner's wallet pays.
 */
function useOwner(shop: BusinessShop) {
  const [wallet, setWallet] = useState<WebWallet | null>(null)
  const [home, setHome] = useState(true)
  useEffect(() => {
    setWallet(rememberedWallet())
    setHome(passkeyHome())
  }, [])
  const payer = shop.owner ?? shop.settlement
  const mine = Boolean(wallet && wallet.address.toLowerCase() === payer.toLowerCase())
  const blocked = !home
    ? `Paying from the dashboard works on ${passkeyDomain}, where your passkey lives.`
    : !wallet
      ? 'Open your Kova wallet in this browser first: it’s the wallet that pays.'
      : !mine
        ? `This browser’s wallet (${short(wallet.address)}) isn’t the one that owns ${shop.name}.`
        : null
  return { wallet: mine ? wallet : null, blocked }
}

function Problem({ text }: { text: string | null }) {
  if (!text) return null
  return (
    <p className="biz-problem" role="alert">
      <Icon name="info" size={18} />
      <span>{text}</span>
    </p>
  )
}

// --- Business home ---------------------------------------------------------------------------------

export function BusinessHome({ summary, team }: { summary: Business; team: Team | null }) {
  const payroll = Number(summary.payroll.paid_this_month)
  const suppliers = Number(summary.suppliers.paid_this_month)
  const teamToday = sum((team?.data ?? []).map((k) => k.spent_today ?? '0'))
  const members = team?.data.length ?? 0
  return (
    <div className="biz">
      <section className="biz-hero">
        <div className="biz-hero-text">
          <p className="biz-hero-label">Paid out in {monthName()}</p>
          <p className="biz-hero-amount">{usd(payroll + suppliers)}</p>
          <p className="biz-hero-sub">
            {usd(payroll)} in payroll, paid privately · {usd(suppliers)} to suppliers
          </p>
        </div>
        <Art name="kovi-key" size={150} className="biz-hero-kovi" />
      </section>

      <div className="biz-tiles">
        <Link href="/dashboard/business/payroll" className="biz-tile">
          <span className="biz-tile-icon biz-tile-teal">
            <Icon name="lock" size={20} />
          </span>
          <strong>Payroll</strong>
          <span className="biz-tile-amount">{usd(payroll)}</span>
          <small>
            paid privately this month · {summary.payroll.people}{' '}
            {summary.payroll.people === 1 ? 'person' : 'people'}
          </small>
          <span className="biz-tile-go">
            Run payroll <Icon name="chevron" size={16} />
          </span>
        </Link>
        <Link href="/dashboard/business/suppliers" className="biz-tile">
          <span className="biz-tile-icon biz-tile-coral">
            <Icon name="globe" size={20} />
          </span>
          <strong>Suppliers</strong>
          <span className="biz-tile-amount">{usd(suppliers)}</span>
          <small>
            paid this month · {summary.suppliers.count}{' '}
            {summary.suppliers.count === 1 ? 'supplier' : 'suppliers'}
          </small>
          <span className="biz-tile-go">
            Pay a supplier <Icon name="chevron" size={16} />
          </span>
        </Link>
        <Link href="/dashboard/business/team" className="biz-tile">
          <span className="biz-tile-icon">
            <Icon name="key" size={20} />
          </span>
          <strong>Team</strong>
          <span className="biz-tile-amount">{usd(teamToday)}</span>
          <small>
            spent today · {members} {members === 1 ? 'key' : 'keys'}
          </small>
          <span className="biz-tile-go">
            See your team <Icon name="chevron" size={16} />
          </span>
        </Link>
      </div>

      <section className="card biz-how">
        <h2>How payroll stays private</h2>
        <ol>
          <li>
            <strong>Each person’s pay goes to an address made for that payment alone,</strong> from
            their own private-receiving key.
          </li>
          <li>
            <strong>
              Monad shows the business paying addresses nobody can tie to your people.
            </strong>{' '}
            Salaries aren’t public.
          </li>
          <li>
            <strong>They find it with their own keys,</strong> with a sealed note that says it’s
            from {summary.name}.
          </li>
        </ol>
      </section>
    </div>
  )
}

// --- Payroll -----------------------------------------------------------------------------------------

function ReachChip({ reach }: { reach: Reach | undefined }) {
  if (!reach || reach === 'checking') return <span className="biz-reach">Checking…</span>
  if (reach === 'private')
    return (
      <span className="biz-reach biz-reach-ok">
        <Icon name="lock" size={13} /> Private
      </span>
    )
  return <span className="biz-reach biz-reach-no">Can’t receive privately yet</span>
}

function LineIcon({ line }: { line: LineState | undefined }) {
  if (!line || line.state === 'waiting') return <span className="biz-line-icon">·</span>
  if (line.state === 'paying') return <span className="spinner biz-line-spin" role="img" aria-label="Paying" />
  if (line.state === 'paid')
    return (
      <span className="biz-line-icon biz-line-paid">
        <Icon name="check" size={16} />
      </span>
    )
  return (
    <span className="biz-line-icon biz-line-failed">
      <Icon name="close" size={16} />
    </span>
  )
}

export function PayrollPanel({
  shop,
  initialPeople,
  initialRuns,
}: {
  shop: BusinessShop
  initialPeople: Person[]
  initialRuns: PayrollRun[]
}) {
  const router = useRouter()
  const owner = useOwner(shop)
  const [people, setPeople] = useState(initialPeople)
  const [runs, setRuns] = useState(initialRuns)
  const [reach, setReach] = useState<Record<string, Reach>>({})
  const [label, setLabel] = useState(`${monthName()} salary`)
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialPeople.map((p) => [p.id, p.amount ?? ''])),
  )
  const [left, setLeft] = useState<Record<string, boolean>>({})
  const [adding, setAdding] = useState(initialPeople.length === 0)
  const [draft, setDraft] = useState({ name: '', wallet: '', amount: '' })
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [paying, setPaying] = useState<{
    run: PayrollRun
    lines: Record<string, LineState>
  } | null>(null)

  useEffect(() => {
    if (!people.length) return
    setReach((r) => ({
      ...Object.fromEntries(
        people.map((p) => [p.wallet_address.toLowerCase(), 'checking' as Reach]),
      ),
      ...r,
    }))
    void reachOf(people.map((p) => p.wallet_address)).then((found) =>
      setReach((r) => ({ ...r, ...found })),
    )
  }, [people])

  const reachFor = (p: Person) => reach[p.wallet_address.toLowerCase()]
  const included = people.filter(
    (p) => !left[p.id] && reachFor(p) === 'private' && amountOk(amounts[p.id] ?? ''),
  )
  const total = sum(included.map((p) => amounts[p.id] ?? '0'))
  const waiting = people.some((p) => reachFor(p) === 'checking' || !reachFor(p))

  const addPerson = async () => {
    setProblem(null)
    if (!draft.name.trim()) return setProblem('Who is it? Add their name.')
    if (!isAddress(draft.wallet.trim()))
      return setProblem(
        'That wallet address isn’t right: it starts with 0x and has 40 more characters.',
      )
    if (draft.amount && !amountOk(draft.amount))
      return setProblem('Their usual pay is in dollars, like 250 or 12.50.')
    setBusy(true)
    try {
      const added = await businessApi.addPerson({
        name: draft.name.trim(),
        wallet_address: draft.wallet.trim(),
        amount: draft.amount || null,
      })
      setPeople((list) =>
        [...list.filter((p) => p.id !== added.id), added].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      )
      setAmounts((a) => ({ ...a, [added.id]: added.amount ?? '' }))
      setDraft({ name: '', wallet: '', amount: '' })
      setAdding(false)
    } catch (error) {
      setProblem(problemText(error))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (p: Person) => {
    setProblem(null)
    try {
      await businessApi.removePerson(p.id)
      setPeople((list) => list.filter((x) => x.id !== p.id))
    } catch (error) {
      setProblem(problemText(error))
    }
  }

  const pay = async () => {
    if (!owner.wallet || !included.length) return
    setProblem(null)
    setBusy(true)
    try {
      const run = await businessApi.startRun(
        label.trim() || `${monthName()} salary`,
        included.map((p) => ({
          person: p.id,
          name: p.name,
          amount: Number(amounts[p.id]).toFixed(2),
        })),
      )
      const wallets: Record<string, string> = {}
      run.payments.forEach((payment) => {
        const who = included.find((p) => p.id === payment.person)
        if (who) wallets[payment.id] = who.wallet_address
      })
      setPaying({
        run,
        lines: Object.fromEntries(
          run.payments.map((p) => [p.id, { state: 'waiting' } as LineState]),
        ),
      })
      await payPayroll({
        owner: owner.wallet,
        network: shop.network,
        business: shop.name,
        run,
        wallets,
        onLine: (id, state) =>
          setPaying((now) => (now ? { ...now, lines: { ...now.lines, [id]: state } } : now)),
      })
      setRuns(await businessApi.runs())
      router.refresh()
    } catch (error) {
      setProblem(problemText(error))
    } finally {
      setBusy(false)
    }
  }

  const lines = paying ? Object.values(paying.lines) : []
  const paidCount = lines.filter((l) => l.state === 'paid').length
  const done = paying && lines.every((l) => l.state === 'paid' || l.state === 'failed')

  return (
    <>
      <PageHead
        title="Payroll"
        sub="Everyone paid with one Face ID, privately: Monad never shows who you pay."
      >
        <Link href="/dashboard/business" className="mini">
          Business
        </Link>
      </PageHead>
      <div className="biz-cols">
        <section className="card biz-run">
          <div className="card-head">
            <h2>New payroll</h2>
            <p>
              {included.length} {included.length === 1 ? 'person' : 'people'} ·{' '}
              <strong>{usd(total)}</strong>
            </p>
          </div>

          <label className="biz-field">
            <span>What it’s for</span>
            <input
              value={label}
              maxLength={60}
              onChange={(e) => setLabel(e.target.value)}
              disabled={busy}
            />
            <small>It travels sealed with each payment, so they see why they were paid.</small>
          </label>

          {people.length ? (
            <ul className="biz-people">
              {people.map((p) => {
                const r = reachFor(p)
                const on = !left[p.id] && r === 'private'
                return (
                  <li key={p.id} className="biz-person" data-off={on ? undefined : 'true'}>
                    <input
                      type="checkbox"
                      aria-label={`Pay ${p.name}`}
                      checked={on}
                      disabled={busy || r !== 'private'}
                      onChange={(e) => setLeft((l) => ({ ...l, [p.id]: !e.target.checked }))}
                    />
                    <span className="biz-avatar">{initial(p.name)}</span>
                    <span className="biz-person-name">
                      <strong>{p.name}</strong>
                      <small>
                        {short(p.wallet_address)} · <ReachChip reach={r} />
                      </small>
                    </span>
                    <label className="biz-amount">
                      <span>$</span>
                      <input
                        inputMode="decimal"
                        aria-label={`${p.name}’s pay`}
                        value={amounts[p.id] ?? ''}
                        placeholder="0.00"
                        disabled={busy}
                        onChange={(e) =>
                          setAmounts((a) => ({
                            ...a,
                            [p.id]: e.target.value.replace(/[^\d.]/g, ''),
                          }))
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="round biz-remove"
                      aria-label={`Remove ${p.name}`}
                      disabled={busy}
                      onClick={() => void remove(p)}
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : null}

          {adding ? (
            <div className="biz-add">
              <input
                placeholder="Their name"
                value={draft.name}
                maxLength={60}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
              <input
                placeholder="Their Kova wallet (0x…)"
                value={draft.wallet}
                spellCheck={false}
                onChange={(e) => setDraft({ ...draft, wallet: e.target.value.trim() })}
              />
              <input
                placeholder="Usual pay ($)"
                inputMode="decimal"
                value={draft.amount}
                onChange={(e) =>
                  setDraft({ ...draft, amount: e.target.value.replace(/[^\d.]/g, '') })
                }
              />
              <div className="biz-add-actions">
                <button
                  type="button"
                  className="mini mini-ink"
                  disabled={busy}
                  onClick={() => void addPerson()}
                >
                  Add to payroll
                </button>
                {people.length ? (
                  <button type="button" className="mini" onClick={() => setAdding(false)}>
                    Cancel
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="biz-add-open"
              onClick={() => setAdding(true)}
              disabled={busy}
            >
              <Icon name="plus" size={18} /> Add someone you pay
            </button>
          )}

          <Problem text={problem ?? owner.blocked} />

          <div className="biz-run-foot">
            <p>
              {waiting
                ? 'Checking who can be paid privately…'
                : people.some((p) => reachFor(p) === 'none')
                  ? 'People who can’t receive privately yet open Kova once to turn it on.'
                  : 'One Face ID approves everyone. Kova pays the gas.'}
            </p>
            <button
              type="button"
              className="pill"
              data-tone="coral"
              disabled={busy || !owner.wallet || included.length === 0}
              onClick={() => void pay()}
            >
              <span className="pill-label">
                {busy && paying
                  ? `Paying ${paidCount} of ${lines.length}…`
                  : `Pay ${included.length || ''} privately · ${usd(total)}`}
              </span>
              <span className="pill-cap">
                <Icon name="lock" size={18} />
              </span>
            </button>
          </div>

          {paying ? (
            <div className="biz-progress" aria-live="polite">
              <p className="biz-progress-head">
                {done
                  ? `${paidCount} of ${lines.length} paid privately`
                  : `Paying ${paying.run.label}…`}
                {done ? (
                  <Link href={`/dashboard/business/payroll/${paying.run.id}`} className="biz-link">
                    See the receipt <Icon name="chevron" size={14} />
                  </Link>
                ) : null}
              </p>
              <ul>
                {paying.run.payments.map((p) => {
                  const line = paying.lines[p.id]
                  return (
                    <li key={p.id} className="biz-line" data-state={line?.state ?? 'waiting'}>
                      <LineIcon line={line} />
                      <span className="biz-line-name">
                        {p.name}
                        {line?.state === 'failed' ? <small>{line.why}</small> : null}
                        {line?.state === 'paid' ? (
                          <small>Paid privately in {(line.ms / 1000).toFixed(2)} s</small>
                        ) : null}
                      </span>
                      <span className="biz-line-amount">{usd(p.amount)}</span>
                      {line?.state === 'paid' ? (
                        <a
                          href={line.explorer}
                          target="_blank"
                          rel="noreferrer"
                          className="biz-link"
                        >
                          Monadscan
                        </a>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : null}
        </section>

        <aside className="biz-side">
          <section className="card biz-history">
            <div className="card-head">
              <h2>Past payrolls</h2>
            </div>
            {runs.length ? (
              <ul>
                {runs.map((r) => (
                  <li key={r.id}>
                    <Link href={`/dashboard/business/payroll/${r.id}`} className="biz-history-row">
                      <span>
                        <strong>{r.label}</strong>
                        <small>
                          {whenLabel(r.created_at)} · {r.paid} of {r.people} paid
                        </small>
                      </span>
                      <span className="biz-history-amount">{usd(r.paid_total)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="biz-empty">
                Your first payroll shows up here, with a receipt for each person.
              </p>
            )}
          </section>
          <section className="card biz-how biz-how-small">
            <h2>What Monad sees</h2>
            <p>
              The business paying addresses made for one payment each. Not your people, not who got
              what. Each person finds their pay with their own keys.
            </p>
          </section>
        </aside>
      </div>
    </>
  )
}

export function RunReceipt({ run, business }: { run: PayrollRun; business: string }) {
  return (
    <>
      <PageHead title={run.label} sub={`${business} · ${whenLabel(run.created_at)}`}>
        <Link href="/dashboard/business/payroll" className="mini">
          Payroll
        </Link>
      </PageHead>
      <div className="biz-cols">
        <section className="card biz-receipt">
          <div className="biz-receipt-total">
            <p>Paid privately</p>
            <strong>{usd(run.paid_total)}</strong>
            <small>
              {run.paid} of {run.people} {run.people === 1 ? 'person' : 'people'}
              {run.failed ? ` · ${run.failed} didn’t go through` : ''}
            </small>
          </div>
          <ul className="biz-receipt-list">
            {run.payments.map((p) => (
              <li key={p.id} className="biz-line" data-state={p.status}>
                <span
                  className={`biz-line-icon ${p.status === 'paid' ? 'biz-line-paid' : p.status === 'failed' ? 'biz-line-failed' : ''}`}
                >
                  <Icon
                    name={p.status === 'paid' ? 'check' : p.status === 'failed' ? 'close' : 'clock'}
                    size={16}
                  />
                </span>
                <span className="biz-line-name">
                  {p.name}
                  <small>
                    {p.status === 'paid' && p.stealth_address
                      ? `To one-time address ${short(p.stealth_address)}`
                      : p.status === 'failed'
                        ? (p.failure ?? 'Didn’t go through')
                        : 'Waiting'}
                  </small>
                </span>
                <span className="biz-line-amount">{usd(p.amount)}</span>
                {p.explorer_url ? (
                  <a href={p.explorer_url} target="_blank" rel="noreferrer" className="biz-link">
                    Monadscan
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
        <aside className="biz-side">
          <section className="card biz-how biz-how-small">
            <h2>Only you see the names</h2>
            <p>
              Monad shows {business} paying the one-time addresses on the left. Who they belong to
              is in this book, and in each person’s own wallet, nowhere else.
            </p>
          </section>
        </aside>
      </div>
    </>
  )
}

// --- Suppliers -------------------------------------------------------------------------------------

export function SuppliersPanel({
  shop,
  initialSuppliers,
  initialPayments,
  live,
}: {
  shop: BusinessShop
  initialSuppliers: Supplier[]
  initialPayments: SupplierPayment[]
  live: LiveRates | null
}) {
  const router = useRouter()
  const owner = useOwner(shop)
  const rates = useMemo(() => ratesFrom(live), [live])
  const [suppliers, setSuppliers] = useState(initialSuppliers)
  const [payments, setPayments] = useState(initialPayments)
  const [adding, setAdding] = useState(initialSuppliers.length === 0)
  const [draft, setDraft] = useState({ name: '', wallet: '', country: '', currency: 'USD' })
  const [open, setOpen] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [paid, setPaid] = useState<{
    supplier: string
    ms: number
    payment: SupplierPayment
  } | null>(null)

  const add = async () => {
    setProblem(null)
    if (!draft.name.trim()) return setProblem('Who is it? Add their name.')
    if (!isAddress(draft.wallet.trim()))
      return setProblem(
        'That wallet address isn’t right: it starts with 0x and has 40 more characters.',
      )
    setBusy(true)
    try {
      const added = await businessApi.addSupplier({
        name: draft.name.trim(),
        wallet_address: draft.wallet.trim(),
        country: draft.country.trim() || null,
        currency: draft.currency,
      })
      setSuppliers((list) =>
        [...list.filter((s) => s.id !== added.id), added].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      )
      setDraft({ name: '', wallet: '', country: '', currency: 'USD' })
      setAdding(false)
      setOpen(added.id)
    } catch (error) {
      setProblem(problemText(error))
    } finally {
      setBusy(false)
    }
  }

  const pay = async (supplier: Supplier) => {
    if (!owner.wallet) return
    setProblem(null)
    if (!amountOk(amount)) return setProblem('How much? In dollars, like 120 or 45.50.')
    setBusy(true)
    try {
      const result = await paySupplier({
        owner: owner.wallet,
        network: shop.network,
        supplier,
        amount: Number(amount).toFixed(2),
        note,
      })
      setPaid({ supplier: supplier.id, ms: result.ms, payment: result.payment })
      setPayments((list) => [result.payment, ...list])
      setSuppliers(await businessApi.suppliers())
      setAmount('')
      setNote('')
      router.refresh()
    } catch (error) {
      setProblem(problemText(error))
    } finally {
      setBusy(false)
    }
  }

  const theirs = (s: Supplier, value: string) =>
    isDisplayCurrency(s.currency) && s.currency !== 'USD' && Number(value) > 0
      ? formatLocal(Number(value), s.currency, rates)
      : null

  return (
    <>
      <PageHead
        title="Suppliers"
        sub="Pay anyone, anywhere, in seconds. They see it in their own currency."
      >
        <Link href="/dashboard/business" className="mini">
          Business
        </Link>
      </PageHead>
      <div className="biz-cols">
        <section className="card biz-suppliers">
          <div className="card-head">
            <h2>Your suppliers</h2>
            <button
              type="button"
              className="mini mini-ink"
              onClick={() => setAdding((a) => !a)}
              disabled={busy}
            >
              {adding ? 'Cancel' : 'Add a supplier'}
            </button>
          </div>

          {adding ? (
            <div className="biz-add">
              <input
                placeholder="Name, like Shenzhen Parts Co"
                value={draft.name}
                maxLength={80}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
              <input
                placeholder="Their wallet (0x…)"
                value={draft.wallet}
                spellCheck={false}
                onChange={(e) => setDraft({ ...draft, wallet: e.target.value.trim() })}
              />
              <input
                placeholder="Country"
                value={draft.country}
                maxLength={60}
                onChange={(e) => setDraft({ ...draft, country: e.target.value })}
              />
              <select
                value={draft.currency}
                onChange={(e) => setDraft({ ...draft, currency: e.target.value })}
                aria-label="Their currency"
              >
                {displayCurrencies.map((c) => (
                  <option key={c} value={c}>
                    Shown in {c}
                  </option>
                ))}
              </select>
              <div className="biz-add-actions">
                <button
                  type="button"
                  className="mini mini-ink"
                  disabled={busy}
                  onClick={() => void add()}
                >
                  Save supplier
                </button>
              </div>
            </div>
          ) : null}

          {suppliers.length ? (
            <ul className="biz-supplier-list">
              {suppliers.map((s) => {
                const expanded = open === s.id
                const local = theirs(s, amount)
                return (
                  <li key={s.id} className="biz-supplier" data-open={expanded ? 'true' : undefined}>
                    <div className="biz-supplier-row">
                      <span className="biz-avatar biz-avatar-coral">{initial(s.name)}</span>
                      <span className="biz-person-name">
                        <strong>{s.name}</strong>
                        <small>
                          {s.country ? `${s.country} · ` : ''}
                          {s.currency !== 'USD' ? `${s.currency} · ` : ''}
                          {s.payments
                            ? `${usd(s.paid_total)} over ${s.payments} ${s.payments === 1 ? 'payment' : 'payments'}`
                            : 'Not paid yet'}
                        </small>
                      </span>
                      <button
                        type="button"
                        className={expanded ? 'mini' : 'mini mini-ink'}
                        onClick={() => {
                          setOpen(expanded ? null : s.id)
                          setPaid(null)
                          setProblem(null)
                        }}
                      >
                        {expanded ? 'Close' : 'Pay'}
                      </button>
                    </div>
                    {expanded ? (
                      <div className="biz-pay">
                        <label className="biz-pay-amount">
                          <span>$</span>
                          <input
                            inputMode="decimal"
                            placeholder="0.00"
                            aria-label={`Amount for ${s.name}`}
                            value={amount}
                            disabled={busy}
                            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                          />
                        </label>
                        <p className="biz-pay-theirs">
                          {local ? (
                            <>
                              {s.name.split(' ')[0]} gets about <strong>{local}</strong>
                              <small>
                                {live?.source === 'chainlink'
                                  ? 'Chainlink rate on Monad'
                                  : 'Reference rate'}
                              </small>
                            </>
                          ) : (
                            <>To {short(s.wallet_address)}, in dollars on Monad</>
                          )}
                        </p>
                        <input
                          className="biz-pay-note"
                          placeholder="What it’s for (optional)"
                          value={note}
                          maxLength={140}
                          onChange={(e) => setNote(e.target.value)}
                        />
                        <button
                          type="button"
                          className="pill pill-wide"
                          data-tone="coral"
                          disabled={busy || !owner.wallet || !amountOk(amount)}
                          onClick={() => void pay(s)}
                        >
                          <span className="pill-label">
                            {busy ? 'Paying…' : `Pay ${amountOk(amount) ? usd(amount) : ''}`}
                          </span>
                          <span className="pill-cap">
                            <Icon name="send" size={18} />
                          </span>
                        </button>
                        {paid && paid.supplier === s.id ? (
                          <p className="biz-paid" role="status">
                            <Icon name="check" size={16} /> Paid {usd(paid.payment.amount)} in{' '}
                            {(paid.ms / 1000).toFixed(2)} s.{' '}
                            <a
                              href={paid.payment.explorer_url}
                              target="_blank"
                              rel="noreferrer"
                              className="biz-link"
                            >
                              Monadscan
                            </a>
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          ) : !adding ? (
            <p className="biz-empty">
              Add the people and companies you buy from. Paying them takes seconds, wherever they
              are.
            </p>
          ) : null}

          <Problem text={problem ?? (open ? owner.blocked : null)} />
        </section>

        <aside className="biz-side">
          <section className="card biz-history">
            <div className="card-head">
              <h2>Payments</h2>
            </div>
            {payments.length ? (
              <ul>
                {payments.map((p) => (
                  <li key={p.id}>
                    <a
                      href={p.explorer_url}
                      target="_blank"
                      rel="noreferrer"
                      className="biz-history-row"
                    >
                      <span>
                        <strong>{p.supplier_name ?? 'Supplier'}</strong>
                        <small>
                          {whenLabel(p.paid_at)}
                          {p.note ? ` · ${p.note}` : ''}
                        </small>
                      </span>
                      <span className="biz-history-amount">{usd(p.amount)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="biz-empty">Every payment to a supplier lands here, checked on Monad.</p>
            )}
          </section>
        </aside>
      </div>
    </>
  )
}

// --- Team ------------------------------------------------------------------------------------------

export function TeamPanel({ team }: { team: Team | null }) {
  const keys = team?.data ?? []
  return (
    <>
      <PageHead
        title="Team"
        sub="Everyone who can spend the business’s dollars, each within a limit Monad enforces."
      >
        <Link href="/dashboard/business" className="mini">
          Business
        </Link>
      </PageHead>
      {keys.length ? (
        <section className="card biz-team">
          <ul>
            {keys.map((k) => {
              const limit = Number(k.daily_limit ?? 0)
              const spent = Number(k.spent_today ?? 0)
              const share = limit > 0 ? Math.min(100, Math.round((spent / limit) * 100)) : 0
              return (
                <li key={k.id} className="biz-key" data-frozen={k.frozen ? 'true' : undefined}>
                  <span className="biz-avatar">{initial(k.name)}</span>
                  <span className="biz-person-name">
                    <strong>{k.name}</strong>
                    <small>
                      {limit ? `${usd(spent)} of ${usd(limit)} today` : `${usd(spent)} today`}
                      {k.ends_at
                        ? ` · until ${new Date(k.ends_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
                        : ''}
                    </small>
                    {limit ? (
                      <span className="biz-bar" aria-hidden="true">
                        <span style={{ width: `${share}%` }} />
                      </span>
                    ) : null}
                  </span>
                  <span className={`chip ${k.frozen ? 'biz-chip-frozen' : ''}`}>
                    <span className="dot" /> {k.frozen ? 'Frozen' : 'Active'}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      ) : (
        <section className="card biz-team-empty">
          <Art name="kovi-key" size={120} />
          <div>
            <h2>
              {team && !team.available
                ? 'Team keys aren’t on this server yet'
                : 'No one on the team yet'}
            </h2>
            <p>
              Give someone a key in Keys: a daily budget, who they may pay, and a freeze that works
              at once. They show up here with what they’ve spent today.
            </p>
            <Link href="/wallet/keys" className="pill" data-tone="light">
              <span className="pill-label">Add a team member in Keys</span>
              <span className="pill-cap">
                <Icon name="key" size={18} />
              </span>
            </Link>
          </div>
        </section>
      )}
    </>
  )
}
