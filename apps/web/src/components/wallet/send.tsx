'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { getAddress, isAddress } from 'viem'
import { Art, Icon, type IconName } from '@/components/brand'
import { keptLinks } from '@/lib/wallet/dollar-links'
import { parseScanned } from '@/lib/wallet/links'
import {
  applyKey,
  baseToNumber,
  type DisplayCurrency,
  formatLocal,
  formatUsd,
  groupTyped,
  isDisplayCurrency,
  type Key,
  rateLabel,
  toBase,
} from '@/lib/wallet/money'
import { sessionCovers } from '@/lib/wallet/session'
import { Home } from './home'
import { PayDetails, PrivateSwitch, stepLine, TopUpLine, usePaymentRoute } from './private'
import {
  type Contact,
  isUnnamed,
  type PrivateStep,
  short,
  useWallet,
} from './provider'
import { ArcRoute, type Leg } from './arc'
import { Avatar, Keypad } from './ui'

const first = (name: string) => (isUnnamed(name) ? short(name) : (name.split(' ')[0] ?? name))

/** When you last paid someone, or they paid you, in a few words. */
function story(activity: ReturnType<typeof useWallet>['activity'], address: string): string {
  const last = activity.find(
    (e) =>
      e.address?.toLowerCase() === address.toLowerCase() &&
      (e.kind === 'sent' || e.kind === 'received'),
  )
  if (!last) return 'No payments yet'
  const days = Math.floor((Date.now() - last.at) / 86_400_000)
  const ago = days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days}d ago`
  return last.kind === 'sent'
    ? `You sent ${formatUsd(BigInt(last.amount))}, ${ago}`
    : `Paid you ${formatUsd(BigInt(last.amount))}, ${ago}`
}

type Step = 'who' | 'amount' | 'review' | 'sent'
const order: Step[] = ['who', 'amount', 'review', 'sent']
type Payee = { address: string; name?: string; currency?: DisplayCurrency }

/** Whether the last send was private: the switch starts where you left it. */
const PRIVATELY = 'kova.web.sendPrivately.v1'

/**
 * Sending, in one sheet over Home, as in the app: who, how much, a look at the route, slide to
 * send, and the same sheet becomes the receipt. It resizes to each step, so it settles low once
 * the money has landed and your balance shows behind it, counting down.
 */
export function SendSheet({ to }: { to?: string }) {
  const router = useRouter()
  const params = useSearchParams()
  const {
    contacts,
    balance,
    send,
    rates,
    liveRates,
    profile,
    noteReaches,
    privateReaches,
    privateBalance,
    activity,
    tickPrivate,
    moveInFor,
  } = useWallet()

  const asked = params.get('amount')
  const start: Payee | null =
    to && isAddress(to)
      ? {
          address: getAddress(to),
          name: params.get('name')?.trim() || undefined,
          currency: isDisplayCurrency(params.get('cur'))
            ? (params.get('cur') as DisplayCurrency)
            : undefined,
        }
      : null
  const validAsk = asked && /^\d+(\.\d{1,2})?$/.test(asked) ? asked : ''

  const [step, setStep] = useState<Step>(start ? (validAsk ? 'review' : 'amount') : 'who')
  const [back, setBack] = useState(false)
  const [payee, setPayee] = useState<Payee | null>(start)
  const [typed, setTyped] = useState(validAsk)
  const [note, setNote] = useState(params.get('note') ?? '')
  const [leg, setLeg] = useState<Leg>('waiting')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [sent, setSent] = useState<{
    ms: number
    hash: string
    explorer: string
    privately: boolean
    fromPrivate: boolean
  } | null>(null)
  /** Paying from private dollars: gathering them first, then paying. */
  const [privateStep, setPrivateStep] = useState<PrivateStep | null>(null)
  const [closing, setClosing] = useState(false)
  /** Whether they can read a private note: null while asking Kova for their note key. */
  const [reaches, setReaches] = useState<boolean | null>(null)
  /** Whether they can be sent to privately: null while asking Kova for their private key. */
  const [canPrivate, setCanPrivate] = useState<boolean | null>(null)
  const [privately, setPrivately] = useState(false)
  const address = payee?.address
  const yourself = Boolean(
    address && profile && address.toLowerCase() === profile.address.toLowerCase(),
  )
  useEffect(() => {
    if (!address) return
    let live = true
    setReaches(null)
    setCanPrivate(null)
    void noteReaches(address).then((yes) => live && setReaches(yes))
    void privateReaches(address).then((yes) => live && setCanPrivate(yes))
    return () => {
      live = false
    }
  }, [address, noteReaches, privateReaches])
  useEffect(() => {
    try {
      setPrivately(localStorage.getItem(PRIVATELY) === '1')
    } catch {}
  }, [])
  const choosePrivately = (on: boolean) => {
    setPrivately(on)
    try {
      localStorage.setItem(PRIVATELY, on ? '1' : '0')
    } catch {}
  }
  /** Private only when they've a key to send to, and never to yourself. */
  const keyed = canPrivate === true && !yourself

  const moveTo = (next: Step) => {
    setBack(order.indexOf(next) < order.indexOf(step))
    setStep(next)
  }

  const known = payee
    ? contacts.find((c) => c.address.toLowerCase() === payee.address.toLowerCase())
    : undefined
  const name = payee
    ? known && !isUnnamed(known.name)
      ? known.name
      : payee.name || short(payee.address)
    : ''
  const theirs = payee?.currency ?? known?.currency
  const local = theirs && theirs !== 'USD' ? theirs : null

  const onKey = useCallback((key: Key) => setTyped((v) => applyKey(v, key, 2)), [])
  const amount = useMemo(() => {
    try {
      return typed && Number(typed) > 0 ? toBase(Number(typed).toFixed(2)) : 0n
    } catch {
      return 0n
    }
  }, [typed])
  const dollars = baseToNumber(amount)
  // Where it comes from, by the privacy router. Private dollars only go out privately, to someone
  // with a key; a private send spends them first. When the balance is short and they cover it,
  // that's how this send goes, privately. When only both together cover it, just enough moves in.
  const { route, choose, choosable, from } = usePaymentRoute({
    amount,
    direct: keyed,
    privateFirst: privately,
    paying: busy,
  })
  const fromPrivate = from === 'private'
  /** Private dollars pay it though Send privately is off: it goes privately, they only go that way. */
  const mustPrivate = fromPrivate && !privately
  const goPrivately = keyed && (privately || mustPrivate)
  /** Short even with private dollars counted in. */
  const blocked = route.from === 'short'
  /** One balance: what you have, private dollars included. */
  const have = balance === null ? null : balance + privateBalance
  const theirLocal = local ? formatLocal(dollars, local, rates) : null

  const close = useCallback(() => {
    if (busy) return
    setClosing(true)
    setTimeout(() => router.push('/wallet'), 260)
  }, [busy, router])

  // A dialog: Escape closes it, the page behind doesn't scroll.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKeyDown)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = overflow
    }
  }, [close])

  const pick = (p: Payee & { amount?: string; note?: string }) => {
    setPayee(p)
    if (p.amount) setTyped(p.amount)
    if (p.note) setNote(p.note)
    moveTo(p.amount ? 'review' : 'amount')
  }

  const go = async () => {
    if (!payee) return
    const contact: Contact = {
      address: payee.address,
      name,
      ...(theirs ? { currency: theirs } : {}),
    }
    setBusy(true)
    setProblem(null)
    setLeg('flying')
    const started = Date.now()
    try {
      // Short: just enough private dollars move into the balance first.
      if (route.from === 'top-up') {
        setPrivateStep('moving')
        await moveInFor(route.shortfall)
      }
      const moved = await send(contact, amount, note, {
        privately: goPrivately,
        from,
        onStep: setPrivateStep,
      })
      // Let Kovi finish the leg he is on: the flight is timed to about what the chain takes.
      await wait(Math.max(0, 1360 - (Date.now() - started)))
      setLeg('landed')
      await wait(620)
      setSent({
        ms: moved.ms,
        hash: moved.hash,
        explorer: moved.explorer,
        privately: goPrivately,
        fromPrivate,
      })
      setPrivateStep(null)
      setBusy(false)
      moveTo('sent')
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Kova couldn’t send it.'
      setLeg('waiting')
      setBusy(false)
      setPrivateStep(null)
      if (!/cancel|not allowed|abort/i.test(message)) setProblem(message)
    }
  }

  const quick = sessionCovers(amount)

  /** A private send's Announcement on Monad, once Kova has posted it, a few seconds after. */
  const announced = sent?.privately
    ? (activity.find((e) => e.txHash.toLowerCase() === sent.hash.toLowerCase())?.announced ?? null)
    : null
  // Look for it a little more often while the receipt says it's on its way.
  useEffect(() => {
    if (!sent?.privately || announced) return
    let tries = 0
    const timer = setInterval(() => {
      if (++tries > 16) clearInterval(timer)
      void tickPrivate()
    }, 2500)
    return () => clearInterval(timer)
  }, [sent, announced, tickPrivate])

  return (
    <>
      <div aria-hidden="true" inert>
        <Home />
      </div>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close"
        className={`w-sheet-scrim${closing ? ' w-sheet-out' : ''}`}
        onClick={close}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={payee ? `Send to ${name}` : 'Send'}
        className={`w-sheet${closing ? ' w-sheet-out' : ''}`}
      >
        <button type="button" className="w-sheet-grab" aria-label="Close" onClick={close} />
        <Fit>
          <div key={step} className={`w-step${back ? ' w-step-back' : ''}`}>
            {step === 'who' ? <Who onPick={pick} /> : null}

            {step === 'amount' && payee ? (
              <div className="w-sheet-amount">
                <div className="w-sheet-top">
                  {start ? null : (
                    <button
                      type="button"
                      className="round"
                      aria-label="Back"
                      onClick={() => moveTo('who')}
                    >
                      <Icon name="back" size={18} />
                    </button>
                  )}
                  <Avatar name={name} id={payee.address} size={40} />
                  <span className="w-sheet-who">
                    <strong>To {isUnnamed(name) ? short(payee.address) : name}</strong>
                    <small>{isUnnamed(name) ? 'A Monad address' : short(payee.address)}</small>
                  </span>
                </div>
                <p className="w-typed" aria-live="polite">
                  <span className="w-typed-sign">$</span>
                  {groupTyped(typed)}
                </p>
                <div className="w-sheet-pills">
                  {theirLocal && amount > 0n ? (
                    <span className="w-sheet-pill w-sheet-pill-teal">
                      {first(name)} sees ≈ {theirLocal}
                    </span>
                  ) : null}
                  {have !== null ? (
                    <span className={`w-sheet-pill${blocked ? ' w-sheet-pill-over' : ''}`}>
                      {blocked ? `You have ${formatUsd(have)}` : `${formatUsd(have)} available`}
                    </span>
                  ) : null}
                </div>
                <label className="w-note w-note-private">
                  <Icon name="lock" size={14} />
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Private note"
                    maxLength={60}
                    aria-label="Private note, only you and them can read it"
                  />
                </label>
                <Keypad onKey={onKey} />
                <button
                  type="button"
                  className="pill pill-block"
                  data-tone="ink"
                  disabled={amount === 0n || blocked}
                  onClick={() => moveTo('review')}
                >
                  <span className="pill-label">{blocked ? 'More than you have' : 'Review'}</span>
                  <span className="pill-cap">
                    <Icon name="arrow" size={18} />
                  </span>
                </button>
              </div>
            ) : null}

            {step === 'review' && payee && profile ? (
              <div>
                <div className="w-sheet-top">
                  <button
                    type="button"
                    className="round"
                    aria-label="Change the amount"
                    disabled={busy}
                    onClick={() => moveTo('amount')}
                  >
                    <Icon name="back" size={18} />
                  </button>
                  <strong className="w-sheet-title">
                    {busy ? `Sending to ${first(name)}` : 'Check and send'}
                  </strong>
                </div>
                <ArcRoute
                  you={{ name: profile.name || 'You', id: profile.address }}
                  them={{ name, id: payee.address }}
                  leg={leg}
                  privately={goPrivately}
                />
                <div className="w-sheet-sum">
                  <strong>{formatUsd(amount)}</strong>
                  <span>
                    {theirLocal
                      ? `${first(name)} gets ${formatUsd(amount)}, about ${theirLocal}`
                      : isUnnamed(name)
                        ? 'They get all of it'
                        : `${first(name)} gets all of it`}
                  </span>
                </div>
                <dl className="w-facts">
                  <Fact label="Fee" value="$0.00, Kova covers it" />
                  <Fact label="Arrives" value="In about a second" icon="bolt" />
                  {local ? (
                    <Fact
                      label="Rate"
                      value={`1 USD ≈ ${rates[local].toLocaleString('en-US', { maximumFractionDigits: 2 })} ${local}`}
                      hint={rateLabel(liveRates)}
                    />
                  ) : null}
                  {note.trim() ? (
                    <Fact
                      label="Note"
                      value={note.trim()}
                      icon="lock"
                      hint={
                        goPrivately
                          ? `Sealed inside the payment: only ${first(name)} can open it`
                          : reaches === null
                            ? 'Sealing…'
                            : reaches
                              ? `Sealed: only you and ${first(name)} can read it`
                              : `Sealed for you; ${first(name)} can’t get private notes yet`
                      }
                    />
                  ) : null}
                </dl>
                {keyed ? (
                  <PrivateSwitch
                    on={goPrivately}
                    onChange={choosePrivately}
                    name={name}
                    amount={amount}
                    disabled={busy || mustPrivate}
                    fromPrivate={fromPrivate}
                  />
                ) : null}
                {mustPrivate ? (
                  <p className="w-fine w-forced">This one goes privately, from your private dollars.</p>
                ) : null}
                <TopUpLine route={route} />
                {choosable ? (
                  <PayDetails amount={amount} route={route} onChoose={choose} disabled={busy} />
                ) : null}
                {problem ? (
                  <p className="w-sheet-problem" role="alert">
                    <Icon name="info" size={16} />
                    {problem}
                    {/went through/i.test(problem) ? '' : ' Your money hasn’t moved.'}
                  </p>
                ) : null}
                {blocked ? (
                  <p className="form-error">
                    You have {formatUsd(have ?? 0n)}. Add money first, or send less.
                  </p>
                ) : null}
                <SlideToSend
                  label={
                    problem
                      ? 'Slide to try again'
                      : `Slide to send ${formatUsd(amount)}${goPrivately ? ' privately' : ''}`
                  }
                  busy={busy}
                  disabled={blocked || amount === 0n}
                  onSend={() => void go()}
                />
                <p className="w-fine w-center" aria-live="polite">
                  {busy && privateStep
                    ? `${stepLine(privateStep, route.from === 'top-up' ? route.moving : undefined)} Kova covers every fee.`
                    : quick
                      ? 'Your wallet is open, so this one needs no passkey.'
                      : 'Your passkey approves it. Payments on Monad can’t be undone.'}
                </p>
              </div>
            ) : null}

            {step === 'sent' && payee && sent ? (
              <div className="w-sheet-sent">
                <div className="w-sheet-cheer">
                  <Art name="kovi-cheer" size={120} />
                  <Art name="sparkle-4" size={22} className="w-spark w-spark-1" />
                  <Art name="sparkle-8" size={26} className="w-spark w-spark-2" />
                  <Art name="sparkle-11" size={18} className="w-spark w-spark-3" />
                </div>
                <h2>{sent.privately ? 'Sent privately' : 'Sent'}</h2>
                {sent.privately ? (
                  <p>
                    {formatUsd(amount)} to {first(name)}
                    {sent.fromPrivate ? ', from your private dollars' : ''}. Only {first(name)} can
                    tell it’s theirs.
                  </p>
                ) : (
                  <p>
                    {formatUsd(amount)} landed with {first(name)}
                    {theirLocal ? `, about ${theirLocal}` : ''}
                  </p>
                )}
                <span className="w-sheet-time">
                  <Icon name={sent.privately ? 'lock' : 'bolt'} size={14} />
                  Arrived in {(sent.ms / 1000).toFixed(2)} s on Monad
                </span>
                {sent.privately ? (
                  announced ? (
                    <a className="w-announced" href={announced} target="_blank" rel="noreferrer">
                      Announced on Monad <Icon name="external" size={13} />
                    </a>
                  ) : (
                    <span className="w-announcing">Announcing on Monad…</span>
                  )
                ) : null}
                <button type="button" className="pill pill-block" data-tone="ink" onClick={close}>
                  <span className="pill-label">Done</span>
                  <span className="pill-cap">
                    <Icon name="check" size={18} />
                  </span>
                </button>
                <span className="w-sheet-links">
                  <Link href={`/wallet/activity/${sent.hash}`} className="textlink">
                    See receipt
                  </Link>
                  {sent.privately ? (
                    <a href={sent.explorer} target="_blank" rel="noreferrer" className="textlink">
                      See it on Monad
                    </a>
                  ) : null}
                </span>
              </div>
            ) : null}

            {step !== 'who' && !payee ? (
              <div className="w-empty">
                <strong>That address doesn’t look right.</strong>
                <span>Ask them for their Kova link, or check the address.</span>
              </div>
            ) : null}
          </div>
        </Fit>
      </div>
    </>
  )
}

export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Holds the sheet at its content's height and animates between heights as the steps change. */
export function Fit({ children }: { children: React.ReactNode }) {
  const inner = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | null>(null)
  useLayoutEffect(() => {
    const el = inner.current
    if (!el) return
    const measure = () => setHeight(el.offsetHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return (
    <div className="w-sheet-fit" style={height === null ? undefined : { height }}>
      <div ref={inner}>{children}</div>
    </div>
  )
}

/** Who to send to: one field for a name, an address or a link; your people one tap away. */
function Who({ onPick }: { onPick: (p: Payee & { amount?: string; note?: string }) => void }) {
  const router = useRouter()
  const { contacts, activity } = useWallet()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [hasLinks, setHasLinks] = useState(false)
  useEffect(() => setHasLinks(Object.keys(keptLinks()).length > 0), [])
  const scanned = text.trim() ? parseScanned(text) : null
  const query = text.trim().toLowerCase()
  const matches =
    query && !scanned
      ? contacts.filter(
          (c) => c.name.toLowerCase().includes(query) || c.address.toLowerCase().startsWith(query),
        )
      : contacts

  const go = (value: string) => {
    const s = parseScanned(value)
    if (!s) return setError('That isn’t a Kova link or a wallet address.')
    if (s.kind === 'charge') return router.push(`/wallet/pay/${s.id}`)
    if (s.kind === 'stall') return router.push(`/s/${s.slug}`)
    if (s.kind === 'pair')
      return setError('That code pairs a phone with a shop. Open it in the Kova app.')
    if (s.kind === 'claim') return router.push(`/c/${s.id}${s.key ? `#${s.key}` : ''}`)
    onPick({
      address: getAddress(s.address),
      name: s.name ?? undefined,
      currency: isDisplayCurrency(s.currency ?? null) ? (s.currency as DisplayCurrency) : undefined,
      amount: s.amount ?? undefined,
      note: s.note ?? undefined,
    })
  }

  return (
    <div>
      <h2 className="w-sheet-h">Send to</h2>
      <form
        className="w-find"
        onSubmit={(e) => {
          e.preventDefault()
          const only = matches.length === 1 && !scanned ? matches[0] : undefined
          if (only)
            return onPick({ address: only.address, name: only.name, currency: only.currency })
          go(text)
        }}
      >
        <Icon name="search" size={18} />
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setError(null)
          }}
          placeholder="Name, address or link"
          aria-label="Name, address or link"
          spellCheck={false}
          autoComplete="off"
        />
        {text ? (
          <button
            type="button"
            className="w-find-btn"
            onClick={() => setText('')}
            aria-label="Clear"
          >
            <Icon name="close" size={16} />
          </button>
        ) : (
          <button
            type="button"
            className="w-find-btn"
            onClick={async () => {
              const pasted = await navigator.clipboard.readText().catch(() => '')
              if (!pasted.trim()) return setError('Nothing to paste. Ask them for their Kova link.')
              setText(pasted.trim())
            }}
          >
            Paste
          </button>
        )}
        <Link href="/wallet/pay" className="w-find-scan" aria-label="Scan their code">
          <Icon name="scan" size={18} />
        </Link>
      </form>
      {error ? <p className="form-error">{error}</p> : null}

      {scanned?.kind === 'claim' ? (
        <button type="button" className="w-match" onClick={() => go(text)}>
          <span className="w-linkrow-disc">
            <Icon name="gift" size={20} />
          </span>
          <span>
            <strong>Open this link</strong>
            <small>Dollars someone sent you, ready to claim</small>
          </span>
          <Icon name="arrow" size={18} />
        </button>
      ) : null}

      {query ? null : (
        <>
          <Link href="/wallet/send/link" className="w-linkrow">
            <span className="w-linkrow-disc">
              <Icon name="link" size={20} />
            </span>
            <span className="w-linkrow-text">
              <strong>Send as a link</strong>
              <small>To anyone, even without Kova. They claim it in a tap.</small>
            </span>
            <Icon name="arrow" size={18} />
          </Link>
          {hasLinks ? (
            <Link href="/wallet/links" className="w-linkrow-mine">
              Your links <Icon name="chevron" size={14} />
            </Link>
          ) : null}
        </>
      )}

      {scanned?.kind === 'person' ? (
        <button type="button" className="w-match" onClick={() => go(text)}>
          <Avatar name={scanned.name ?? scanned.address} id={scanned.address} size={44} />
          <span>
            <strong>Send to {scanned.name ?? short(scanned.address)}</strong>
            <small>
              {scanned.amount
                ? `They asked for $${scanned.amount}${scanned.note ? `, for ${scanned.note}` : ''}`
                : 'Monad address, ready to pay'}
            </small>
          </span>
          <Icon name="arrow" size={18} />
        </button>
      ) : null}

      {contacts.length === 0 && !scanned ? (
        <div className="w-empty w-empty-art">
          <Art name="kovi-ride" size={104} className="w-bob" />
          <strong>Send your first payment</strong>
          <span>
            Paste a friend’s Kova link or their Monad address. It lands in about a second, and Kova
            covers the fee.
          </span>
        </div>
      ) : null}

      {!query && contacts.length > 3 ? (
        <div className="w-people w-sheet-people">
          {contacts.slice(0, 8).map((c) => (
            <button
              key={c.address}
              type="button"
              className="w-person"
              onClick={() => onPick({ address: c.address, name: c.name, currency: c.currency })}
            >
              <Avatar name={c.name} id={c.address} size={48} />
              <span>{isUnnamed(c.name) ? c.address.slice(0, 6) : first(c.name)}</span>
            </button>
          ))}
        </div>
      ) : null}

      {matches.length > 0 && !scanned ? (
        <>
          <h3 className="w-section">{query ? `Matches (${matches.length})` : 'Everyone'}</h3>
          <div className="w-list w-sheet-list">
            {matches.map((c) => (
              <button
                key={c.address}
                type="button"
                className="w-list-row"
                onClick={() => onPick({ address: c.address, name: c.name, currency: c.currency })}
              >
                <Avatar name={c.name} id={c.address} size={40} />
                <span className="w-list-text">
                  <strong>{isUnnamed(c.name) ? short(c.address) : c.name}</strong>
                  <small>{story(activity, c.address)}</small>
                </span>
                <Icon name="chevron" size={16} />
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}

export function Fact({
  label,
  value,
  hint,
  icon,
}: {
  label: string
  value: string
  hint?: string
  icon?: IconName
}) {
  return (
    <div className="w-fact">
      <dt>{label}</dt>
      <dd>
        <span>
          {icon ? (
            <span className={icon === 'lock' ? 'w-fact-lock' : undefined}>
              <Icon name={icon} size={14} />
            </span>
          ) : null}
          {value}
        </span>
        {hint ? <small>{hint}</small> : null}
      </dd>
    </div>
  )
}

const KNOB = 50
const PAD = 5

/**
 * Slide to send: the one deliberate gesture between a review and money leaving. The track fills
 * coral behind the knob; letting go short of the end springs it home. With a keyboard, the knob
 * is a button: Enter or Space sends.
 */
export function SlideToSend({
  label,
  busy,
  disabled,
  onSend,
}: {
  label: string
  busy: boolean
  disabled?: boolean
  onSend: () => void
}) {
  const track = useRef<HTMLDivElement>(null)
  const [x, setX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [nudge, setNudge] = useState(false)
  const drag = useRef<{ start: number; from: number; moved: boolean } | null>(null)
  const max = () => (track.current ? track.current.clientWidth - KNOB - PAD * 2 : 0)

  useEffect(() => {
    const el = track.current
    setX(busy && el ? el.clientWidth - KNOB - PAD * 2 : 0)
  }, [busy])

  const commit = () => {
    setX(max())
    navigator.vibrate?.(20)
    onSend()
  }

  return (
    <div
      ref={track}
      className={`w-slide${disabled ? ' w-slide-off' : ''}${busy ? ' w-slide-busy' : ''}${dragging ? ' w-slide-drag' : ''}`}
    >
      <span className="w-slide-fill" style={{ width: x + KNOB + PAD }} />
      <span
        className="w-slide-words"
        style={{ opacity: busy ? 0 : Math.max(0, 1 - x / (max() * 0.5 || 1)) }}
      >
        {label}
        <span className="w-slide-chevrons" aria-hidden="true">
          <Icon name="chevron" size={14} />
          <Icon name="chevron" size={14} />
          <Icon name="chevron" size={14} />
        </span>
      </span>
      {busy ? <span className="w-slide-words">Sending</span> : null}
      <button
        type="button"
        className={`w-slide-knob${nudge ? ' w-slide-nudge' : ''}`}
        style={{ transform: `translateX(${x}px)` }}
        disabled={disabled || busy}
        aria-label={`${label}. Press Enter to send.`}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            commit()
          }
        }}
        onPointerDown={(e) => {
          if (disabled || busy) return
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { start: e.clientX, from: x, moved: false }
          setDragging(true)
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          const dx = e.clientX - drag.current.start
          if (Math.abs(dx) > 4) drag.current.moved = true
          setX(Math.min(max(), Math.max(0, drag.current.from + dx)))
        }}
        onPointerUp={() => {
          const d = drag.current
          drag.current = null
          setDragging(false)
          if (!d) return
          if (x >= max() * 0.86) return commit()
          setX(0)
          // A click instead of a slide: show which way it goes.
          if (!d.moved) {
            setNudge(true)
            setTimeout(() => setNudge(false), 700)
          }
        }}
        onPointerCancel={() => {
          drag.current = null
          setDragging(false)
          setX(0)
        }}
        onClick={(e) => e.preventDefault()}
      >
        {busy ? <span className="w-slide-spin" /> : <Icon name="arrow" size={22} />}
      </button>
    </div>
  )
}
