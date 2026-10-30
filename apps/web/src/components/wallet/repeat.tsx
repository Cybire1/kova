'use client'

import { DAY, getNetwork, nadNameOf, REPEAT_EVERY, repeatEveryLabel } from '@kova/monad'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { type Address, getAddress, isAddressEqual } from 'viem'
import { Art, Icon, type IconName } from '@/components/brand'
import { applyKey, formatUsd, groupTyped, type Key, toBase } from '@/lib/wallet/money'
import {
  listRepeats,
  type RepeatPayment,
  type RepeatPhase,
  SwitchedOff,
  startRepeat,
  stopRepeat,
} from '@/lib/wallet/programs'
import '@/styles/programs.css'
import { ScreenHead } from './activity'
import { Steps } from './flow'
import { isUnnamed, short, useWallet } from './provider'
import { Who } from './send'
import { Avatar, Keypad } from './ui'

/**
 * Repeat payments: rent, school fees, a wage every Friday. The payer signs one plan (who, how
 * much, how often, from when, how many times at most) and a permit for the most it can ever take;
 * Kova collects each payment when it's due, never early and never more, and the payer can stop it
 * at any time. The person paid sees it too, under "Paying you".
 */

/** Each payment can be up to $10,000, and a plan can run at most 520 times (the API's limits). */
const MAX_EACH = 10_000_000_000n
const MAX_TIMES = 520

const cancelled = (message: string) => /cancel|not allowed|abort/i.test(message)
const problemOf = (e: unknown) =>
  e instanceof Error ? e.message : 'That didn’t go through. Try again.'

/** "Today", "Tomorrow", or "Fri 7 Nov" (with the year when it isn't this one). */
export function dayLabel(at: Date): string {
  const today = new Date()
  const tomorrow = new Date(today.getTime() + DAY * 1000)
  if (at.toDateString() === today.toDateString()) return 'Today'
  if (at.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  return at.toLocaleDateString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(at.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  })
}

/** dayLabel, inside a sentence: "today", "tomorrow", "Fri 7 Nov". */
export const dayIn = (at: Date) =>
  dayLabel(at).replace(/^(Today|Tomorrow)$/, (d) => d.toLowerCase())

/**
 * What to call each wallet: your name for them, else the .nad name they set on Monad, else the
 * short address. Names are looked up once each, as the list comes in.
 */
export function useNames(addresses: string[]) {
  const { contacts } = useWallet()
  const [nads, setNads] = useState<Record<string, string>>({})
  const key = [...new Set(addresses.map((a) => a.toLowerCase()))].sort().join(',')
  useEffect(() => {
    if (!key) return
    let live = true
    for (const address of key.split(',')) {
      const known = contacts.find((c) => c.address.toLowerCase() === address)
      if (known && !isUnnamed(known.name)) continue
      void nadNameOf(getAddress(address)).then(
        (name) =>
          live && name && setNads((all) => (all[address] ? all : { ...all, [address]: name })),
      )
    }
    return () => {
      live = false
    }
  }, [key, contacts])
  return useCallback(
    (address: string) => {
      const known = contacts.find((c) => c.address.toLowerCase() === address.toLowerCase())
      if (known && !isUnnamed(known.name)) return known.name
      return nads[address.toLowerCase()] ?? short(address)
    },
    [contacts, nads],
  )
}

type Loaded =
  | { state: 'loading' }
  | { state: 'off'; message: string }
  | { state: 'error'; problem: string }
  | { state: 'ready'; list: RepeatPayment[] }

/** This wallet's plans, both ways, kept fresh while the screen is open. */
function useRepeats() {
  const { profile } = useWallet()
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const address = profile?.address as Address | undefined
  const reload = useCallback(async () => {
    if (!address) return
    try {
      setLoaded({ state: 'ready', list: await listRepeats(address) })
    } catch (e) {
      if (e instanceof SwitchedOff) return setLoaded({ state: 'off', message: e.message })
      // A refresh that fails keeps what's on screen; only a first load shows the problem.
      setLoaded((now) => (now.state === 'ready' ? now : { state: 'error', problem: problemOf(e) }))
    }
  }, [address])
  useEffect(() => {
    void reload()
    const tick = () => document.visibilityState === 'visible' && void reload()
    const timer = setInterval(tick, 15_000)
    return () => clearInterval(timer)
  }, [reload])
  return { loaded, reload, setLoaded }
}

