'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Brand, Icon } from '@/components/brand'
import '@/styles/ussd-demo.css'
import type { PhoneKey, PhoneScreen } from './ussd-phone-3d'

// three.js only in the browser, and only once the page is up.
const Phone3D = dynamic(() => import('./ussd-phone-3d').then((m) => m.Phone3D), {
  ssr: false,
  loading: () => <div className="ud-3d ud-3d-loading" />,
})

/**
 * "Try Kova on a basic phone": a feature phone on the page, driving Kova's real USSD menu (the API's
 * services/ussd.ts) through /api/ussd-demo. The page stands in for the phone network: it sends what
 * a network sends (the session, the number, everything typed so far joined by "*") and shows the
 * menu Kova answers. The demo number, its pocket and the till's charge are real, on Monad testnet,
 * with test dollars.
 */

interface Till {
  id: string
  code: string
  shop: string
  item: string
  amount: string
}

interface Demo {
  phone: string
  pin: string
  dial: string
  pocket: string
  explorer: string
  expires_at: string
  till: Till
}

interface Text {
  at: number
  text: string
}

type Phase = 'idle' | 'busy' | 'session' | 'ended'

const KEYS: [string, string][] = [
  ['1', ''],
  ['2', 'abc'],
  ['3', 'def'],
  ['4', 'ghi'],
  ['5', 'jkl'],
  ['6', 'mno'],
  ['7', 'pqrs'],
  ['8', 'tuv'],
  ['9', 'wxyz'],
  ['*', ''],
  ['0', '+'],
  ['#', ''],
]

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/ussd-demo/${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
  const body = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? 'Kova didn’t answer. Try again.')
  return body
}

const pretty = (phone: string) => phone.replace(/^\+999(\d{3})(\d{3})(\d{3})$/, '+999 $1 $2 $3')
const sessionId = () => `s${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`

