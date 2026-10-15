'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Art, Icon, Pill } from '@/components/brand'
import type { Terminal, TerminalPairing } from '@/lib/api'

type State =
  | { kind: 'loading' }
  | { kind: 'code'; pairing: TerminalPairing; qr: string }
  | { kind: 'paired'; terminal: Terminal }
  | { kind: 'problem'; message: string }

function remaining(iso: string) {
  const s = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 1000))
  return { s, text: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
}

/**
 * Add a terminal: a one-time code, typed or scanned on the phone. The sheet watches for the
 * phone to redeem it and turns into a welcome for the new terminal.
 */
export function PairSheet({
  known,
  onPaired,
  onClose,
}: {
  known: string[]
  onPaired: (terminals: Terminal[]) => void
  onClose: () => void
}) {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [, setTick] = useState(0)
  const close = useRef<HTMLButtonElement>(null)
  const before = useRef(new Set(known))
  // The dashboard re-renders every poll; keep its callbacks in refs so the code isn't remade.
  const handlers = useRef({ onPaired, onClose })
  handlers.current = { onPaired, onClose }

  const fresh = useCallback(async () => {
    setState({ kind: 'loading' })
    try {
      const response = await fetch('/api/terminals/pairing', { method: 'POST' })
      const body = (await response.json()) as TerminalPairing & { error?: string }
      if (!response.ok) throw new Error(body.error ?? 'Could not create a code')
      const { toString: toSvg } = await import('qrcode')
      const qr = await toSvg(body.link, {
        type: 'svg',
        margin: 0,
        color: { dark: '#0b1a1d', light: '#ffffff' },
      })
      setState({ kind: 'code', pairing: body, qr })
    } catch (error) {
      setState({
        kind: 'problem',
        message: error instanceof Error ? error.message : 'Could not create a code',
      })
    }
  }, [])

  useEffect(() => {
    void fresh()
    close.current?.focus()
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && handlers.current.onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fresh])

  // While a code is showing, count it down and watch for the phone that redeems it.
  useEffect(() => {
    if (state.kind !== 'code') return
    let cancelled = false
    const id = setInterval(async () => {
      setTick((n) => n + 1)
      try {
        const response = await fetch('/api/terminals')
        if (!response.ok) return
        const list = (await response.json()) as Terminal[]
        const added = list.find((t) => !before.current.has(t.id))
        if (added && !cancelled) {
          handlers.current.onPaired(list)
          setState({ kind: 'paired', terminal: added })
        }
      } catch {
        /* the next poll will catch up */
      }
    }, 1000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [state.kind])

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a backdrop click is a mouse shortcut; Escape and the Close button close the sheet from the keyboard
    <div
      className="overlay"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="pair-title">
        <button
          ref={close}
          type="button"
          className="round sheet-close"
          aria-label="Close"
          onClick={onClose}
        >
          <Icon name="close" size={18} />
        </button>

        {state.kind === 'paired' ? (
          <div className="sheet-done" aria-live="polite">
            <Art name="kovi-cheer" size={150} />
            <h2 id="pair-title">{state.terminal.name} is ready</h2>
            <p className="sheet-lead">
              Payments it takes land on your dashboard the moment they settle.
            </p>
            <Pill icon="check" onClick={onClose}>
              Done
            </Pill>
          </div>
        ) : (
          <>
            <Art name="kovi-wave" size={84} className="sheet-art" />
            <h2 id="pair-title">Add a terminal</h2>
            <p className="sheet-lead">Any phone with Kova becomes a till for your shop.</p>
            <ol className="steps">
              <li>Open Kova on the phone, then Profile, then Kova Terminal.</li>
              <li>Scan this code, or type it in.</li>
            </ol>

            <div className="pairbox" aria-live="polite">
              {state.kind === 'code' ? (
                <>
                  <div
                    className="qr"
                    role="img"
                    aria-label="Pairing QR code"
                    // biome-ignore lint/security/noDangerouslySetInnerHtml: an SVG the qrcode package drew from our own link, not user HTML
                    dangerouslySetInnerHTML={{ __html: state.qr }}
                  />
                  <div>
                    {remaining(state.pairing.expires_at).s > 0 ? (
                      <>
                        <div className="code" role="img" aria-label={`Code ${state.pairing.code}`}>
                          {state.pairing.code
                            .replace('-', '')
                            .split('')
                            .map((ch, i) => (
                              // biome-ignore lint/suspicious/noArrayIndexKey: fixed six positions
                              <span key={i}>{ch}</span>
                            ))}
                        </div>
                        <p className="code-meta">
                          Works once, for {remaining(state.pairing.expires_at).text}.{' '}
                          <button type="button" onClick={fresh}>
                            New code
                          </button>
                        </p>
                      </>
                    ) : (
                      <p className="code-meta">
                        This code expired.{' '}
                        <button type="button" onClick={fresh}>
                          Get a new one
                        </button>
                      </p>
                    )}
                  </div>
                </>
              ) : state.kind === 'problem' ? (
                <p className="code-meta" style={{ gridColumn: '1 / -1' }}>
                  {state.message}.{' '}
                  <button type="button" onClick={fresh}>
                    Try again
                  </button>
                </p>
              ) : (
                <>
                  <div className="qr" style={{ background: 'var(--sunken)' }} />
                  <p className="code-meta">Making a code…</p>
                </>
              )}
            </div>
            <p className="code-meta" style={{ marginTop: '1rem' }}>
              The phone gets its own key, only for taking payments. Your shop key stays here.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
