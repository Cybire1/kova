'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { Art, Brand, Icon, Pill } from '@/components/brand'
import type { PaymentIntent } from '@/lib/api'
import { usd } from '@/lib/format'
import { cancelCharge } from '../actions'

type Stage = 'amount' | 'waiting' | 'paid' | 'problem'

const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'] as const

/** Keeps the typed amount valid as you type: at most one dot and two decimals. */
function applyKey(current: string, key: (typeof keys)[number]): string {
  if (key === 'del') return current.slice(0, -1)
  if (key === '.') return current.includes('.') ? current : current === '' ? '0.' : `${current}.`
  const next = current + key
  const [, decimals] = next.split('.')
  if (decimals && decimals.length > 2) return current
  if (next.replace('.', '').length > 9) return current
  return next.startsWith('0') && !next.startsWith('0.') ? next.slice(1) : next
}

/** "1234.5" as typed → "$1,234.5": grouped, but keeps what the person has typed so far. */
function typedDollars(typed: string) {
  if (typed === '') return '$0'
  const [whole, decimals] = typed.split('.')
  const grouped = Number(whole || '0').toLocaleString('en-US')
  return `$${grouped}${decimals !== undefined ? `.${decimals}` : ''}`
}

/** The web terminal: the same keypad, code and receipt as Kova Terminal on a phone. */
export function Charge() {
  const [stage, setStage] = useState<Stage>('amount')
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  const [intent, setIntent] = useState<PaymentIntent | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const canCharge = Number(amount || '0') > 0

  const start = useCallback(async () => {
    setError(null)
    setBusy(true)
    try {
      const response = await fetch('/api/charge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // One key per charge attempt: a double click or a retried request can't charge twice.
        body: JSON.stringify({
          amount: Number(amount).toFixed(2),
          reference: reference.trim() || undefined,
          idempotency_key: crypto.randomUUID(),
        }),
      })
      const body = (await response.json()) as PaymentIntent & { error?: string }
      if (response.status === 401) return window.location.assign('/signin?expired=1')
      if (!response.ok) throw new Error(body.error ?? 'Could not start the charge')
      const { toString: toSvg } = await import('qrcode')
      setQr(
        await toSvg(`${window.location.origin}/pay/${body.id}`, {
          type: 'svg',
          margin: 0,
          color: { dark: '#0b1a1d', light: '#ffffff' },
        }),
      )
      setIntent(body)
      setStage('waiting')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start the charge')
      setStage('problem')
    } finally {
      setBusy(false)
    }
  }, [amount, reference])

  // Type on a real keyboard too: digits, dot, backspace, Enter to charge.
  useEffect(() => {
    if (stage !== 'amount') return
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return
      if (/^[0-9.]$/.test(event.key))
        setAmount((v) => applyKey(v, event.key as (typeof keys)[number]))
      else if (event.key === 'Backspace') setAmount((v) => applyKey(v, 'del'))
      else if (event.key === 'Enter' && canCharge && !busy) void start()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stage, canCharge, busy, start])

  // While a charge is open, ask the API what happened to it.
  useEffect(() => {
    if (stage !== 'waiting' || !intent) return
    let cancelled = false
    const id = setInterval(async () => {
      try {
        const response = await fetch(`/api/intent/${intent.id}`)
        if (!response.ok) return
        const latest = (await response.json()) as PaymentIntent
        if (cancelled) return
        setIntent(latest)
        if (latest.status === 'paid') setStage('paid')
        if (['failed', 'expired', 'canceled', 'held'].includes(latest.status)) setStage('problem')
      } catch {
        /* keep waiting: a dropped poll is not a failed payment */
      }
    }, 1000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [stage, intent])

  const reset = () => {
    setAmount('')
    setReference('')
    setIntent(null)
    setQr(null)
    setError(null)
    setStage('amount')
  }

  const top = (
    <header className="topbar">
      <Brand label="Terminal" href="/dashboard" />
      <Link className="round" href="/dashboard" aria-label="Back to the dashboard">
        <Icon name="close" size={18} />
      </Link>
    </header>
  )

  if (stage === 'paid' && intent)
    return (
      <div className="terminal-screen" style={{ background: 'var(--paper)' }}>
        <main className="page page-narrow">
          {top}
          <section className="paid" aria-live="polite">
            <div className="receipt" style={{ marginTop: '3.5rem' }}>
              <Art name="scene-paid-terminal" size={304} />
              <div className="receipt-text">
                <small>PAID</small>
                <strong>{usd(intent.amount)}</strong>
              </div>
              <Art name="kovi-cheer" size={88} className="kovi-cheer" />
            </div>
            <h1>Paid</h1>
            <p>
              {usd(intent.amount)}
              {intent.reference ? ` for ${intent.reference}` : ''}, settled
            </p>
            <div className="paid-actions">
              <Pill icon="tap" onClick={reset}>
                Next charge
              </Pill>
              <Link className="textlink" href={`/dashboard/payments/${intent.id}`}>
                See this payment
              </Link>
            </div>
          </section>
        </main>
      </div>
    )

  if (stage === 'waiting' && intent)
    return (
      <div className="terminal-screen">
        <main className="page page-narrow">
          {top}
          <section className="await">
            <div className="await-card">
              <p className="await-amount">{usd(intent.amount)}</p>
              <p className="await-label">
                {intent.reference ?? 'Scan with Kova Pay or your own wallet'}
              </p>
              {qr ? (
                <div
                  className="qr qr-big"
                  role="img"
                  aria-label="Payment QR code"
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: an SVG the qrcode package drew from our own link, not user HTML
                  dangerouslySetInnerHTML={{ __html: qr }}
                />
              ) : null}
              <p className="waiting">
                <Icon name="tap" size={20} />
                Waiting for payment
              </p>
            </div>
            <button
              type="button"
              className="pill"
              data-tone="light"
              onClick={() => {
                // Close the charge on Kova too, so the code on screen can't be paid afterwards.
                void cancelCharge(intent.id)
                reset()
              }}
              style={{ marginTop: '0.5rem' }}
            >
              <span className="pill-label">Cancel</span>
              <span className="pill-cap">
                <Icon name="close" size={18} />
              </span>
            </button>
          </section>
        </main>
      </div>
    )

  if (stage === 'problem')
    return (
      <div className="terminal-screen">
        <main className="page page-narrow">
          {top}
          <div className="card notice" role="alert">
            <Art name="kovi-oops" size={130} />
            <h2>{error ? 'The charge didn’t start' : `This charge ${intent?.status}`}</h2>
            <p>{error ?? 'Nothing was taken. Start a new charge to try again.'}</p>
            <Pill onClick={reset} icon="refresh">
              Start again
            </Pill>
          </div>
        </main>
      </div>
    )

  return (
    <div className="terminal-screen">
      <main className="page page-narrow">
        {top}
        <section className="amount">
          <p
            className="amount-value"
            data-empty={amount === '' ? 'true' : undefined}
            aria-live="polite"
          >
            {typedDollars(amount)}
          </p>
          <p className="amount-sub">Customer pays {usd(amount || '0')}</p>
          <input
            className="amount-ref"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            placeholder="What’s it for? (optional)"
            maxLength={60}
            aria-label="What it’s for"
          />
        </section>

        <div className="keypad">
          {keys.map((key) => (
            <button
              key={key}
              type="button"
              className="key"
              data-plain={key === 'del' ? 'true' : undefined}
              onClick={() => setAmount((current) => applyKey(current, key))}
              aria-label={key === 'del' ? 'Delete' : key}
            >
              {key === 'del' ? <Icon name="del" size={26} /> : key}
            </button>
          ))}
        </div>

        <div className="pill-wide">
          <Pill icon="tap" disabled={!canCharge || busy} onClick={start}>
            {canCharge ? `Charge ${usd(amount)}` : 'Enter a price'}
          </Pill>
        </div>
      </main>
    </div>
  )
}