const amountOf = (plan: RepeatPayment) => toBase(plan.amount)
const nextOf = (plan: RepeatPayment) => (plan.next_at ? new Date(plan.next_at) : null)
const byNext = (a: RepeatPayment, b: RepeatPayment) =>
  (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) ||
  (nextOf(a)?.getTime() ?? Number.POSITIVE_INFINITY) -
    (nextOf(b)?.getTime() ?? Number.POSITIVE_INFINITY) ||
  b.created_at.localeCompare(a.created_at)

/** Kova isn't running repeat payments on this server yet: said plainly. */
function SwitchedOffNote() {
  return (
    <div className="w-empty w-empty-art">
      <Art name="kovi-sleep" size={112} />
      <strong>Repeat payments aren’t switched on yet</strong>
      <span>
        They’re coming to Kova soon: rent, school fees or a wage, paid by itself each time it’s due.
      </span>
    </div>
  )
}

export function RepeatScreen() {
  const { profile } = useWallet()
  const { loaded, reload } = useRepeats()
  const list = loaded.state === 'ready' ? loaded.list : []
  const name = useNames(list.map((p) => (p.role === 'paying' ? p.payee : p.payer)))
  if (!profile) return null

  const paying = list.filter((p) => p.role === 'paying').sort(byNext)
  const getting = list.filter((p) => p.role === 'getting').sort(byNext)
  const activeOut = paying.filter((p) => p.status === 'active')
  const activeIn = getting.filter((p) => p.status === 'active')
  const next = activeOut[0] ?? activeIn[0] ?? null

  return (
    <div className="w-screen">
      <ScreenHead title="Repeat payments" back="/wallet">
        {loaded.state === 'ready' && list.length ? (
          <Link href="/wallet/repeat/new" className="round" aria-label="New repeat payment">
            <Icon name="plus" size={18} />
          </Link>
        ) : null}
      </ScreenHead>

      {loaded.state === 'loading' ? (
        <div className="rp-skel" role="status" aria-busy="true" aria-label="Loading">
          <span className="w-skel rp-skel-hero" />
          <span className="w-skel rp-skel-row" />
          <span className="w-skel rp-skel-row" />
        </div>
      ) : loaded.state === 'off' ? (
        <SwitchedOffNote />
      ) : loaded.state === 'error' ? (
        <div className="w-empty w-empty-art">
          <Art name="kovi-oops" size={112} />
          <strong>Repeat payments didn’t load</strong>
          <span>{loaded.problem}</span>
          <button type="button" className="mini mini-ink rp-retry" onClick={() => void reload()}>
            <Icon name="refresh" size={14} /> Try again
          </button>
        </div>
      ) : list.length === 0 ? (
        <Intro />
      ) : (
        <>
          {next ? (
            <section
              className="rp-hero"
              aria-label={`Next payment ${formatUsd(amountOf(next))}, ${next.role === 'paying' ? 'to' : 'from'} ${name(next.role === 'paying' ? next.payee : next.payer)}`}
            >
              <svg
                className="w-balance-rings"
                width="220"
                height="220"
                viewBox="-110 -110 220 220"
                aria-hidden="true"
              >
                {[104, 78, 52, 26].map((r) => (
                  <circle key={r} r={r} fill="none" stroke="var(--teal-deep)" strokeWidth="2" />
                ))}
              </svg>
              <Art name="kovi-ride" size={104} className="rp-hero-kovi" />
              <p className="rp-hero-label">
                {next.role === 'paying' ? 'Next payment' : 'Next one to you'}
              </p>
              <Money value={amountOf(next)} className="rp-hero-amount" />
              <p className="rp-hero-line">
                {next.role === 'paying' ? 'To' : 'From'}{' '}
                {next.label ?? name(next.role === 'paying' ? next.payee : next.payer)}
                {nextOf(next) ? ` · ${dueLabel(nextOf(next) as Date)}` : ''}
              </p>
              <div className="rp-hero-chips">
                {activeOut.length ? (
                  <span className="rp-chip">
                    <Icon name="up" size={13} /> {activeOut.length} paying out
                  </span>
                ) : null}
                {activeIn.length ? (
                  <span className="rp-chip">
                    <Icon name="down" size={13} /> {activeIn.length} paying you
                  </span>
                ) : null}
              </div>
            </section>
          ) : null}

          <Link href="/wallet/repeat/new" className="pill pill-block rp-new" data-tone="coral">
            <span className="pill-label">New repeat payment</span>
            <span className="pill-cap">
              <Icon name="plus" size={18} />
            </span>
          </Link>

          <section aria-labelledby="rp-out">
            <h2 className="w-section" id="rp-out">
              You pay
            </h2>
            {paying.length ? (
              <ul className="rp-plans">
                {paying.map((plan) => (
                  <PlanRow key={plan.id} plan={plan} name={name(plan.payee)} onChanged={reload} />
                ))}
              </ul>
            ) : (
              <p className="w-quiet">Nothing goes out on repeat yet.</p>
            )}
          </section>

          <section aria-labelledby="rp-in">
            <h2 className="w-section" id="rp-in">
              Paying you
            </h2>
            {getting.length ? (
              <ul className="rp-plans">
                {getting.map((plan) => (
                  <PlanRow key={plan.id} plan={plan} name={name(plan.payer)} onChanged={reload} />
                ))}
              </ul>
            ) : (
              <p className="w-quiet">
                When someone sets up a repeat payment to you, you’ll see it here.
              </p>
            )}
          </section>

          <p className="w-fine rp-fine">
            Each payment is collected when it’s due, never early and never more than you set. Kova
            covers every fee, and never holds your dollars.
          </p>
        </>
      )}
    </div>
  )
}

