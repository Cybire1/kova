'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Art, Icon } from '@/components/brand'
import { LinkEnvelope } from '@/components/link-envelope'
import { balanceOf } from '@/lib/wallet/chain'
import {
  dropLinkKey,
  type KeptLink,
  linkUrl,
  newLinkKey,
  plainUsd,
  recordLink,
  settleLinkKey,
  shareMessage,
} from '@/lib/wallet/dollar-links'
import {
  applyKey,
  baseToNumber,
  formatLocal,
  formatUsd,
  groupTyped,
  type Key,
  toBase,
} from '@/lib/wallet/money'
import { sessionCovers } from '@/lib/wallet/session'
import { Home } from './home'
import { MoveInFirst, privateCovers } from './private'
import { short, useWallet } from './provider'
import { Fact, Fit, SlideToSend, wait } from './send'
import { CopyButton, Keypad } from './ui'

type Step = 'amount' | 'review' | 'made'
const order: Step[] = ['amount', 'review', 'made']

/** Where making the link has got to: the dollars go into it, then Kova records it. */
type Phase = 'idle' | 'funding' | 'recording'

/**
 * Send as a link: dollars for anyone, even someone without Kova. This browser makes a one-time
 * key, your wallet sends the dollars to its address (the usual gasless send, approved by your
 * passkey), Kova records the link, and you get a link to share. The key rides in the link after
 * the #, and stays in this browser too, so you can take the dollars back until someone claims them.
 */
