import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Prompt, PromptAnswer } from '../shared/types.js'
import { Fav, host, Icon, Logo, Monad, money, price, send, Word } from './common.js'
import './styles.css'

/**
 * Kova's own window for what a website asks: a budget when it connects, a payment from that budget,
 * or a pay-per-use price above the line. Opened by the background, never by the site; closing it
 * is a no.
 */

const id = new URLSearchParams(location.search).get('id') ?? ''

function App() {
  const [prompt, setPrompt] = useState<Prompt | null | undefined>(undefined)
  useEffect(() => {
    send<Prompt | null>({ type: 'prompt:get', id }).then(setPrompt, () => setPrompt(null))
  }, [])
  const answer = (a: PromptAnswer) => void send({ type: 'prompt:answer', id, answer: a })

  if (prompt === undefined)
    return (
      <div className="pop win loading">
        <span className="spin" />
      </div>
    )
  if (prompt === null)
    return (
      <div className="pop win">
        <Top />
        <div className="pad">
          <h2>This request has ended</h2>
          <p className="lead">Go back to the site and try again.</p>
        </div>
      </div>
    )
  if (prompt.kind === 'connect') return <Connect prompt={prompt} answer={answer} />
  if (prompt.kind === 'pay') return <Pay prompt={prompt} answer={answer} />
  return <PerUse prompt={prompt} answer={answer} />
}

function Top() {
  return (
    <div className="ph">
      <span className="mark">
        <Logo />
        <Word />
      </span>
      <span className="net">
        <Monad />
        Monad
      </span>
    </div>
  )
}

const LIMITS = ['5', '20', '50'] as const
const LINES = ['0.10', '0.50', '1'] as const

function Connect({
  prompt,
  answer,
}: {
  prompt: Extract<Prompt, { kind: 'connect' }>
  answer: (a: PromptAnswer) => void
}) {
  const perUse = prompt.reason === 'x402'
  const [limit, setLimit] = useState<string>(perUse ? '5' : '20')
  const [other, setOther] = useState('')
  const [period, setPeriod] = useState<'day' | 'week'>(perUse ? 'week' : 'day')
  const [line, setLine] = useState<string>('0.50')
  const chosen = limit === 'other' ? other : limit
  const valid = /^\d{1,5}(\.\d{1,2})?$/.test(chosen) && Number(chosen) >= 1
  const askAbove = Math.min(Number(line), Number(chosen) || 0).toFixed(2)

  return (
    <div className="pop win">
      <Top />
      <div className="pad">
        <div className="who">
          <Fav origin={prompt.origin} size={44} />
          <div>
            <b>
              {perUse && prompt.x402
                ? `${host(prompt.origin)} asks ${price(prompt.x402.amount)}`
                : `${host(prompt.origin)} wants to connect`}
            </b>
            <small>
              {perUse
                ? (prompt.x402?.description ?? 'Give it a budget to pay as you go')
                : 'Give it a budget, not your wallet'}
            </small>
          </div>
        </div>
        <div className="k top">It can spend up to</div>
        <div className="chips">
          {LIMITS.map((l) => (
            <button
              type="button"
              key={l}
              className={limit === l ? 'chip on' : 'chip'}
              onClick={() => setLimit(l)}
            >
              ${l}
            </button>
          ))}
          <button
            type="button"
            className={limit === 'other' ? 'chip on' : 'chip'}
            onClick={() => setLimit('other')}
          >
            Other
          </button>
        </div>
        {limit === 'other' ? (
          <label className="other">
            <span>$</span>
            <input
              inputMode="decimal"
              placeholder="30"
              value={other}
              onChange={(e) => setOther(e.target.value.replace(/[^\d.]/g, ''))}
              aria-label="Budget in dollars"
            />
          </label>
        ) : null}
        <fieldset className="seg" aria-label="How often it renews">
          <button
            type="button"
            aria-pressed={period === 'day'}
            className={period === 'day' ? 'on' : ''}
            onClick={() => setPeriod('day')}
          >
            A day
          </button>
          <button
            type="button"
            aria-pressed={period === 'week'}
            className={period === 'week' ? 'on' : ''}
            onClick={() => setPeriod('week')}
          >
            A week
          </button>
        </fieldset>
        {perUse ? (
          <>
            <div className="k top">Pay without asking up to</div>
            <div className="chips three">
              {LINES.map((l) => (
                <button
                  type="button"
                  key={l}
                  className={line === l ? 'chip on' : 'chip'}
                  onClick={() => setLine(l)}
                >
                  {price(l)}
                </button>
              ))}
            </div>
          </>
        ) : null}
        <ul className="pts">
          <li>
            <span className="ck">
              <Icon name="check" size={11} />
            </span>
            Up to {valid ? money(chosen, true) : '…'} a {period} from your Kova dollars, enforced on
            Monad.
          </li>
          <li>
            <span className="ck">
              <Icon name="check" size={11} />
            </span>
            It can’t see or move the rest of your balance.
          </li>
          <li>
            <span className="ck">
              <Icon name="check" size={11} />
            </span>
            Freeze or remove it any time, here or in the Kova app.
          </li>
        </ul>
      </div>
      <div className="bottom">
        <button
          type="button"
          className="pbtn ink"
          disabled={!valid}
          onClick={() => answer({ ok: true, limit: chosen, period, askAbove })}
        >
          Continue
        </button>
        <button type="button" className="pbtn soft" onClick={() => answer({ ok: false })}>
          Not now
        </button>
        <span className="fine">Next, your passkey switches the budget on at mykova.app.</span>
      </div>
    </div>
  )
}

