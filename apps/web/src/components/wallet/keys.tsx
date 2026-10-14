'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { type Address, getAddress, isAddress } from 'viem'
import { Icon, type IconName } from '@/components/brand'
import {
  answer,
  freeze,
  inviteSomeone,
  type KeyPayment,
  type KeysList,
  leftLine,
  limitLine,
  listKeys,
  newAgent,
  removeKey,
  type SpendKey,
  spendFrom,
  switchOn,
} from '@/lib/wallet/keys'
import { ScreenHead } from './activity'
import { short, useWallet } from './provider'
import { CopyButton, ShareButton } from './ui'

/**
 * Keys: everything that spends your dollars gets its own key. An allowance on Mum's phone, a
 * budget for someone at your till, an AI agent's key: each linked to your wallet through Kova's
 * card contract on Monad, which caps its day and stops it while frozen. One tap freezes any key.
 */

const kinds: {
  kind: 'allowance' | 'team' | 'agent'
  title: string
  icon: IconName
  empty: string
}[] = [
  {
    kind: 'allowance',
    title: 'Allowances',
    icon: 'gift',
    empty: 'Give someone dollars to spend, a day or a week at a time.',
  },
  {
    kind: 'team',
    title: 'Your team',
    icon: 'user',
    empty: 'Give someone at your shop a budget of their own.',
  },
  {
    kind: 'agent',
    title: 'AI agents',
    icon: 'bolt',
    empty: 'Let Claude or any AI agent pay, within limits you set.',
  },
]

const statusLine = (key: SpendKey) => {
  if (key.status === 'invited') return 'Invite sent. Waiting for them to accept.'
  if (key.status === 'accepted')
    return key.kind === 'agent'
      ? 'Ready to switch on.'
      : `${key.holder_name ?? 'They'} accepted. Switch it on.`
  if (key.status === 'frozen') return `Frozen · ${limitLine(key)}`
  return `${leftLine(key)} · ${limitLine(key)}`
}

export function useKeys() {
  const { profile } = useWallet()
  const [list, setList] = useState<KeysList | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const load = useCallback(async () => {
    if (!profile) return
    try {
      setList(await listKeys(profile.address))
      setProblem(null)
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Kova is unreachable.')
    }
  }, [profile])
  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), 8_000)
    return () => clearInterval(timer)
  }, [load])
  return { list, problem, load }
}