export function UssdDemo() {
  const [demo, setDemo] = useState<Demo | null>(null)
  const [starting, setStarting] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [dial, setDial] = useState('')
  const [input, setInput] = useState('')
  const [screen, setScreen] = useState('')
  const [texts, setTexts] = useState<Text[]>([])
  const [banner, setBanner] = useState<Text | null>(null)
  const [balance, setBalance] = useState<string | null>(null)
  const [paid, setPaid] = useState<string | null>(null)
  const [flat, setFlat] = useState(false)
  const [flash, setFlash] = useState<{ id: string; at: number } | null>(null)
  const parts = useRef<string[]>([])
  const session = useRef('')
  const since = useRef(0)

  const start = async () => {
    setStarting(true)
    setProblem(null)
    try {
      const fresh = await api<Demo>('start', { method: 'POST' })
      setDemo(fresh)
      setPhase('idle')
      setDial('')
      setTexts([])
      setPaid(null)
      since.current = 0
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That didn’t work. Try again.')
    } finally {
      setStarting(false)
    }
  }

  // The phone's texts, its balance and the till, as Kova sees them, every two seconds.
  useEffect(() => {
    if (!demo) return
    let live = true
    const read = async () => {
      try {
        const state = await api<{
          messages: Text[]
          balance: string
          till: { status: string; tx_hash: string | null } | null
        }>(
          `state?phone=${encodeURIComponent(demo.phone)}&till=${demo.till.id}&since=${since.current}`,
        )
        if (!live) return
        setBalance(state.balance)
        if (state.messages.length) {
          since.current = Math.max(...state.messages.map((m) => m.at))
          setTexts((old) => [...old, ...state.messages])
          setBanner(state.messages.at(-1) ?? null)
        }
        if (state.till?.status === 'paid') setPaid(state.till.tx_hash ?? '')
      } catch {
        // A missed read is not a failure; the next one catches up.
      }
    }
    void read()
    const timer = setInterval(read, 2000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [demo])

  // The 3D phone, unless motion is turned down or the browser has no WebGL: then the flat one.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setFlat(true)
  }, [])
  const goFlat = useCallback(() => setFlat(true), [])

  useEffect(() => {
    if (!banner) return
    const timer = setTimeout(() => setBanner(null), 4500)
    return () => clearTimeout(timer)
  }, [banner])

  const send = useCallback(
    async (text: string) => {
      if (!demo) return
      setPhase('busy')
      try {
        const { reply } = await api<{ reply: string }>('press', {
          method: 'POST',
          body: JSON.stringify({ session: session.current, phone: demo.phone, text }),
        })
        setScreen(reply.replace(/^(CON|END) /, ''))
        setPhase(reply.startsWith('CON') ? 'session' : 'ended')
      } catch (error) {
        setScreen(error instanceof Error ? error.message : 'Connection problem. Try again.')
        setPhase('ended')
      }
    },
    [demo],
  )

  const press = useCallback(
    (key: string) => {
      if (!demo || phase === 'busy') return
      if (phase === 'idle') setDial((d) => (d + key).slice(0, 20))
      else if (phase === 'session') setInput((v) => (v + key).slice(0, 20))
    },
    [demo, phase],
  )

  const call = useCallback(() => {
    if (!demo || phase === 'busy') return
    if (phase === 'ended') {
      setPhase('idle')
      setDial('')
      return
    }
    if (phase === 'idle') {
      if (dial !== demo.dial) {
        setScreen(dial ? `Unknown code.\nDial ${demo.dial}` : `Dial ${demo.dial}`)
        setPhase('ended')
        setDial('')
        return
      }
      session.current = sessionId()
      parts.current = []
      setInput('')
      void send('')
      return
    }
    if (!input) return
    parts.current = [...parts.current, input]
    setInput('')
    void send(parts.current.join('*'))
  }, [demo, phase, dial, input, send])

  const hangUp = useCallback(() => {
    setPhase('idle')
    setDial('')
    setInput('')
  }, [])

  const back = useCallback(() => {
    if (phase === 'idle') setDial((d) => d.slice(0, -1))
    else if (phase === 'session') setInput((v) => v.slice(0, -1))
  }, [phase])

  // The keyboard works too: digits, * and #, Enter to call or send, Backspace, Escape to hang up.
  useEffect(() => {
    if (!demo) return
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const at = performance.now()
      if (/^[0-9*#]$/.test(event.key)) {
        press(event.key)
        setFlash({ id: event.key, at })
      } else if (event.key === 'Enter') {
        call()
        setFlash({ id: 'call', at })
      } else if (event.key === 'Backspace') {
        back()
        setFlash({ id: 'back', at })
      } else if (event.key === 'Escape') {
        hangUp()
        setFlash({ id: 'end', at })
      } else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [demo, press, call, back, hangUp])

  const newTill = async () => {
    if (!demo) return
    try {
      const till = await api<Till>('till', { method: 'POST' })
      setDemo({ ...demo, till })
      setPaid(null)
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That didn’t work.')
    }
  }

  const asksPin = phase === 'session' && /PIN/.test(screen)
  const shown = asksPin ? '•'.repeat(input.length) : input

  /** What the 3D phone's LCD draws: the same screen the flat phone shows. */
  const lcd = useMemo<PhoneScreen>(() => {
    const status: [string, string, string] = ['Kova', balance ? `$${balance}` : '', '▮▮▮▯']
    const message = banner ? { title: 'New message', text: banner.text } : null
    if (!demo)
      return { status: ['', '', ''], lines: ['', 'Get a demo phone', 'to switch it on'], dim: true }
    if (phase === 'idle')
      return {
        status,
        lines: [pretty(demo.phone), '', dial || ' '],
        hint: `Dial ${demo.dial}`,
        banner: message,
      }
    if (phase === 'busy') return { status, lines: ['Running USSD code…'], banner: message }
    if (phase === 'session')
      return { status, lines: screen.split('\n'), input: shown, banner: message }
    return { status, lines: screen.split('\n'), hint: 'Press green to close', banner: message }
  }, [demo, phase, dial, screen, shown, balance, banner])

  const onKey = useCallback(
    (key: PhoneKey) => {
      if (key === 'call') call()
      else if (key === 'back') back()
      else if (key === 'end') hangUp()
      else press(key)
    },
    [call, back, hangUp, press],
  )

  return (
    <div className="ud">
      <header className="ud-nav">
        <Brand />
        <span className="ud-chip">
          <span aria-hidden="true" className="ud-dot" /> Test network · test dollars
        </span>
      </header>

      <main className="ud-main">
        <section className="ud-copy">
          <p className="ud-kicker">Kova by USSD</p>
          <h1 className="ud-title">
            Pay a shop from a <span>basic phone</span>
          </h1>
          <p className="ud-lead">
            No smartphone, no data, no app. Dial Kova’s code, enter your PIN, and the shop is paid
            on Monad in about a second. This phone on the page works exactly like one in your hand.
          </p>

          {demo ? (
            <ol className="ud-steps">
              <li>
                <b>Dial</b> <code>{demo.dial}</code> and press the green key.
              </li>
              <li>
                <b>Press 2</b> (Pay a till) and send.
              </li>
              <li>
                <b>Type the till’s code</b> <code>{demo.till.code}</code> and send.
              </li>
              <li>
                <b>Enter the PIN</b> <code>{demo.pin}</code> and send. Watch the till.
              </li>
            </ol>
          ) : (
            <div className="ud-start">
              <button type="button" className="ud-go" onClick={start} disabled={starting}>
                {starting ? 'Setting up your phone…' : 'Get a demo phone'}
                <Icon name="arrow" size={18} />
              </button>
              <p>
                You get a demo number with $5 of test dollars and a PIN. The number isn’t a real
                phone, and nothing here costs anything.
              </p>
              {problem ? <p className="ud-problem">{problem}</p> : null}
            </div>
          )}
          <p className="ud-fine">
            The menus, the PIN check and the payment are Kova’s real USSD system on Monad testnet.
            Only the phone network is replaced by this page. Want Kova on your own phone?{' '}
            <Link href="/try">Try it in a minute</Link>.
          </p>
        </section>

        <section className="ud-stage" aria-label="The demo phone and the shop's till">
          {!flat ? (
            <Phone3D screen={lcd} onKey={onKey} onFail={goFlat} flash={flash} />
          ) : (
            <div className={demo ? 'ud-phone' : 'ud-phone is-off'}>
              <div className="ud-speaker" aria-hidden="true" />
              <div className="ud-screen" aria-live="polite">
                {demo ? (
                  <>
                    <div className="ud-status">
                      <span>Kova</span>
                      <span>{balance ? `$${balance}` : '…'}</span>
                      <span aria-hidden="true">▮▮▮▯</span>
                    </div>
                    {banner ? (
                      <div className="ud-banner">
                        <b>New message</b>
                        <span>{banner.text}</span>
                      </div>
                    ) : null}
                    {phase === 'idle' ? (
                      <div className="ud-idle">
                        <span className="ud-num">{pretty(demo.phone)}</span>
                        <span className="ud-dial">{dial || ' '}</span>
                        <span className="ud-hint">Dial {demo.dial}</span>
                      </div>
                    ) : (
                      <div className="ud-reply">
                        <pre>{phase === 'busy' ? 'Running USSD code…' : screen}</pre>
                        {phase === 'session' ? (
                          <span className="ud-input">{shown || '_'}</span>
                        ) : null}
                        {phase === 'ended' ? (
                          <span className="ud-hint">Press green to close</span>
                        ) : null}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="ud-idle">
                    <span className="ud-hint">Get a demo phone to switch it on</span>
                  </div>
                )}
              </div>
              <div className="ud-soft">
                <button type="button" className="ud-call" onClick={call} aria-label="Call or send">
                  <Icon name="check" size={18} />
                </button>
                <button type="button" className="ud-del" onClick={back} aria-label="Delete">
                  C
                </button>
                <button type="button" className="ud-end" onClick={hangUp} aria-label="Hang up">
                  <Icon name="close" size={18} />
                </button>
              </div>
              <div className="ud-keys">
                {KEYS.map(([k, letters]) => (
                  <button key={k} type="button" onClick={() => press(k)} aria-label={k}>
                    <span>{k}</span>
                    <small>{letters}</small>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="ud-side">
            {demo ? (
              <div className={paid !== null ? 'ud-till is-paid' : 'ud-till'}>
                <span className="ud-till-shop">{demo.till.shop} · till</span>
                <span className="ud-till-item">{demo.till.item}</span>
                <strong className="ud-till-amount">${demo.till.amount}</strong>
                {paid !== null ? (
                  <>
                    <span className="ud-paid">
                      <Icon name="check" size={18} /> Paid
                    </span>
                    {paid ? (
                      <a href={`${demo.explorer}/tx/${paid}`} target="_blank" rel="noreferrer">
                        See it on Monad
                      </a>
                    ) : null}
                    <button type="button" className="ud-again" onClick={newTill}>
                      Another one
                    </button>
                  </>
                ) : (
                  <>
                    <span className="ud-till-label">Pay by USSD with code</span>
                    <span className="ud-till-code">{demo.till.code}</span>
                    <span className="ud-wait">Waiting for payment…</span>
                  </>
                )}
              </div>
            ) : null}
            {texts.length ? (
              <div className="ud-texts">
                <span className="ud-texts-title">Texts to this phone</span>
                {texts.map((t, i) => (
                  <p key={`${t.at}-${i}`}>{t.text}</p>
                ))}
              </div>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  )
}