function Pay({
  prompt,
  answer,
}: {
  prompt: Extract<Prompt, { kind: 'pay' }>
  answer: (a: PromptAnswer) => void
}) {
  const over = Number(prompt.amount) > Number(prompt.left)
  return (
    <div className="pop win">
      <Top />
      <div className="pad">
        <div className="who">
          <Fav origin={prompt.origin} size={44} />
          <div>
            <b>{host(prompt.origin)} asks to pay</b>
            <small>From its budget, in AUSD</small>
          </div>
        </div>
        <div className="big hero">{money(prompt.amount)}</div>
        <div className="rows">
          <div className="rw">
            <span>To</span>
            <b className="mono">
              {prompt.to.slice(0, 6)}…{prompt.to.slice(-4)}
            </b>
          </div>
          <div className="rw">
            <span>From its budget</span>
            <b>
              {money(prompt.left)} left
              <small>{prompt.period === 'week' ? 'this week' : 'today'}</small>
            </b>
          </div>
          <div className="rw">
            <span>Network fee</span>
            <b>$0.00 · Kova pays</b>
          </div>
        </div>
        {over ? (
          <p className="err">
            That’s more than this site has left. Raise its budget in Kova first.
          </p>
        ) : (
          <div className="guar">
            <Icon name="shield" />
            <span>
              Only this payment, to this address. If anything else would happen, it fails and
              nothing moves.
            </span>
          </div>
        )}
      </div>
      <div className="bottom">
        <button
          type="button"
          className="pbtn ink"
          disabled={over}
          onClick={() => answer({ ok: true })}
        >
          Pay {money(prompt.amount)}
        </button>
        <button type="button" className="pbtn soft" onClick={() => answer({ ok: false })}>
          Not this time
        </button>
      </div>
    </div>
  )
}

function PerUse({
  prompt,
  answer,
}: {
  prompt: Extract<Prompt, { kind: 'x402' }>
  answer: (a: PromptAnswer) => void
}) {
  const over = Number(prompt.amount) > Number(prompt.left)
  return (
    <div className="pop win">
      <Top />
      <div className="pad">
        <div className="who">
          <Fav origin={prompt.origin} size={44} />
          <div>
            <b>
              {host(prompt.origin)} asks {price(prompt.amount)}
            </b>
            <small>{prompt.description ?? 'To open this page'}</small>
          </div>
        </div>
        <div className="big hero">{price(prompt.amount)}</div>
        <div className="rows">
          <div className="rw">
            <span>From its budget</span>
            <b>
              {money(prompt.left)} left
              <small>{prompt.period === 'week' ? 'this week' : 'today'}</small>
            </b>
          </div>
          <div className="rw">
            <span>The site gets</span>
            <b>{prompt.token === 'USDC' ? 'USDC, paid by Kova' : 'AUSD'}</b>
          </div>
          <div className="rw">
            <span>Network fee</span>
            <b>$0.00</b>
          </div>
        </div>
        {over ? <p className="err">That’s more than this site has left.</p> : null}
      </div>
      <div className="bottom">
        <button
          type="button"
          className="pbtn ink"
          disabled={over}
          onClick={() => answer({ ok: true })}
        >
          Pay {price(prompt.amount)}
        </button>
        <button type="button" className="pbtn soft" onClick={() => answer({ ok: false })}>
          Not now
        </button>
      </div>
    </div>
  )
}

const root = document.getElementById('root')
if (root)
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