/** "Due now" when it's being collected, else the day. */
function dueLabel(at: Date) {
  return at.getTime() <= Date.now() ? 'Due now' : dayLabel(at)
}

/** Dollars large, cents small: "$50" and ".00". */
function Money({ value, className }: { value: bigint; className: string }) {
  const text = formatUsd(value)
  const dot = text.lastIndexOf('.')
  return (
    <p className={className}>
      {text.slice(0, dot)}
      <small>{text.slice(dot)}</small>
    </p>
  )
}

/** What repeat payments are, before there are any. */
function Intro() {
  const points: { icon: IconName; title: string; text: string }[] = [
    {
      icon: 'calendar',
      title: 'You choose how often',
      text: 'Every week, every 2 weeks or every 30 days, from today or a day you pick.',
    },
    {
      icon: 'shield',
      title: 'It can’t take more than you set',
      text: 'You set how many times. That’s the most it can ever pay, checked on Monad.',
    },
    {
      icon: 'close',
      title: 'Stop it any time',
      text: 'One tap here, and nothing more goes.',
    },
  ]
  return (
    <div className="rp-intro">
      <Art name="scene-coin-rain" size={150} className="rp-intro-art" />
      <h1 className="w-title">Set it once, and it pays itself</h1>
      <p className="w-lead">
        Rent, school fees, a wage every Friday. Choose who, how much and how often, and Kova pays
        each one when it’s due.
      </p>
      <ol className="rp-points">
        {points.map((p) => (
          <li key={p.title}>
            <span className="rp-point-icon">
              <Icon name={p.icon} size={18} />
            </span>
            <span>
              <strong>{p.title}</strong>
              <small>{p.text}</small>
            </span>
          </li>
        ))}
      </ol>
      <Link href="/wallet/repeat/new" className="pill pill-block" data-tone="coral">
        <span className="pill-label">Set up a repeat payment</span>
        <span className="pill-cap">
          <Icon name="repeat" size={18} />
        </span>
      </Link>
    </div>
  )
}