export function KeysScreen({ api }: { api: string }) {
  const { profile, signTypedData, signMessage } = useWallet()
  const { list, problem, load } = useKeys()
  const [making, setMaking] = useState<'allowance' | 'team' | 'agent' | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [token, setToken] = useState<{ name: string; token: string } | null>(null)
  if (!profile) return null
  const owner = profile.address as Address

  const act = async (id: string, run: () => Promise<unknown>) => {
    setBusy(id)
    setError(null)
    try {
      await run()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t go through.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="w-screen">
      <ScreenHead title="Keys" back="/wallet/profile" />
      <p className="w-lead">
        Everything that spends your dollars gets its own key. Monad enforces each limit, and one tap
        freezes any key. Your dollars stay in your wallet until a key spends them.
      </p>

      {error ? <p className="w-keys-problem">{error}</p> : null}
      {problem ? <p className="w-keys-problem">{problem}</p> : null}

      {token ? (
        <AgentToken name={token.name} token={token.token} api={api} onDone={() => setToken(null)} />
      ) : null}

      {list && list.approvals.length > 0 ? (
        <section className="w-keys">
          <h2 className="w-section">Waiting for you</h2>
          {list.approvals.map((p) => (
            <Approval key={p.id} payment={p} owner={owner} onDone={load} />
          ))}
        </section>
      ) : null}

      {list && list.received.length > 0 ? (
        <section className="w-keys">
          <h2 className="w-section">Given to you</h2>
          {list.received.map((k) => (
            <Received key={k.id} spendKey={k} onDone={load} />
          ))}
        </section>
      ) : null}

      {kinds.map((group) => {
        const keys = list?.data.filter((k) => k.kind === group.kind) ?? []
        return (
          <section key={group.kind} className="w-keys">
            <div className="w-section-row">
              <h2 className="w-section">{group.title}</h2>
              <button
                type="button"
                className="mini mini-ink"
                onClick={() => setMaking(making === group.kind ? null : group.kind)}
              >
                <Icon name="plus" size={14} />{' '}
                {group.kind === 'agent'
                  ? 'New agent key'
                  : group.kind === 'team'
                    ? 'Add someone'
                    : 'Give one'}
              </button>
            </div>
            {making === group.kind ? (
              group.kind === 'agent' ? (
                <AgentForm
                  owner={owner}
                  onMade={async (made) => {
                    setMaking(null)
                    await act(made.id, async () => {
                      const on = await switchOn(owner, made, signTypedData)
                      if (on.token) setToken({ name: made.name, token: on.token })
                    })
                  }}
                />
              ) : (
                <InviteForm
                  owner={owner}
                  ownerName={profile.name}
                  kind={group.kind}
                  onMade={load}
                />
              )
            ) : null}
            {list && keys.length === 0 && making !== group.kind ? (
              <p className="w-quiet">{group.empty}</p>
            ) : null}
            {keys.map((k) => (
              <div
                key={k.id}
                className={`w-keyrow${k.status === 'frozen' ? ' w-keyrow-frozen' : ''}`}
              >
                <span className="w-keyrow-icon">
                  <Icon name={group.icon} size={18} />
                </span>
                <span className="w-keyrow-text">
                  <strong>{k.name}</strong>
                  <small>{statusLine(k)}</small>
                  {k.kind === 'agent' && k.rules ? (
                    <small>
                      Up to ${k.rules.per_payment} a payment · asks you above ${k.rules.ask_above}
                    </small>
                  ) : null}
                </span>
                <span className="w-keyrow-actions">
                  {k.status === 'accepted' ? (
                    <button
                      type="button"
                      className="mini mini-ink"
                      disabled={busy === k.id}
                      onClick={() =>
                        void act(k.id, async () => {
                          const on = await switchOn(owner, k, signTypedData)
                          if (on.token) setToken({ name: k.name, token: on.token })
                        })
                      }
                    >
                      {busy === k.id ? 'Switching on…' : 'Switch on'}
                    </button>
                  ) : null}
                  {k.status === 'active' || k.status === 'frozen' ? (
                    <button
                      type="button"
                      className={`mini${k.status === 'frozen' ? ' mini-ink' : ''}`}
                      disabled={busy === k.id}
                      onClick={() =>
                        void act(k.id, () => freeze(owner, k, k.status !== 'frozen', signTypedData))
                      }
                    >
                      <Icon name="lock" size={14} />{' '}
                      {busy === k.id ? '…' : k.status === 'frozen' ? 'Unfreeze' : 'Freeze'}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="round w-keyrow-remove"
                    aria-label={`Remove ${k.name}`}
                    disabled={busy === k.id}
                    onClick={() =>
                      void act(k.id, () => removeKey(owner, k, signTypedData, signMessage))
                    }
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </span>
              </div>
            ))}
          </section>
        )
      })}

      <Link href="/wallet/profile" className="w-add-chain">
        <span>
          <strong>Kova Card</strong>
          <small>
            Tap to pay at any Kova till, with a daily limit you set. Link it in the Kova app.
          </small>
        </span>
        <Icon name="card" size={16} />
      </Link>

      <p className="w-fine">
        Keys spend through Kova’s card contract on Monad: it holds each key’s daily limit and
        whether it’s frozen, and every payment needs the key’s signature and Kova’s. Kova never
        holds your dollars.
      </p>
    </div>
  )
}

function InviteForm({
  owner,
  ownerName,
  kind,
  onMade,
}: {
  owner: Address
  ownerName: string
  kind: 'allowance' | 'team'
  onMade: () => void
}) {
  const [name, setName] = useState('')
  const [limit, setLimit] = useState(kind === 'team' ? '20' : '30')
  const [period, setPeriod] = useState<'day' | 'week'>(kind === 'team' ? 'day' : 'week')
  const [days, setDays] = useState(kind === 'team' ? 90 : 30)
  const [link, setLink] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (link)
    return (
      <div className="w-keyform">
        <strong>Send this link to {name}</strong>
        <small>
          Whoever opens it first accepts it on their own phone. Then you switch it on here.
        </small>
        <code className="w-keyform-link">{link}</code>
        <div className="w-keyform-actions">
          <CopyButton text={link} className="w-copy w-copy-ink" />
          <ShareButton
            title="Kova"
            label="Share the link"
            text={`${ownerName || 'Someone'} gave you ${kind === 'team' ? 'a budget' : 'an allowance'} on Kova`}
            url={link}
          />
        </div>
      </div>
    )
  return (
    <form
      className="w-keyform"
      onSubmit={(e) => {
        e.preventDefault()
        setBusy(true)
        setError(null)
        inviteSomeone(owner, { kind, name, limit, period, days, ownerName })
          .then((made) => {
            setLink(`${window.location.origin}/a/${made.code}`)
            onMade()
          })
          .catch((err: unknown) =>
            setError(err instanceof Error ? err.message : 'That didn’t work.'),
          )
          .finally(() => setBusy(false))
      }}
    >
      <label>
        <span>{kind === 'team' ? 'Who’s it for?' : 'Who’s it for?'}</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={kind === 'team' ? 'Tobi at the till' : 'Mum'}
          maxLength={40}
          required
        />
      </label>
      <div className="w-keyform-row">
        <label>
          <span>Up to</span>
          <input
            value={limit}
            onChange={(e) => setLimit(e.target.value.replace(/[^0-9.]/g, ''))}
            inputMode="decimal"
            required
          />
        </label>
        <fieldset className="w-filters w-keyform-period">
          <legend className="sr-only">Every</legend>
          {(['day', 'week'] as const).map((p) => (
            <button
              key={p}
              type="button"
              className={`w-filter${period === p ? ' w-filter-on' : ''}`}
              aria-pressed={period === p}
              onClick={() => setPeriod(p)}
            >
              a {p}
            </button>
          ))}
        </fieldset>
      </div>
      <label>
        <span>For</span>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>A week</option>
          <option value={30}>A month</option>
          <option value={90}>Three months</option>
          <option value={365}>A year</option>
        </select>
      </label>
      {error ? <p className="w-keys-problem">{error}</p> : null}
      <button
        type="submit"
        className="pill pill-block"
        data-tone="ink"
        disabled={busy || !name.trim() || !limit}
      >
        <span className="pill-label">{busy ? 'Making the link…' : 'Make the invite link'}</span>
        <span className="pill-cap">
          <Icon name="link" size={18} />
        </span>
      </button>
    </form>
  )
}

function AgentForm({ owner, onMade }: { owner: Address; onMade: (key: SpendKey) => void }) {
  const [name, setName] = useState('Claude')
  const [limit, setLimit] = useState('20')
  const [perPayment, setPerPayment] = useState('5')
  const [askAbove, setAskAbove] = useState('1')
  const [days, setDays] = useState(30)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <form
      className="w-keyform"
      onSubmit={(e) => {
        e.preventDefault()
        setBusy(true)
        setError(null)
        newAgent(owner, { name, limit, period: 'day', perPayment, askAbove, days })
          .then(onMade)
          .catch((err: unknown) =>
            setError(err instanceof Error ? err.message : 'That didn’t work.'),
          )
          .finally(() => setBusy(false))
      }}
    >
      <label>
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required />
      </label>
      <div className="w-keyform-row">
        <label>
          <span>Up to, a day</span>
          <input
            value={limit}
            onChange={(e) => setLimit(e.target.value.replace(/[^0-9.]/g, ''))}
            inputMode="decimal"
            required
          />
        </label>
        <label>
          <span>Most a payment</span>
          <input
            value={perPayment}
            onChange={(e) => setPerPayment(e.target.value.replace(/[^0-9.]/g, ''))}
            inputMode="decimal"
            required
          />
        </label>
      </div>
      <div className="w-keyform-row">
        <label>
          <span>Ask me above</span>
          <input
            value={askAbove}
            onChange={(e) => setAskAbove(e.target.value.replace(/[^0-9.]/g, ''))}
            inputMode="decimal"
            required
          />
        </label>
        <label>
          <span>For</span>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>A week</option>
            <option value={30}>A month</option>
            <option value={90}>Three months</option>
          </select>
        </label>
      </div>
      {error ? <p className="w-keys-problem">{error}</p> : null}
      <button
        type="submit"
        className="pill pill-block"
        data-tone="ink"
        disabled={busy || !name.trim()}
      >
        <span className="pill-label">{busy ? 'Making the key…' : 'Make it and switch it on'}</span>
        <span className="pill-cap">
          <Icon name="key" size={18} />
        </span>
      </button>
      <small className="w-fine">
        Your passkey signs the key’s limit onto Monad. Kova pays the network fee.
      </small>
    </form>
  )
}

function AgentToken({
  name,
  token,
  api,
  onDone,
}: {
  name: string
  token: string
  api: string
  onDone: () => void
}) {
  const line = `claude mcp add --transport http kova ${api.replace(/\/$/, '')}/mcp --header "Authorization: Bearer ${token}"`
  return (
    <section className="w-keyform w-keyform-token">
      <strong>{name}’s key is on</strong>
      <small>
        Copy this now: Kova shows the token once. In Claude Code, this one line connects it.
      </small>
      <code className="w-keyform-link">{line}</code>
      <div className="w-keyform-actions">
        <CopyButton text={line} className="w-copy w-copy-ink" />
        <button type="button" className="mini" onClick={onDone}>
          Done
        </button>
      </div>
    </section>
  )
}

export function Approval({
  payment,
  owner,
  onDone,
}: {
  payment: KeyPayment
  owner: Address
  onDone: () => void
}) {
  const { signMessage } = useWallet()
  const [busy, setBusy] = useState<'approve' | 'decline' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const go = (decision: 'approve' | 'decline') => {
    setBusy(decision)
    setError(null)
    answer(owner, payment, decision, signMessage)
      .then(onDone)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'That didn’t go through.'))
      .finally(() => setBusy(null))
  }
  return (
    <div className="w-approval">
      <span className="w-keyrow-icon w-keyrow-icon-coral">
        <Icon name="bolt" size={18} />
      </span>
      <span className="w-keyrow-text">
        <strong>
          {payment.key_name ?? 'An agent'} wants to pay ${payment.amount}
        </strong>
        <small>To {payment.description ?? short(payment.to)}</small>
        {error ? <small className="w-keys-problem">{error}</small> : null}
      </span>
      <span className="w-keyrow-actions">
        <button
          type="button"
          className="mini"
          disabled={busy !== null}
          onClick={() => go('decline')}
        >
          {busy === 'decline' ? '…' : 'Decline'}
        </button>
        <button
          type="button"
          className="mini mini-ink"
          disabled={busy !== null}
          onClick={() => go('approve')}
        >
          {busy === 'approve' ? 'Paying…' : 'Approve'}
        </button>
      </span>
    </div>
  )
}

