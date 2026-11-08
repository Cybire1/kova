import { StrictMode, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { ApiPayment, PopupState, SiteView } from '../shared/types.js'
import { Fav, host, Icon, Logo, Monad, money, send, Word } from './common.js'
import './styles.css'

/**
 * Kova for Chrome's popup: the wallet's balance, the three things done most, and every website
 * that can spend, each with its budget, what it has spent and a switch. A site opens to its week.
 */

type View = { screen: 'home' } | { screen: 'site'; origin: string } | { screen: 'frozen' }

function Popup() {
  const [state, setState] = useState<PopupState | null>(null)
  const [view, setView] = useState<View>({ screen: 'home' })
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setState(await send<PopupState>({ type: 'state' }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kova didn’t answer.')
    }
  }, [])

  useEffect(() => {
    void load()
    const again = setInterval(() => void load(), 8000)
    return () => clearInterval(again)
  }, [load])

  if (!state)
    return (
      <div className="pop loading">
        {error ? <p className="err">{error}</p> : <span className="spin" />}
      </div>
    )
  if (!state.owner) return <FirstRun onDone={load} />
  if (view.screen === 'frozen')
    return <Frozen state={state} onBack={() => setView({ screen: 'home' })} />
  if (view.screen === 'site') {
    const site = state.sites.find((s) => s.origin === view.origin)
    if (site) return <Site site={site} onBack={() => setView({ screen: 'home' })} onChange={load} />
  }
  return (
    <Home
      state={state}
      onOpen={(origin) => setView({ screen: 'site', origin })}
      onFrozen={() => setView({ screen: 'frozen' })}
      onChange={load}
    />
  )
}

function FirstRun({ onDone }: { onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="pop first">
      <div className="first-body">
        <span className="mark">
          <Logo size={26} />
          <Word height={19} />
        </span>
        <img className="kovi" src="img/kovi-wave.webp" alt="" />
        <h1>Your dollars, in your browser</h1>
        <p>Sign in with your passkey: the same Face ID wallet as the Kova app. No seed phrase.</p>
      </div>
      <div className="bottom">
        {error ? <p className="err">{error}</p> : null}
        <button
          type="button"
          className="pbtn ink"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            setError(null)
            try {
              await send({ type: 'connect-wallet' })
              await onDone()
            } catch (e) {
              setError(e instanceof Error ? e.message : 'That didn’t work. Try again.')
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? 'Waiting for your passkey…' : 'Continue with passkey'}
        </button>
        <span className="fine">
          Opens mykova.app to sign in. Your key never leaves your device.
        </span>
      </div>
    </div>
  )
}

function Header({ state }: { state: PopupState }) {
  const [menu, setMenu] = useState(false)
  return (
    <div className="ph">
      <span className="mark">
        <Logo />
        <Word />
      </span>
      <span className="net">
        <Monad />
        {state.network}
      </span>
      <button
        type="button"
        className="av"
        aria-label="Wallet menu"
        onClick={() => setMenu((m) => !m)}
      >
        {(state.owner?.name || 'K').slice(0, 1).toUpperCase()}
      </button>
      {menu ? (
        <div className="menu" role="menu">
          <div className="menu-who">
            <b>{state.owner?.name || 'Your wallet'}</b>
            <small>
              {state.owner
                ? `${state.owner.address.slice(0, 6)}…${state.owner.address.slice(-4)}`
                : ''}
            </small>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => void send({ type: 'open', path: '/wallet' })}
          >
            <Icon name="ext" /> Open Kova
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              await send({ type: 'disconnect-wallet' })
              location.reload()
            }}
          >
            <Icon name="out" /> Disconnect this browser
          </button>
        </div>
      ) : null}
    </div>
  )
}

const periodWord = (p: string) => (p === 'week' ? 'this week' : 'today')
const pct = (spent: string, limit: string) => {
  const l = Number(limit)
  return l > 0 ? Math.min(100, (Number(spent) / l) * 100) : 0
}