/** One plan: who, how much, how often, how far along, and Stop for the wallet paying it. */
function PlanRow({
  plan,
  name,
  onChanged,
}: {
  plan: RepeatPayment
  name: string
  onChanged: () => Promise<void>
}) {
  const { profile, signTypedData } = useWallet()
  const [sure, setSure] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const paying = plan.role === 'paying'
  const active = plan.status === 'active'
  const next = nextOf(plan)
  const who = paying ? plan.payee : plan.payer
  const done = plan.times ? Math.min(1, plan.paid / plan.times) : 0

  const stop = async () => {
    if (!profile) return
    setBusy(true)
    setProblem(null)
    try {
      await stopRepeat(profile.address as Address, plan.id, signTypedData)
      setSure(false)
      await onChanged()
    } catch (e) {
      const message = problemOf(e)
      if (!cancelled(message)) setProblem(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="rp-plan" data-status={plan.status}>
      <div className="rp-plan-top">
        <Avatar name={name} id={who} size={44} />
        <span className="rp-plan-text">
          <strong>{plan.label ?? name}</strong>
          <small>
            {plan.label
              ? `${paying ? 'To' : 'From'} ${name}`
              : paying
                ? 'You pay them'
                : 'Pays you'}
          </small>
        </span>
        <span className="rp-plan-money">
          <strong>{formatUsd(amountOf(plan))}</strong>
          <small>{repeatEveryLabel(plan.every)}</small>
        </span>
      </div>

      <div
        className="rp-bar"
        role="progressbar"
        aria-label={`${plan.paid} of ${plan.times} paid`}
        aria-valuemin={0}
        aria-valuemax={plan.times}
        aria-valuenow={plan.paid}
      >
        <span style={{ width: `${done * 100}%` }} />
      </div>

      <div className="rp-plan-foot">
        <span className="rp-plan-count">
          <strong>
            {plan.paid} of {plan.times}
          </strong>{' '}
          paid
        </span>
        <span className="rp-plan-when">
          {active ? (
            next ? (
              <>
                <Icon name="calendar" size={13} /> Next {dueLabel(next)}
              </>
            ) : null
          ) : (
            <span className="rp-status">{plan.status === 'finished' ? 'All paid' : 'Stopped'}</span>
          )}
        </span>
      </div>

      {plan.problem && active ? (
        <p className="rp-short">
          <Icon name="info" size={15} />
          <span>
            <strong>Short last time.</strong>{' '}
            {paying
              ? 'Your balance didn’t cover it. Add money and Kova tries again soon.'
              : 'Their wallet didn’t have enough. Kova tries again soon.'}
          </span>
        </p>
      ) : null}

      {paying && active ? (
        sure ? (
          <div className="rp-sure" role="alertdialog" aria-label={`Stop paying ${name}?`}>
            <p>
              <strong>Stop paying {name}?</strong> Nothing more goes after this.{' '}
              {plan.paid ? 'What’s already paid stays paid.' : ''}
            </p>
            <div className="rp-sure-actions">
              <button
                type="button"
                className="mini mini-danger"
                disabled={busy}
                onClick={() => void stop()}
              >
                {busy ? 'Stopping…' : 'Stop it'}
              </button>
              <button type="button" className="mini" disabled={busy} onClick={() => setSure(false)}>
                Keep it
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="rp-stop" onClick={() => setSure(true)}>
            Stop
          </button>
        )
      ) : null}
      {problem ? <p className="form-error rp-row-problem">{problem}</p> : null}
    </li>
  )
}

// ── Setting one up ──────────────────────────────────────────────────────────────────────────

type Step = 'who' | 'amount' | 'often' | 'start' | 'times' | 'review' | 'done'
const ORDER: readonly Step[] = ['who', 'amount', 'often', 'start', 'times', 'review', 'done']

type Payee = { address: Address; name?: string }

const OFTEN: Record<(typeof REPEAT_EVERY)[number]['id'], { hint: string; icon: IconName }> = {
  week: { hint: 'The same day each week. Good for wages and allowances.', icon: 'repeat' },
  fortnight: { hint: 'Every other week, like a payday.', icon: 'calendar' },
  month: { hint: 'Rent, school fees and subscriptions.', icon: 'home' },
}

/** Quick picks for how many times, by how often: about a month, a quarter, half a year, a year. */
function quickTimes(every: number): { times: number; label: string }[] {
  if (every === 7 * DAY)
    return [
      { times: 4, label: 'A month' },
      { times: 13, label: '3 months' },
      { times: 26, label: '6 months' },
      { times: 52, label: 'A year' },
    ]
  if (every === 14 * DAY)
    return [
      { times: 2, label: 'A month' },
      { times: 6, label: '3 months' },
      { times: 13, label: '6 months' },
      { times: 26, label: 'A year' },
    ]
  return [
    { times: 3, label: '3 months' },
    { times: 6, label: '6 months' },
    { times: 12, label: 'A year' },
    { times: 24, label: '2 years' },
  ]
}

/** yyyy-mm-dd for a date input, in local time. */
const isoDay = (at: Date) =>
  `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`

/** A picked day's first payment: 9 in the morning there, local time. */
const morningOf = (day: string) => new Date(`${day}T09:00:00`)

const phaseLine: Record<RepeatPhase, string> = {
  plan: 'Signing the plan…',
  limit: 'Signing its limit…',
  start: 'Starting it on Monad…',
}

export function NewRepeat() {
  const { profile, balance, network, signTypedData, contacts } = useWallet()
  const { loaded } = useRepeats()
  const [step, setStep] = useState<Step>('who')
  const [payee, setPayee] = useState<Payee | null>(null)
  const [whoProblem, setWhoProblem] = useState<string | null>(null)
  const [typed, setTyped] = useState('')
  const [label, setLabel] = useState('')
  const [every, setEvery] = useState<number | null>(null)
  const [startOn, setStartOn] = useState<'today' | 'day'>('today')
  const [day, setDay] = useState('')
  const [times, setTimes] = useState(12)
  const [phase, setPhase] = useState<RepeatPhase | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [off, setOff] = useState<string | null>(null)
  const [made, setMade] = useState<RepeatPayment | null>(null)

  const onKey = useCallback((key: Key) => setTyped((v) => applyKey(v, key, 2)), [])
  const amount = useMemo(() => {
    try {
      return typed && Number(typed) > 0 ? toBase(Number(typed).toFixed(2)) : 0n
    } catch {
      return 0n
    }
  }, [typed])

  const known = payee
    ? contacts.find((c) => c.address.toLowerCase() === payee.address.toLowerCase())
    : undefined
  const [nad, setNad] = useState<string | null>(null)
  useEffect(() => {
    setNad(null)
    if (!payee || payee.name || (known && !isUnnamed(known.name))) return
    let live = true
    void nadNameOf(payee.address).then((name) => live && setNad(name))
    return () => {
      live = false
    }
  }, [payee, known])
  const name = payee
    ? known && !isUnnamed(known.name)
      ? known.name
      : (payee.name ?? nad ?? short(payee.address))
    : ''
  const first = isUnnamed(name) ? name : (name.split(' ')[0] ?? name)

  const tomorrow = isoDay(new Date(Date.now() + DAY * 1000))
  const lastDay = isoDay(new Date(Date.now() + 365 * DAY * 1000))
  const firstAt = startOn === 'today' ? new Date() : day ? morningOf(day) : null
  const lastAt = firstAt && every ? new Date(firstAt.getTime() + every * 1000 * (times - 1)) : null
  const most = amount * BigInt(times)
  const often = every ? repeatEveryLabel(every) : ''
  const busy = phase !== null
  const shortNow = startOn === 'today' && balance !== null && amount > balance

  if (!profile) return null
  if (loaded.state === 'off' || off)
    return (
      <div className="w-screen">
        <ScreenHead title="Repeat payment" back="/wallet/repeat" />
        <SwitchedOffNote />
      </div>
    )

  const pick = (p: Payee) => {
    if (isAddressEqual(p.address, profile.address as Address))
      return setWhoProblem('That’s your own wallet. A repeat payment goes to someone else.')
    setWhoProblem(null)
    setPayee(p)
    setStep('amount')
  }

  const chooseEvery = (seconds: number) => {
    if (seconds !== every) {
      const picks = quickTimes(seconds)
      setTimes(picks[1]?.times ?? 12)
    }
    setEvery(seconds)
    setStep('start')
  }

  const start = async () => {
    if (!payee || !every || !firstAt) return
    setProblem(null)
    setPhase('plan')
    try {
      const at =
        startOn === 'today'
          ? Math.floor(Date.now() / 1000)
          : Math.max(Math.floor(firstAt.getTime() / 1000), Math.floor(Date.now() / 1000))
      const plan = await startRepeat(
        network,
        profile.address as Address,
        {
          payee: payee.address,
          amount: Number(typed).toFixed(2),
          every,
          start: at,
          times,
          label: label.trim() || undefined,
        },
        signTypedData,
        setPhase,
      )
      setMade(plan)
      setStep('done')
    } catch (e) {
      if (e instanceof SwitchedOff) return setOff(e.message)
      const message = problemOf(e)
      if (!cancelled(message)) setProblem(message)
    } finally {
      setPhase(null)
    }
  }

  /** Who it's to, at the top of each step after the first. */
  const to = payee ? (
    <div className="rp-to">
      <Avatar name={name} id={payee.address} size={36} />
      <span>
        <strong>To {name}</strong>
        <small>{isUnnamed(name) ? 'A wallet address' : short(payee.address)}</small>
      </span>
    </div>
  ) : null

  if (step === 'done' && made && payee) {
    const paidNow = made.paid > 0
    const nextAt = nextOf(made)
    const proof = made.tx_hash ? `${getNetwork(network).explorerUrl}/tx/${made.tx_hash}` : null
    return (
      <Steps step={step} order={ORDER}>
        <div className="w-screen cx-moment cx-done rp-done">
          <span className="cx-confetti" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
          <span className="cx-cheer">
            <Art name="kovi-cheer" size={124} />
            <span className="cx-cheer-tick" aria-hidden="true">
              <Icon name="check" size={22} />
            </span>
          </span>
          <p className="cx-moment-label">
            {made.label ? `${made.label} is set up` : 'Repeat payment set up'}
          </p>
          <strong className="cx-done-amount">{formatUsd(toBase(made.amount))}</strong>
          <span className="cx-done-where">
            {repeatEveryLabel(made.every).toLowerCase()} to {name}
          </span>
          <span className="cx-took">
            {paidNow
              ? 'The first one is paid'
              : made.problem
                ? 'Set up. The first one is waiting on your balance'
                : `Set up. The first one goes ${nextAt ? dayIn(nextAt) : 'soon'}`}
          </span>
          {made.problem ? (
            <p className="rp-short rp-short-done">
              <Icon name="info" size={15} />
              <span>
                Your balance didn’t cover the first {formatUsd(toBase(made.amount))}. Add money and
                Kova tries again soon.
              </span>
            </p>
          ) : null}
          <dl className="w-review-card cx-receipt">
            <div className="w-review-row">
              <dt>To</dt>
              <dd>{made.label ? `${name}, for ${made.label}` : name}</dd>
            </div>
            <div className="w-review-row">
              <dt>Each time</dt>
              <dd>{formatUsd(toBase(made.amount))}</dd>
            </div>
            <div className="w-review-row">
              <dt>How often</dt>
              <dd>{repeatEveryLabel(made.every)}</dd>
            </div>
            <div className="w-review-row">
              <dt>Paid so far</dt>
              <dd>
                {made.paid} of {made.times}
              </dd>
            </div>
            {nextAt ? (
              <div className="w-review-row">
                <dt>Next</dt>
                <dd>{dueLabel(nextAt)}</dd>
              </div>
            ) : null}
            <div className="w-review-row cx-receipt-rule">
              <dt>At most</dt>
              <dd>{formatUsd(toBase(made.amount) * BigInt(made.times))}</dd>
            </div>
            {proof ? (
              <div className="w-review-row">
                <dt>Proof</dt>
                <dd>
                  <a className="textlink" href={proof} target="_blank" rel="noreferrer">
                    See it on Monad
                  </a>
                </dd>
              </div>
            ) : null}
          </dl>
          <div className="cx-done-actions">
            <Link href="/wallet" className="cx-line-button">
              Done
            </Link>
            <Link href="/wallet/repeat" className="pill pill-block" data-tone="ink">
              <span className="pill-label">See all</span>
              <span className="pill-cap">
                <Icon name="repeat" size={18} />
              </span>
            </Link>
          </div>
        </div>
      </Steps>
    )
  }

  if (step === 'review' && payee && every && firstAt && lastAt)
    return (
      <Steps step={step} order={ORDER}>
        <div className="w-screen">
          <ScreenHead title="Check and start" onBack={busy ? undefined : () => setStep('times')} />
          <section className="rp-review-hero">
            <Avatar name={name} id={payee.address} size={52} />
            <p className="rp-sentence">
              Pays {name} {formatUsd(amount)} {often.toLowerCase()}, {times}{' '}
              {times === 1 ? 'time' : 'times'}.
            </p>
            <p className="rp-most">{formatUsd(most)} at most.</p>
          </section>
          <dl className="w-review-card">
            <div className="w-review-row">
              <dt>To</dt>
              <dd>
                {name}
                {isUnnamed(name) ? null : <small> · {short(payee.address)}</small>}
              </dd>
            </div>
            {label.trim() ? (
              <div className="w-review-row">
                <dt>For</dt>
                <dd>{label.trim()}</dd>
              </div>
            ) : null}
            <div className="w-review-row">
              <dt>Each time</dt>
              <dd>{formatUsd(amount)}</dd>
            </div>
            <div className="w-review-row">
              <dt>How often</dt>
              <dd>{often}</dd>
            </div>
            <div className="w-review-row">
              <dt>First payment</dt>
              <dd>{startOn === 'today' ? 'Today, as soon as you start' : dayLabel(firstAt)}</dd>
            </div>
            <div className="w-review-row">
              <dt>Last payment</dt>
              <dd>{times === 1 ? 'The same day' : `About ${dayLabel(lastAt)}`}</dd>
            </div>
            <div className="w-review-row cx-receipt-rule">
              <dt>At most, in all</dt>
              <dd>{formatUsd(most)}</dd>
            </div>
          </dl>
          <ul className="rp-promises">
            <li>
              <Icon name="check" size={15} /> Paid when it’s due, never early, never more.
            </li>
            <li>
              <Icon name="check" size={15} /> Stop it any time from Repeat payments.
            </li>
            <li>
              <Icon name="check" size={15} /> Kova covers every fee.
            </li>
          </ul>
          {shortNow ? (
            <p className="rp-short">
              <Icon name="info" size={15} />
              <span>
                The first one goes today and you have {formatUsd(balance ?? 0n)}. Add money first,
                or Kova tries again until it’s there.
              </span>
            </p>
          ) : null}
          {problem ? <p className="form-error">{problem}</p> : null}
          <button
            type="button"
            className="pill pill-block rp-go"
            data-tone="coral"
            disabled={busy}
            onClick={() => void start()}
          >
            <span className="pill-label">{phase ? phaseLine[phase] : 'Sign and start'}</span>
            <span className="pill-cap">
              {busy ? (
                <span className="spinner" aria-hidden="true" />
              ) : (
                <Icon name="face" size={18} />
              )}
            </span>
          </button>
          <p className="w-fine rp-center">
            Your passkey signs twice: once for the plan, and once to let it collect. It can never
            take more than {formatUsd(most)} for this plan.
          </p>
        </div>
      </Steps>
    )

  if (step === 'times' && every && firstAt)
    return (
      <Steps step={step} order={ORDER}>
        <div className="w-screen">
          <ScreenHead title="How many times" onBack={() => setStep('start')} />
          {to}
          <div className="rp-times">
            <button
              type="button"
              className="rp-step"
              aria-label="One fewer"
              disabled={times <= 1}
              onClick={() => setTimes((t) => Math.max(1, t - 1))}
            >
              <Icon name="minus" size={22} />
            </button>
            <label className="rp-times-num">
              <span className="sr-only">How many times</span>
              <input
                inputMode="numeric"
                value={times}
                onChange={(e) => {
                  const n = Number(e.target.value.replace(/\D/g, '').slice(0, 3))
                  setTimes(Math.min(MAX_TIMES, Math.max(1, n || 1)))
                }}
              />
              <small>{times === 1 ? 'time' : 'times'}, then it stops</small>
            </label>
            <button
              type="button"
              className="rp-step"
              aria-label="One more"
              disabled={times >= MAX_TIMES}
              onClick={() => setTimes((t) => Math.min(MAX_TIMES, t + 1))}
            >
              <Icon name="plus" size={22} />
            </button>
          </div>
          <fieldset className="rp-quick">
            <legend className="sr-only">Quick picks</legend>
            {quickTimes(every).map((q) => (
              <button
                key={q.times}
                type="button"
                aria-pressed={times === q.times}
                className={times === q.times ? 'rp-quick-on' : undefined}
                onClick={() => setTimes(q.times)}
              >
                <strong>{q.times}</strong>
                <small>{q.label}</small>
              </button>
            ))}
          </fieldset>
          <dl className="w-review-card">
            <div className="w-review-row">
              <dt>Last payment</dt>
              <dd>{times === 1 || !lastAt ? 'The first one' : `About ${dayLabel(lastAt)}`}</dd>
            </div>
            <div className="w-review-row">
              <dt>At most, in all</dt>
              <dd>{formatUsd(most)}</dd>
            </div>
          </dl>
          <p className="w-fine">
            That’s the limit: it can never pay more than {times} {times === 1 ? 'time' : 'times'},
            and you can stop it sooner.
          </p>
          <button
            type="button"
            className="pill pill-block rp-go"
            data-tone="ink"
            onClick={() => setStep('review')}
          >
            <span className="pill-label">Review</span>
            <span className="pill-cap">
              <Icon name="arrow" size={18} />
            </span>
          </button>
        </div>
      </Steps>
    )

  if (step === 'start' && every)
    return (
      <Steps step={step} order={ORDER}>
        <div className="w-screen">
          <ScreenHead title="When it starts" onBack={() => setStep('often')} />
          {to}
          <div className="rp-choices">
            <button
              type="button"
              className="rp-choice"
              aria-pressed={startOn === 'today'}
              onClick={() => setStartOn('today')}
            >
              <span className="rp-choice-icon">
                <Icon name="bolt" size={20} />
              </span>
              <span className="rp-choice-text">
                <strong>Today</strong>
                <small>The first {formatUsd(amount)} goes as soon as you start.</small>
              </span>
              <span className="rp-radio" aria-hidden="true" />
            </button>
            <div className="rp-choice-wrap" data-on={startOn === 'day' ? 'true' : undefined}>
              <button
                type="button"
                className="rp-choice"
                aria-pressed={startOn === 'day'}
                onClick={() => {
                  setStartOn('day')
                  if (!day) setDay(tomorrow)
                }}
              >
                <span className="rp-choice-icon">
                  <Icon name="calendar" size={20} />
                </span>
                <span className="rp-choice-text">
                  <strong>Pick a date</strong>
                  <small>
                    {startOn === 'day' && day
                      ? `The first one goes ${dayIn(morningOf(day))}, in the morning.`
                      : 'Up to a year from now.'}
                  </small>
                </span>
                <span className="rp-radio" aria-hidden="true" />
              </button>
              {startOn === 'day' ? (
                <label className="rp-date">
                  <span className="sr-only">First payment on</span>
                  <input
                    type="date"
                    value={day}
                    min={tomorrow}
                    max={lastDay}
                    onChange={(e) => setDay(e.target.value)}
                  />
                </label>
              ) : null}
            </div>
          </div>
          <p className="w-fine">
            Then {often.toLowerCase()} after that, until it’s paid as many times as you choose next.
          </p>
          <button
            type="button"
            className="pill pill-block rp-go"
            data-tone="ink"
            disabled={startOn === 'day' && !(day >= tomorrow && day <= lastDay)}
            onClick={() => setStep('times')}
          >
            <span className="pill-label">Continue</span>
            <span className="pill-cap">
              <Icon name="arrow" size={18} />
            </span>
          </button>
        </div>
      </Steps>
    )

  if (step === 'often')
    return (
      <Steps step={step} order={ORDER}>
        <div className="w-screen">
          <ScreenHead title="How often" onBack={() => setStep('amount')} />
          {to}
          <div className="rp-choices">
            {REPEAT_EVERY.map((option) => (
              <button
                key={option.id}
                type="button"
                className="rp-choice"
                aria-pressed={every === option.seconds}
                onClick={() => chooseEvery(option.seconds)}
              >
                <span className="rp-choice-icon">
                  <Icon name={OFTEN[option.id].icon} size={20} />
                </span>
                <span className="rp-choice-text">
                  <strong>{option.label}</strong>
                  <small>{OFTEN[option.id].hint}</small>
                </span>
                <span className="rp-choice-amount">{formatUsd(amount)}</span>
              </button>
            ))}
          </div>
        </div>
      </Steps>
    )

  if (step === 'amount' && payee)
    return (
      <Steps step={step} order={ORDER}>
        <div className="w-screen">
          <ScreenHead title="How much each time" onBack={() => setStep('who')} />
          <div className="cx w-fill">
            {to}
            <div className="cx-amount">
              <span className="cx-amount-label">{first} gets, each time</span>
              <p className="cx-big" aria-live="polite">
                <span aria-hidden="true">$</span>
                <strong key={typed} className={typed ? 'cx-big-num' : 'cx-big-num cx-big-empty'}>
                  {groupTyped(typed)}
                </strong>
                <span className="w-sr">dollars</span>
              </p>
            </div>
            <div className="cx-chips">
              <span className={amount > MAX_EACH ? 'cx-chip cx-chip-bad' : 'cx-chip'}>
                {amount > MAX_EACH
                  ? 'Up to $10,000 each time'
                  : balance === null
                    ? '…'
                    : `${formatUsd(balance)} available`}
              </span>
            </div>
            <label className="w-note w-note-private rp-label">
              <Icon name="pen" size={14} />
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="What for? Rent, school fees…"
                maxLength={40}
                aria-label="What it’s for (optional)"
              />
            </label>
            <Keypad onKey={onKey} />
            <button
              type="button"
              className="pill pill-block cx-go"
              data-tone="ink"
              disabled={amount === 0n || amount > MAX_EACH}
              onClick={() => setStep('often')}
            >
              <span className="pill-label">Continue</span>
              <span className="pill-cap">
                <Icon name="arrow" size={18} />
              </span>
            </button>
          </div>
        </div>
      </Steps>
    )

  return (
    <Steps step="who" order={ORDER}>
      <div className="w-screen">
        <ScreenHead title="Repeat payment" back="/wallet/repeat" />
        {whoProblem ? <p className="form-error">{whoProblem}</p> : null}
        <Who
          people={{
            title: 'Who gets it?',
            verb: 'Pay',
            empty:
              'Type their .nad name, or paste their Kova link or wallet address. Rent, school fees or a wage: they get it each time it’s due.',
          }}
          onPick={(p) => pick({ address: getAddress(p.address), name: p.name })}
        />
      </div>
    </Steps>
  )
}