export function Received({ spendKey, onDone }: { spendKey: SpendKey; onDone?: () => void }) {
  const { profile, signMessage } = useWallet()
  const [open, setOpen] = useState(false)
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<KeyPayment | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (!profile) return null
  const from = spendKey.owner_name ?? short(spendKey.owner)
  return (
    <div className={`w-allowance${spendKey.frozen ? ' w-allowance-frozen' : ''}`}>
      <div className="w-allowance-top">
        <span className="w-keyrow-icon w-keyrow-icon-light">
          <Icon name="gift" size={18} />
        </span>
        <span className="w-keyrow-text">
          <small>{spendKey.kind === 'team' ? `Budget from ${from}` : `From ${from}`}</small>
          <strong>{spendKey.frozen ? 'Frozen for now' : leftLine(spendKey)}</strong>
          <small>{limitLine(spendKey)}</small>
        </span>
        {spendKey.frozen ? null : (
          <button type="button" className="mini mini-ink" onClick={() => setOpen(!open)}>
            Spend
          </button>
        )}
      </div>
      {open ? (
        done ? (
          <p className="w-allowance-done">
            <Icon name="check" size={16} /> Paid ${done.amount}.{' '}
            {done.tx_hash ? (
              <a
                href={`https://testnet.monadscan.com/tx/${done.tx_hash}`}
                target="_blank"
                rel="noreferrer"
              >
                See it on Monad
              </a>
            ) : null}
          </p>
        ) : (
          <form
            className="w-keyform"
            onSubmit={(e) => {
              e.preventDefault()
              setBusy(true)
              setError(null)
              const charge = /\bpi_[0-9a-z]{26}\b/.exec(to)?.[0]
              spendFrom(
                spendKey,
                profile.address as Address,
                charge ? { charge } : { to: getAddress(to), amount },
                signMessage,
              )
                .then((paid) => {
                  setDone(paid)
                  onDone?.()
                })
                .catch((err: unknown) =>
                  setError(err instanceof Error ? err.message : 'That didn’t go through.'),
                )
                .finally(() => setBusy(false))
            }}
          >
            <label>
              <span>Pay</span>
              <input
                value={to}
                onChange={(e) => setTo(e.target.value.trim())}
                placeholder="0x… their address, or a shop’s pay link"
                required
              />
            </label>
            {/\bpi_[0-9a-z]{26}\b/.test(to) ? null : (
              <label>
                <span>How much</span>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                  inputMode="decimal"
                  placeholder="0.00"
                  required
                />
              </label>
            )}
            {error ? <p className="w-keys-problem">{error}</p> : null}
            <button
              type="submit"
              className="pill pill-block"
              data-tone="ink"
              disabled={busy || !(/\bpi_[0-9a-z]{26}\b/.test(to) || (isAddress(to) && amount))}
            >
              <span className="pill-label">
                {busy
                  ? 'Paying…'
                  : `Pay from ${from}’s ${spendKey.kind === 'team' ? 'budget' : 'allowance'}`}
              </span>
              <span className="pill-cap">
                <Icon name="send" size={18} />
              </span>
            </button>
          </form>
        )
      ) : null}
    </div>
  )
}

/** On Home: what's waiting for your yes, and allowances you were given. */
export function KeysOnHome() {
  const { profile } = useWallet()
  const { list, load } = useKeys()
  if (!profile || !list) return null
  if (list.approvals.length === 0 && list.received.length === 0) return null
  return (
    <div className="w-keys-home">
      {list.approvals.slice(0, 2).map((p) => (
        <Approval key={p.id} payment={p} owner={profile.address as Address} onDone={load} />
      ))}
      {list.received.map((k) => (
        <Received key={k.id} spendKey={k} onDone={load} />
      ))}
    </div>
  )
}