export function LinkSheet() {
  const router = useRouter()
  const { balance, fundLink, profile, rates, network, privateBalance } = useWallet()
  const [step, setStep] = useState<Step>('amount')
  const [back, setBack] = useState(false)
  const [typed, setTyped] = useState('')
  const [note, setNote] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [problem, setProblem] = useState<string | null>(null)
  /** Funded but not recorded yet: trying again only records it, the dollars don't move twice. */
  const [unrecorded, setUnrecorded] = useState<KeptLink | null>(null)
  const [made, setMade] = useState<{ url: string; amount: bigint; note: string } | null>(null)
  const [closing, setClosing] = useState(false)
  const [origin, setOrigin] = useState('https://mykova.app')
  useEffect(() => setOrigin(window.location.origin), [])
  const busy = phase !== 'idle'

  const moveTo = (next: Step) => {
    setBack(order.indexOf(next) < order.indexOf(step))
    setStep(next)
  }

  const onKey = useCallback((key: Key) => setTyped((v) => applyKey(v, key, 2)), [])
  const amount = useMemo(() => {
    try {
      return typed && Number(typed) > 0 ? toBase(Number(typed).toFixed(2)) : 0n
    } catch {
      return 0n
    }
  }, [typed])
  const over = balance !== null && amount > balance
  /** Short, but private dollars waiting to move in would cover it. */
  const coverable = privateCovers(balance, privateBalance, amount)
  const local =
    profile && profile.currency !== 'USD'
      ? formatLocal(baseToNumber(amount), profile.currency, rates)
      : null

  const close = useCallback(() => {
    if (busy) return
    setClosing(true)
    setTimeout(() => router.push('/wallet'), 260)
  }, [busy, router])

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

  /** Kova records the funded link; the key moves under its id, and the link is ready to share. */
  const record = async (kept: KeptLink) => {
    if (!profile) return
    setPhase('recording')
    const link = await recordLink({
      link_address: kept.address,
      sender_address: profile.address,
      ...(profile.name ? { sender_name: profile.name } : {}),
      ...(kept.note ? { note: kept.note } : {}),
      ...(profile.currency !== 'USD' ? { display_currency: profile.currency } : {}),
    })
    settleLinkKey(kept, link.id, network)
    setUnrecorded(null)
    setMade({
      url: linkUrl(origin, link.id, kept.key),
      amount: BigInt(kept.amount),
      note: kept.note ?? '',
    })
    setPhase('idle')
    navigator.vibrate?.(20)
    moveTo('made')
  }

  const go = async () => {
    if (!profile) return
    setProblem(null)
    if (unrecorded) {
      try {
        await record(unrecorded)
      } catch (e) {
        setPhase('idle')
        setProblem(recordProblem(e))
      }
      return
    }
    const kept = newLinkKey(amount, note.trim() || null, network)
    setPhase('funding')
    const started = Date.now()
    try {
      await fundLink(kept)
    } catch (e) {
      setPhase('idle')
      // Nothing reached the link: forget its key. If something did, keep it, to take back later.
      const held = await balanceOf(network, kept.address).catch(() => null)
      if (held === 0n) dropLinkKey(kept, network)
      else if (held !== null) setUnrecorded(kept)
      const message = e instanceof Error ? e.message : 'Kova couldn’t make the link.'
      if (!/cancel|not allowed|abort/i.test(message)) setProblem(message)
      return
    }
    try {
      await wait(Math.max(0, 900 - (Date.now() - started)))
      await record(kept)
    } catch (e) {
      setUnrecorded(kept)
      setPhase('idle')
      setProblem(recordProblem(e))
    }
  }

  const quick = sessionCovers(amount)
  const firstName = profile?.name.split(' ')[0] || 'You'
  const whats = made ? shareMessage(profile?.name ?? '', made.amount, made.url, made.note) : ''

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
        aria-label="Send as a link"
        className={`w-sheet${closing ? ' w-sheet-out' : ''}`}
      >
        <button type="button" className="w-sheet-grab" aria-label="Close" onClick={close} />
        <Fit>
          <div key={step} className={`w-step${back ? ' w-step-back' : ''}`}>
            {step === 'amount' ? (
              <div className="w-sheet-amount">
                <div className="w-sheet-top">
                  <Link href="/wallet/send" className="round" aria-label="Back">
                    <Icon name="back" size={18} />
                  </Link>
                  <span className="w-linkrow-disc">
                    <Icon name="link" size={20} />
                  </span>
                  <span className="w-sheet-who">
                    <strong>Send as a link</strong>
                    <small>Anyone with it can claim the dollars</small>
                  </span>
                </div>
                <p className="w-typed" aria-live="polite">
                  <span className="w-typed-sign">$</span>
                  {groupTyped(typed)}
                </p>
                <div className="w-sheet-pills">
                  {local && amount > 0n ? (
                    <span className="w-sheet-pill w-sheet-pill-teal">≈ {local}</span>
                  ) : null}
                  {balance !== null ? (
                    <span className={`w-sheet-pill${over ? ' w-sheet-pill-over' : ''}`}>
                      {over ? `You have ${formatUsd(balance)}` : `${formatUsd(balance)} available`}
                    </span>
                  ) : null}
                  {over && privateBalance > 0n ? (
                    <span className="w-sheet-pill w-sheet-pill-private">
                      <Icon name="lock" size={12} />+{formatUsd(privateBalance)} private
                    </span>
                  ) : null}
                </div>
                <input
                  className="w-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Add a note"
                  maxLength={140}
                  aria-label="A note, shown with the link"
                />
                <Keypad onKey={onKey} />
                {coverable ? (
                  <MoveInFirst />
                ) : (
                  <button
                    type="button"
                    className="pill pill-block"
                    data-tone="ink"
                    disabled={amount === 0n || over}
                    onClick={() => moveTo('review')}
                  >
                    <span className="pill-label">{over ? 'More than you have' : 'Review'}</span>
                    <span className="pill-cap">
                      <Icon name="arrow" size={18} />
                    </span>
                  </button>
                )}
              </div>
            ) : null}

            {step === 'review' && profile ? (
              <div>
                <div className="w-sheet-top">
                  <button
                    type="button"
                    className="round"
                    aria-label="Change the amount"
                    disabled={busy || unrecorded !== null}
                    onClick={() => moveTo('amount')}
                  >
                    <Icon name="back" size={18} />
                  </button>
                  <strong className="w-sheet-title">
                    {phase === 'funding'
                      ? `Putting ${formatUsd(amount)} in the link`
                      : phase === 'recording'
                        ? 'Sealing the link'
                        : 'What they’ll see'}
                  </strong>
                </div>
                <div className={`lk-preview${busy ? ' lk-preview-busy' : ''}`}>
                  <LinkEnvelope
                    from={profile.name || short(profile.address)}
                    fromId={profile.address}
                    amount={formatUsd(amount)}
                    note={note.trim() || null}
                    headline={false}
                  />
                </div>
                <dl className="w-facts">
                  <Fact label="Fee" value="$0.00, Kova covers it" />
                  <Fact label="Who claims it" value="Anyone with the link" />
                  <Fact
                    label="Not claimed?"
                    value="Take it back any time"
                    hint="From Your links, on this browser"
                  />
                </dl>
                {problem ? (
                  <p className="w-sheet-problem" role="alert">
                    <Icon name="info" size={16} />
                    {problem}
                  </p>
                ) : null}
                <SlideToSend
                  label={
                    unrecorded
                      ? 'Slide to finish the link'
                      : problem
                        ? 'Slide to try again'
                        : `Slide to make a ${plainUsd(amount)} link`
                  }
                  busy={busy}
                  disabled={over || amount === 0n}
                  onSend={() => void go()}
                />
                <p className="w-fine w-center">
                  {quick
                    ? 'Your wallet is open, so this one needs no passkey.'
                    : 'Your passkey approves it. The dollars wait in the link until someone claims them.'}
                </p>
              </div>
            ) : null}

            {step === 'made' && made ? (
              <div className="lk-made">
                <div className="w-sheet-cheer">
                  <Art name="kovi-key" size={104} />
                  <Art name="sparkle-4" size={22} className="w-spark w-spark-1" />
                  <Art name="sparkle-8" size={26} className="w-spark w-spark-2" />
                </div>
                <h2>Your link is ready</h2>
                <p>
                  {formatUsd(made.amount)} is waiting in it. Whoever opens it can claim it, with or
                  without Kova.
                </p>
                <div className="lk-made-link">
                  <Icon name="link" size={16} />
                  <span>{made.url.replace(/^https?:\/\//, '').split('#')[0]}</span>
                  <CopyButton text={made.url} />
                </div>
                <div className="lk-made-ways">
                  <button
                    type="button"
                    className="pill pill-block"
                    data-tone="ink"
                    onClick={async () => {
                      const share = (
                        navigator as Navigator & { share?: (data: ShareData) => Promise<void> }
                      ).share
                      const text = whats.slice(0, whats.lastIndexOf(made.url)).trim()
                      const title = `${firstName} sent you money`
                      if (share)
                        await share.call(navigator, { title, text, url: made.url }).catch(() => {})
                      else await navigator.clipboard.writeText(whats).catch(() => {})
                    }}
                  >
                    <span className="pill-label">Share link</span>
                    <span className="pill-cap">
                      <Icon name="share" size={18} />
                    </span>
                  </button>
                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(whats)}`}
                    className="pill pill-block lk-whatsapp"
                    data-tone="light"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className="pill-label">Send on WhatsApp</span>
                    <span className="pill-cap">
                      <Icon name="whatsapp" size={18} />
                    </span>
                  </a>
                </div>
                <p className="w-fine w-center">
                  Anyone with this link can claim the dollars, so send it only to them. Not
                  claimed? Take it back from Your links.
                </p>
                <div className="lk-made-end">
                  <Link href="/wallet/links" className="textlink">
                    Your links
                  </Link>
                  <button type="button" className="textlink" onClick={close}>
                    Done
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </Fit>
      </div>
    </>
  )
}

function recordProblem(error: unknown) {
  const why = error instanceof Error && error.message ? ` (${error.message})` : ''
  return `The dollars are in the link, but Kova couldn’t save it${why}. Try again: they won’t move twice.`
}