function Home({
  state,
  onOpen,
  onFrozen,
  onChange,
}: {
  state: PopupState
  onOpen: (origin: string) => void
  onFrozen: () => void
  onChange: () => Promise<void>
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [whole, cents] = (
    state.balance === null ? '—' : money(state.balance).replace('$', '')
  ).split('.')
  const live = state.sites.filter((s) => s.status === 'active')

  const act = async (id: string, run: () => Promise<unknown>) => {
    setBusy(id)
    setError(null)
    try {
      await run()
      await onChange()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t go through.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="pop">
      <Header state={state} />
      <div className="bal">
        <small>Available</small>
        <div className="amt">
          <sup>$</sup>
          {whole}
          {cents ? <span>.{cents}</span> : null}
        </div>
        <button
          type="button"
          className="add"
          onClick={() => void send({ type: 'open', path: '/wallet/add' })}
        >
          <Icon name="plus" size={12} />
          Add
        </button>
        <img src="img/coin-usd.webp" alt="" />
      </div>
      <div className="acts">
        <button
          type="button"
          className="act coral"
          onClick={() => void send({ type: 'open', path: '/wallet/send' })}
        >
          <span className="ic">
            <Icon name="send" size={13} />
          </span>
          Send
        </button>
        <button
          type="button"
          className="act"
          onClick={() => void send({ type: 'open', path: '/wallet/receive' })}
        >
          <span className="ic">
            <Icon name="down" size={13} />
          </span>
          Receive
        </button>
        <button
          type="button"
          className="act"
          onClick={() => void send({ type: 'open', path: '/wallet/card' })}
        >
          <span className="ic">
            <Icon name="card" size={13} />
          </span>
          Card
        </button>
      </div>

      <div className="lbl">
        <span>
          {state.sites.length === 0
            ? 'No site can spend'
            : `${state.sites.length} ${state.sites.length === 1 ? 'site can' : 'sites can'} spend`}
        </span>
        {live.length > 0 ? (
          <button
            type="button"
            className="link"
            disabled={busy !== null}
            onClick={() =>
              void act('all', async () => {
                await send({ type: 'freeze-all' })
                onFrozen()
              })
            }
          >
            <Icon name="pause" size={13} />
            {busy === 'all' ? 'Freezing…' : 'Freeze all'}
          </button>
        ) : null}
      </div>

      {state.sites.length === 0 && state.connected.length === 0 ? (
        <div className="empty">
          <img src="img/kovi-key.webp" alt="" />
          <b>Give sites a budget, not your wallet</b>
          <span>
            Connect Kova on any Monad app. A site that wants to be paid gets its own limit, and you
            can freeze it any time.
          </span>
        </div>
      ) : state.sites.length === 0 ? null : (
        <div className="sites">
          {state.sites.map((s) => (
            <div key={s.origin} className="site">
              <button type="button" className="site-open" onClick={() => onOpen(s.origin)}>
                <Fav origin={s.origin} />
                <span>
                  <b>{s.name}</b>
                  <small>{line(s)}</small>
                </span>
              </button>
              <Switch
                site={s}
                busy={busy === s.origin}
                onToggle={(on) =>
                  void act(s.origin, () =>
                    send(
                      on
                        ? { type: 'unfreeze', origin: s.origin }
                        : { type: 'freeze', origin: s.origin },
                    ),
                  )
                }
                onSwitchOn={() =>
                  void act(s.origin, () => send({ type: 'switch-on', origin: s.origin }))
                }
              />
              <span className="bar">
                <i
                  className={pct(s.spent, s.limit) > 85 ? 'warn' : ''}
                  style={{ width: `${pct(s.spent, s.limit)}%` }}
                />
              </span>
            </div>
          ))}
        </div>
      )}
      {state.connected.length > 0 ? (
        <>
          <div className="lbl">
            <span>Connected, no budget</span>
          </div>
          <div className="sites">
            {state.connected.map((origin) => (
              <div key={origin} className="site">
                <span className="site-open">
                  <Fav origin={origin} />
                  <span>
                    <b>{host(origin)}</b>
                    <small>Sees your address · can’t spend</small>
                  </span>
                </span>
                <button
                  type="button"
                  className="link"
                  disabled={busy !== null}
                  onClick={() => void act(origin, () => send({ type: 'disconnect', origin }))}
                >
                  {busy === origin ? 'One moment…' : 'Disconnect'}
                </button>
              </div>
            ))}
          </div>
        </>
      ) : null}
      {error ? <p className="err pad">{error}</p> : null}
      <div className="foot">
        <Icon name="shield" />
        Every limit is enforced on Monad, not just in this app.
      </div>
    </div>
  )
}

function line(s: SiteView): string {
  if (s.status === 'accepted') return 'Waiting for your passkey to switch it on'
  if (s.status === 'frozen') return `Frozen · ${money(s.limit, true)} a ${s.period}`
  if (s.status === 'removed') return 'Removed'
  if (s.status === 'unknown') return 'Kova is unreachable'
  return `${money(s.spent)} of ${money(s.limit, true)} ${periodWord(s.period)}`
}

function Switch({
  site,
  busy,
  onToggle,
  onSwitchOn,
}: {
  site: SiteView
  busy: boolean
  onToggle: (on: boolean) => void
  onSwitchOn: () => void
}) {
  if (site.status === 'accepted')
    return (
      <button type="button" className="mini" disabled={busy} onClick={onSwitchOn}>
        {busy ? '…' : 'Switch on'}
      </button>
    )
  if (site.status !== 'active' && site.status !== 'frozen') return <span />
  const on = site.status === 'active'
  return (
    <button
      type="button"
      className={on ? 'sw' : 'sw off'}
      role="switch"
      aria-checked={on}
      aria-label={on ? `Freeze ${site.name}` : `Unfreeze ${site.name}`}
      disabled={busy}
      onClick={() => onToggle(!on)}
    />
  )
}

function Site({
  site,
  onBack,
  onChange,
}: {
  site: SiteView
  onBack: () => void
  onChange: () => Promise<void>
}) {
  const [payments, setPayments] = useState<ApiPayment[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    send<ApiPayment[]>({ type: 'payments', origin: site.origin }).then(setPayments, () =>
      setPayments([]),
    )
  }, [site.origin])

  const paid = (payments ?? []).filter((p) => p.status === 'paid')
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - (6 - i))
    const next = new Date(d)
    next.setDate(d.getDate() + 1)
    const total = paid
      .filter((p) => {
        const t = new Date(p.created_at)
        return t >= d && t < next
      })
      .reduce((sum, p) => sum + Number(p.amount), 0)
    return { label: d.toLocaleDateString('en-US', { weekday: 'narrow' }), total }
  })
  const top = Math.max(1, ...days.map((d) => d.total))

  const act = async (id: string, run: () => Promise<unknown>, after?: () => void) => {
    setBusy(id)
    setError(null)
    try {
      await run()
      await onChange()
      after?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t go through.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="pop">
      <div className="hd">
        <button type="button" className="back" aria-label="Back" onClick={onBack}>
          <Icon name="back" />
        </button>
        <Fav origin={site.origin} size={28} />
        <b>{site.name}</b>
        <span className={`tag ${site.status}`}>
          {site.status === 'active'
            ? 'Active'
            : site.status === 'frozen'
              ? 'Frozen'
              : site.status === 'accepted'
                ? 'Not on yet'
                : 'Off'}
        </span>
      </div>
      <div className="pad">
        <small className="k">Spent {periodWord(site.period)}</small>
        <div className="big">
          {money(site.spent)} <span>of {money(site.limit, true)}</span>
        </div>
        <div className="week">
          {days.map((d, i) => (
            <i
              key={d.label + String(i)}
              className={i === 6 ? 't' : ''}
              style={{
                height: `${Math.max(4, (d.total / top) * 100)}%`,
                animationDelay: `${i * 40}ms`,
              }}
            />
          ))}
        </div>
        <div className="days">
          {days.map((d, i) => (
            <span key={d.label + String(i)}>{d.label}</span>
          ))}
        </div>
        <div className="rows">
          {payments === null ? (
            <div className="rw">
              <span>Reading payments…</span>
            </div>
          ) : payments.length === 0 ? (
            <div className="rw">
              <span>No payments yet</span>
              <b>
                {money(site.limit, true)} a {site.period}
              </b>
            </div>
          ) : (
            payments.slice(0, 4).map((p) => (
              <div className="rw" key={p.id}>
                <span>
                  {p.kind === 'x402'
                    ? `Paid to use ${p.description ?? host(site.origin)}`
                    : `To ${p.to.slice(0, 6)}…${p.to.slice(-4)}`}
                </span>
                <b className={p.status === 'paid' ? '' : 'dim'}>
                  {p.status === 'paid'
                    ? `−${money(p.amount)}`
                    : p.status === 'refunded'
                      ? 'Refunded'
                      : p.status === 'denied'
                        ? 'Refused'
                        : p.status}
                  <small>
                    {new Date(p.created_at).toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </small>
                </b>
              </div>
            ))
          )}
          <div className="rw">
            <span>Pays per use without asking up to</span>
            <b>{money(site.askAbove)}</b>
          </div>
        </div>
        {error ? <p className="err">{error}</p> : null}
      </div>
      <div className="bottom two">
        {site.status === 'accepted' ? (
          <button
            type="button"
            className="pbtn ink"
            disabled={busy !== null}
            onClick={() => void act('on', () => send({ type: 'switch-on', origin: site.origin }))}
          >
            {busy === 'on' ? 'One moment…' : 'Switch on'}
          </button>
        ) : site.status === 'frozen' ? (
          <button
            type="button"
            className="pbtn ink"
            disabled={busy !== null}
            onClick={() => void act('un', () => send({ type: 'unfreeze', origin: site.origin }))}
          >
            {busy === 'un' ? 'One moment…' : 'Unfreeze'}
          </button>
        ) : (
          <button
            type="button"
            className="pbtn soft coral-text"
            disabled={busy !== null}
            onClick={() => void act('fr', () => send({ type: 'freeze', origin: site.origin }))}
          >
            <Icon name="snow" />
            {busy === 'fr' ? 'Freezing…' : 'Freeze'}
          </button>
        )}
        <button
          type="button"
          className="pbtn soft"
          disabled={busy !== null}
          onClick={() =>
            void act('rm', () => send({ type: 'remove', origin: site.origin }), onBack)
          }
        >
          <Icon name="trash" />
          {busy === 'rm' ? 'One moment…' : 'Remove'}
        </button>
      </div>
    </div>
  )
}

function Frozen({ state, onBack }: { state: PopupState; onBack: () => void }) {
  return (
    <div className="pop ice">
      <div className="hd">
        <button type="button" className="back" aria-label="Back" onClick={onBack}>
          <Icon name="back" />
        </button>
      </div>
      <div className="center pad">
        <div className="snow">
          <Icon name="snow" size={40} />
        </div>
        <h1>Everything is frozen</h1>
        <p>
          No site can spend a cent until you unfreeze it. Your dollars stay right where they are.
        </p>
        <div className="rows left">
          <div className="rw">
            <span>Sites paused</span>
            <b>{state.sites.filter((s) => s.status === 'frozen').length}</b>
          </div>
          <div className="rw">
            <span>Your balance</span>
            <b>{state.balance === null ? '—' : money(state.balance)}</b>
          </div>
        </div>
      </div>
      <div className="bottom">
        <button type="button" className="pbtn ink" onClick={onBack}>
          Back to sites
        </button>
        <span className="fine">Unfreeze a site from its switch. It asks for your passkey.</span>
      </div>
    </div>
  )
}

const root = document.getElementById('root')
if (root)
  createRoot(root).render(
    <StrictMode>
      <Popup />
    </StrictMode>,
  )
