'use client'

import Link from 'next/link'
import QRCode from 'qrcode'
import { useEffect, useRef, useState } from 'react'
import { Art, type ArtName, Icon } from '@/components/brand'
import {
  baseToNumber,
  currencyInfo,
  type DisplayCurrency,
  formatLocal,
  formatUsd,
  type Key,
  type Rates,
} from '@/lib/wallet/money'
import { isOfflineTx } from '@/lib/wallet/offline'
import { type Entry, useWallet } from './provider'

/** FNV-1a over the lowercased address, as the app picks faces: the same person looks the same everywhere. */
function hash(text: string) {
  let h = 0x811c9dc5
  for (const c of text.toLowerCase()) {
    h ^= c.charCodeAt(0)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

const FACES: ArtName[] = [
  'avatar-1',
  'avatar-2',
  'avatar-3',
  'avatar-4',
  'avatar-5',
  'avatar-6',
  'avatar-7',
]

export function Avatar({ name, id, size = 56 }: { name: string; id?: string; size?: number }) {
  return (
    <Art
      name={FACES[hash(id || name || '?') % FACES.length] ?? 'avatar-1'}
      size={size}
      className="w-face"
      alt=""
    />
  )
}

/** A face with a small lock on it: the person in a private payment. */
export function LockedFace({ name, id, size = 40 }: { name: string; id?: string; size?: number }) {
  return (
    <span className="w-face-locked" style={{ width: size, height: size }}>
      {id ? (
        <Avatar name={name} id={id} size={size} />
      ) : (
        <span className="w-face w-face-unknown" style={{ width: size, height: size }}>
          <Icon name="user" size={Math.round(size * 0.45)} />
        </span>
      )}
      <span className="w-face-lock" aria-hidden="true">
        <Icon name="lock" size={Math.max(10, Math.round(size * 0.25))} />
      </span>
    </span>
  )
}

/** What a payment's row is called: who, as for any payment; a private one says so on the line below. */
export function entryTitle(entry: Entry): string {
  if (entry.name) return entry.name
  return entry.oneTime ? (entry.kind === 'received' ? 'Someone' : 'Sent privately') : entry.name
}

/** What a private row says after "Private": their note, or where it stands now. Nothing if that's all. */
function privateDetail(entry: Entry): string | null {
  const note = entry.locked ? 'Sealed note' : entry.private ? `“${entry.detail}”` : null
  if (entry.unconfirmed) return note ? `Unconfirmed sender, ${note}` : 'Unconfirmed sender'
  if (note) return note
  if (entry.kind === 'received') return entry.waiting ? null : entry.detail
  return /^(Sent privately|Sent)$/.test(entry.detail) ? null : entry.detail
}

export function EntryBadge({ entry, size = 40 }: { entry: Entry; size?: number }) {
  if (entry.oneTime) return <LockedFace name={entry.name} id={entry.address} size={size} />
  if (entry.kind === 'paid') return <Art name="badge-shop" size={size} className="w-face" />
  if (entry.kind === 'added') return <Art name="badge-add" size={size} className="w-face" />
  if (entry.link)
    return (
      <span className="w-face w-entry-link" style={{ width: size, height: size }}>
        <Icon name="link" size={Math.round(size * 0.45)} />
      </span>
    )
  return <Avatar name={entry.name} id={entry.address} size={size} />
}

const verbs = { paid: 'Paid', sent: 'Sent', received: 'Received', added: 'Added' } as const

export function when(at: number): string {
  const d = new Date(at)
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (d.toDateString() === new Date().toDateString()) return time
  if (d.toDateString() === new Date(Date.now() - 86_400_000).toDateString())
    return `Yesterday, ${time}`
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

export const incoming = (entry: Entry) => entry.kind === 'received' || entry.kind === 'added'

export function signed(entry: Entry) {
  const amount = BigInt(entry.amount)
  return incoming(entry) ? formatUsd(amount, { sign: true }) : formatUsd(-amount)
}

/** No signal: a payment signed on a phone with no connection, settled later. */
export function NoSignal({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 8.8a14 14 0 0 1 4.3-2.7" />
      <path d="M11 5.2a14 14 0 0 1 10.5 3.6" />
      <path d="M5.8 12.4a9 9 0 0 1 3.5-2" />
      <path d="M15 10.8a9 9 0 0 1 3.2 1.6" />
      <path d="M9.2 15.7a4.5 4.5 0 0 1 5.6 0" />
      <path d="M12 19.5h.01" />
      <path d="M3.5 3.5l17 17" />
    </svg>
  )
}

/** One line of money: who, what, when, and how much, signed by direction. */
export function EntryRow({ entry }: { entry: Entry }) {
  const offline = isOfflineTx(entry.txHash)
  // Sent, received or paid privately: like any other row, with a lock and "Private" leading the line.
  const privately = Boolean(entry.oneTime || entry.fromPrivate)
  const said = privately ? privateDetail(entry) : null
  return (
    <Link
      href={`/wallet/activity/${encodeURIComponent(entry.id)}`}
      className="w-entry"
      aria-label={`${verbs[entry.kind]} ${formatUsd(BigInt(entry.amount))}${privately ? ' privately' : ''}, ${entryTitle(entry)}`}
    >
      <EntryBadge entry={entry} />
      <span className="w-entry-text">
        <span className="w-entry-name">{entryTitle(entry)}</span>
        <span className="w-entry-sub">
          {privately || entry.private || entry.locked ? <Icon name="lock" size={12} /> : null}
          {privately ? (
            <>
              <span className="w-entry-private">Private</span>
              {said ? ` · ${said}` : ''}
            </>
          ) : offline ? (
            <span className="w-offline-tag">
              <NoSignal size={12} />
              Offline payment
            </span>
          ) : entry.unconfirmed ? (
            `Unconfirmed sender, ${entry.detail}`
          ) : (
            entry.detail
          )}
          , {when(entry.at)}
        </span>
      </span>
      <span className={`w-entry-amount${incoming(entry) ? ' w-in' : ''}`}>{signed(entry)}</span>
    </Link>
  )
}

/**
 * The balance, first thing on Home: dollars as the headline, the sign and cents set small and
 * raised like a price tag, the local amount as a chip, and one tap to hide it all.
 */
export function BalanceCard() {
  const {
    balance: actual,
    profile,
    rates,
    hideBalance,
    setHideBalance,
    privateBalance,
    privateUnchecked,
  } = useWallet()
  // One balance: dollars sent to you privately count in it the moment they're found.
  const total = actual === null ? null : actual + privateBalance
  const balance = useCounted(total)
  const usd = balance === null ? null : formatUsd(balance)
  const [whole, cents] =
    usd === null ? ['—', ''] : [usd.slice(1, usd.lastIndexOf('.')), usd.slice(usd.lastIndexOf('.'))]
  const currency = profile?.currency ?? 'USD'
  const hasPrivate = privateBalance > 0n
  /** The split, shown on a tap of the amount: how much of it is private. */
  const [split, setSplit] = useState(false)
  const splitShown = split && hasPrivate
  return (
    <section
      className="w-balance"
      aria-label={
        hideBalance
          ? 'Balance hidden'
          : `Available ${usd ?? 'loading'}${hasPrivate ? `, ${formatUsd(privateBalance)} of it private` : ''}`
      }
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
      <span className="w-balance-coins" aria-hidden="true">
        <Art name="coin-usd" size={44} className="w-coin w-coin-front" />
        <Art name="coin-eur" size={34} className="w-coin w-coin-back" />
      </span>
      <div className="w-balance-top">
        <button
          type="button"
          className="w-balance-label"
          onClick={() => setHideBalance(!hideBalance)}
          aria-label={hideBalance ? 'Show balance' : 'Hide balance'}
        >
          Available to spend <Icon name={hideBalance ? 'eyeOff' : 'eye'} size={16} />
        </button>
        <Link href="/wallet/add" className="w-balance-add">
          <Icon name="plus" size={14} /> Add
        </Link>
      </div>
      {hasPrivate ? (
        <button
          type="button"
          className="w-balance-amount w-balance-amount-tap"
          aria-expanded={splitShown}
          aria-label={splitShown ? 'Hide how much is private' : 'Show how much is private'}
          onClick={() => setSplit(!split)}
        >
          <BalanceFigure hidden={hideBalance} whole={whole} cents={cents} />
          {splitShown ? null : (
            <span className="w-balance-hint" aria-hidden="true">
              <Icon name="lock" size={13} />
            </span>
          )}
        </button>
      ) : (
        <p className="w-balance-amount">
          <BalanceFigure hidden={hideBalance} whole={whole} cents={cents} />
        </p>
      )}
      {splitShown ? (
        <Link href="/wallet/private" className="w-chip w-chip-private w-balance-split">
          <Icon name="lock" size={13} />
          {hideBalance ? '•••• of it private' : `${formatUsd(privateBalance)} of it private`}
          <Icon name="arrow" size={13} />
        </Link>
      ) : null}
      <div className="w-balance-chips">
        {balance !== null && currency !== 'USD' ? (
          <span className="w-chip">
            {hideBalance ? '≈ ••••' : `≈ ${formatLocal(baseToNumber(balance), currency, rates)}`}
          </span>
        ) : null}
        {privateUnchecked ? <CheckPrivateChip /> : null}
      </div>
    </section>
  )
}

/** The amount itself: dollars large, the sign and cents small and raised, or dots when hidden. */
function BalanceFigure({
  hidden,
  whole,
  cents,
}: {
  hidden: boolean
  whole: string
  cents: string
}) {
  return hidden ? (
    <span className="w-balance-hidden">••••••</span>
  ) : (
    <>
      <span className="w-balance-sign">$</span>
      <span className="w-balance-whole">{whole}</span>
      <span className="w-balance-cents">{cents}</span>
    </>
  )
}

/**
 * The balance as it is shown: when it changes it counts to the new amount (about 0.7 s, easing
 * out) instead of jumping, so money leaving or arriving is something you see happen, even from
 * behind the send sheet. The first value, and any change with reduced motion, shows at once.
 */
function useCounted(balance: bigint | null) {
  const [shown, setShown] = useState(balance)
  const from = useRef(balance)
  useEffect(() => {
    const start = from.current
    from.current = balance
    if (
      balance === null ||
      start === null ||
      start === balance ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return setShown(balance)
    let frame = 0
    const began = performance.now()
    const step = (now: number) => {
      const p = Math.min(1, (now - began) / 700)
      const eased = 1 - (1 - p) ** 3
      setShown(start + ((balance - start) * BigInt(Math.round(eased * 1000))) / 1000n)
      if (p < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [balance])
  return shown
}

/** Send and Request: an icon in a solid disc, a dotted path, and something travelling along it. */
export function ActionTile({ kind }: { kind: 'send' | 'request' }) {
  const send = kind === 'send'
  return (
    <Link
      href={send ? '/wallet/send' : '/wallet/request'}
      className={`w-tile ${send ? 'w-tile-send' : 'w-tile-request'}`}
      aria-label={send ? 'Send. Lands in seconds' : 'Request. Get paid by link'}
    >
      <svg
        className="w-tile-path"
        viewBox="0 0 140 96"
        preserveAspectRatio="xMaxYMin meet"
        aria-hidden="true"
      >
        <path
          d={send ? 'M40 30 C62 30 74 14 100 12' : 'M112 4 C112 18 90 22 66 30'}
          fill="none"
          stroke="var(--ink)"
          strokeWidth="1.8"
          strokeDasharray="1 5"
          strokeLinecap="round"
          opacity="0.55"
        />
      </svg>
      {send ? (
        <Art name="plane" size={46} className="w-tile-plane" />
      ) : (
        <Art name="coin-usd" size={26} className="w-tile-coin" />
      )}
      <span className="w-tile-disc">
        <Icon name={send ? 'send' : 'receive'} size={16} />
      </span>
      <span className="w-tile-label">{send ? 'Send' : 'Request'}</span>
    </Link>
  )
}

/** The app's keypad, for touch screens. On a keyboard, digits and Backspace type too. */
export function Keypad({ onKey, decimals = 2 }: { onKey: (key: Key) => void; decimals?: number }) {
  const layout: (Key | '')[] = [
    '1',
    '2',
    '3',
    '4',
    '5',
    '6',
    '7',
    '8',
    '9',
    decimals > 0 ? '.' : '',
    '0',
    'del',
  ]
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (/^[0-9]$/.test(event.key)) onKey(event.key as Key)
      else if ((event.key === '.' || event.key === ',') && decimals > 0) onKey('.')
      else if (event.key === 'Backspace') onKey('del')
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [onKey, decimals])
  return (
    <div className="w-keypad">
      {layout.map((key) =>
        key === '' ? (
          <span key="gap" />
        ) : (
          <button
            key={key}
            type="button"
            className="w-key"
            onClick={() => onKey(key)}
            aria-label={key === 'del' ? 'Delete' : key === '.' ? 'Point' : key}
          >
            {key === 'del' ? <Icon name="del" size={22} /> : key}
          </button>
        ),
      )}
    </div>
  )
}

/** A QR code, drawn as SVG in Kova's ink, shown as an image. */
export function QR({ value, size = 220, label }: { value: string; size?: number; label: string }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let live = true
    void QRCode.toString(value, {
      type: 'svg',
      margin: 0,
      errorCorrectionLevel: 'M',
      color: { dark: '#0b1a1d', light: '#ffffff' },
    }).then((svg) => live && setSrc(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`))
    return () => {
      live = false
    }
  }, [value])
  return (
    <span className="w-qr" style={{ width: size, height: size }}>
      {/* biome-ignore lint/performance/noImgElement: an SVG drawn in the browser, nothing to optimise */}
      {src ? <img src={src} alt={label} width={size} height={size} /> : null}
    </span>
  )
}

/** Copies text, and says so. */
export function CopyButton({
  text,
  label = 'Copy',
  className = 'w-copy',
}: {
  text: string
  label?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        await navigator.clipboard.writeText(text).catch(() => {})
        setCopied(true)
        setTimeout(() => setCopied(false), 1600)
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} size={15} /> {copied ? 'Copied' : label}
    </button>
  )
}

/** Shares with the system sheet where there is one, else copies. */
export function ShareButton({
  text,
  url,
  title,
  label,
}: {
  text: string
  url: string
  title: string
  label: string
}) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="pill pill-block"
      data-tone="ink"
      onClick={async () => {
        const share = (navigator as Navigator & { share?: (data: ShareData) => Promise<void> })
          .share
        if (share) {
          await share.call(navigator, { title, text, url }).catch(() => {})
          return
        }
        await navigator.clipboard.writeText(`${text} ${url}`).catch(() => {})
        setCopied(true)
        setTimeout(() => setCopied(false), 1600)
      }}
    >
      <span className="pill-label">{copied ? 'Link copied' : label}</span>
      <span className="pill-cap">
        <Icon name={copied ? 'check' : 'share'} size={18} />
      </span>
    </button>
  )
}

/** "about €184.00", when the person thinks in another currency. */
export function localAbout(usd: number, currency: DisplayCurrency, rates: Rates): string | null {
  return currency === 'USD' ? null : `about ${formatLocal(usd, currency, rates)}`
}

export const currencyLabel = (currency: DisplayCurrency) =>
  `${currencyInfo[currency].symbol} ${currencyInfo[currency].name}`

/**
 * Private payments only show once this wallet's keys have looked for them, and on the web the keys
 * live in memory: after a reload, while Kova has new ones to look through, the passkey checks.
 */
function CheckPrivateChip() {
  const { checkPrivate } = useWallet()
  const [state, setState] = useState<'idle' | 'checking' | 'failed'>('idle')
  return (
    <button
      type="button"
      className="w-chip w-chip-private"
      disabled={state === 'checking'}
      onClick={async () => {
        setState('checking')
        try {
          await checkPrivate()
          setState('idle')
        } catch (error) {
          const message = error instanceof Error ? error.message : ''
          setState(/cancel|not allowed|abort/i.test(message) ? 'idle' : 'failed')
        }
      }}
    >
      {state === 'checking' ? (
        <span className="spinner w-chip-spinner" aria-hidden="true" />
      ) : (
        <Icon name="lock" size={13} />
      )}
      {state === 'checking'
        ? 'Checking…'
        : state === 'failed'
          ? 'Couldn’t check. Try again'
          : 'Check for private dollars'}
    </button>
  )
}
