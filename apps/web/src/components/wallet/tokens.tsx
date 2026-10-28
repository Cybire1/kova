'use client'

import {
  type ChainDepositQuote,
  exactTokenAmount,
  formatMon,
  formatTokenAmount,
  pendingTokenConversion,
  prepareTokenConversion,
  sendTokenConversion,
  type TokenArrival,
  type TokenConversionPlan,
  tokenConversionStatus,
  tokenInDollars,
  type WalletToken,
  worthMentioning,
} from '@kova/monad'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { isAddressEqual, parseUnits } from 'viem'
import { Art, Icon } from '@/components/brand'
import { monApi } from '@/lib/wallet/mon'
import { formatUsd } from '@/lib/wallet/money'
import {
  refreshTokens,
  relayTransfer,
  useTokenConversion,
  useTokenPreview,
  useTokenWatch,
  useWalletTokens,
} from '@/lib/wallet/tokens'
import { ScreenHead } from './activity'
import { useWallet } from './provider'
import '@/styles/tokens.css'

/**
 * Other tokens: USDC, USDT0, WETH and the rest of what a wallet can hold on Monad besides its
 * dollars. They show on Home, each arrival gets its moment like dollars do, and the ones Kova's
 * deposit route takes turn into dollars in a tap.
 */

/** A token's coin: its glyph on a drawn coin, teal for a dollar, coral for MON. */
function TokenCoin({ token, size = 40 }: { token: WalletToken; size?: number }) {
  return (
    <span
      className="w-tok-coin"
      data-worth={token.worth ?? 'other'}
      style={{ '--size': `${size}px` } as CSSProperties}
      aria-hidden="true"
    >
      {token.glyph}
    </span>
  )
}

/** "≈ $5.00", or "under $0.01" rather than a false "$0.00". */
const worthText = (worth: bigint) =>
  worth > 0n && worth < 10_000n ? 'under $0.01' : `≈ ${formatUsd(worth)}`

const canConvert = (convertible: WalletToken[], token: WalletToken) =>
  convertible.some((t) => isAddressEqual(t.address, token.address))

const convertHref = (token: WalletToken) =>
  `/wallet/tokens?convert=${encodeURIComponent(token.symbol)}`

/** Watches the wallet's other tokens and announces each arrival. Mounted once, with the wallet. */
export function TokenWatch() {
  useTokenWatch()
  useTokenPreview()
  const { arrival, convertible, dismissArrival } = useWalletTokens()
  return arrival ? (
    <TokenArrivalDialog
      key={arrival.id}
      arrival={arrival}
      convertible={canConvert(convertible, arrival.token)}
      onDismiss={dismissArrival}
    />
  ) : null
}

function TokenArrivalDialog({
  arrival,
  convertible,
  onDismiss,
}: {
  arrival: TokenArrival
  convertible: boolean
  onDismiss(): void
}) {
  const { hideBalance, monUsd } = useWallet()
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const node = dialog.current
    if (!node || node.open) return
    if (typeof node.showModal === 'function') node.showModal()
    else node.setAttribute('open', '')
    node.focus()
  }, [])
  const { token, amount } = arrival
  const worth = tokenInDollars(token, amount, monUsd)
  return (
    <dialog
      ref={dialog}
      tabIndex={-1}
      className="w-arrival w-tok-arrival"
      aria-labelledby="w-tok-arrival-title"
      aria-describedby="w-tok-arrival-detail"
      onCancel={(event) => {
        event.preventDefault()
        onDismiss()
      }}
    >
      <div className="w-arrival-top">
        <span className="w-arrival-chip">Just arrived</span>
        <button type="button" className="round" aria-label="Close" onClick={onDismiss}>
          <Icon name="close" size={20} />
        </button>
      </div>
      <div className="w-arrival-art" aria-hidden="true">
        {[12, 28, 47, 65, 82].map((left, index) => (
          <span
            key={left}
            className="w-arrival-coin"
            style={{ left: `${left}%`, animationDelay: `${index * 130}ms` }}
          >
            <TokenCoin token={token} size={30} />
          </span>
        ))}
        <Art name="kovi-catch" size={190} />
        <span className="w-arrival-yay">Yay!</span>
      </div>
      <h2 id="w-tok-arrival-title">
        {hideBalance ? token.symbol : `${formatTokenAmount(token, amount)} ${token.symbol}`} arrived
      </h2>
      {worth !== null && !hideBalance ? (
        <p className="w-arrival-amount">{worthText(worth)}</p>
      ) : null}
      <p id="w-tok-arrival-detail">
        {convertible
          ? `It’s in your wallet as ${token.symbol}. Turn it into dollars to pay with Kova, or keep it as it is.`
          : `It’s in your wallet as ${token.symbol}, apart from your dollars.`}
      </p>
      {convertible ? (
        <>
          <Link
            href={convertHref(token)}
            className="pill pill-block"
            data-tone="ink"
            onClick={onDismiss}
          >
            Turn into dollars <Icon name="arrow" size={18} />
          </Link>
          <button type="button" className="textlink" onClick={onDismiss}>
            Keep {token.symbol}
          </button>
        </>
      ) : (
        <>
          <button type="button" className="pill pill-block" data-tone="ink" onClick={onDismiss}>
            Done <Icon name="check" size={18} />
          </button>
          <Link className="textlink" href="/wallet/tokens" onClick={onDismiss}>
            See other tokens
          </Link>
        </>
      )}
    </dialog>
  )
}

/** Home: what else the wallet holds, a tap from turning it into dollars. Nothing when there's none. */
export function OtherTokensCard() {
  const { monUsd, hideBalance } = useWallet()
  const { held: all, convertible } = useWalletTokens()
  // Dust stays off Home; the Other tokens screen still lists it.
  const held = all.filter((h) => worthMentioning(h.token, h.amount))
  if (held.length === 0) return null
  return (
    <section className="w-tok-card" aria-labelledby="w-tok-card-title">
      <Link href="/wallet/tokens" className="w-tok-card-head">
        <span>
          <strong id="w-tok-card-title">Other tokens</strong>
          <small>In your wallet, apart from your dollars</small>
        </span>
        <Icon name="arrow" size={18} />
      </Link>
      <ul>
        {held.slice(0, 3).map(({ token, amount }) => {
          const worth = tokenInDollars(token, amount, monUsd)
          const convert = canConvert(convertible, token)
          return (
            <li key={token.address}>
              <Link href={convert ? convertHref(token) : '/wallet/tokens'} className="w-tok-row">
                <TokenCoin token={token} size={36} />
                <span className="w-tok-text">
                  <strong>
                    {hideBalance ? '••••' : formatTokenAmount(token, amount)} {token.symbol}
                  </strong>
                  <small>{worth !== null && !hideBalance ? worthText(worth) : token.name}</small>
                </span>
                {convert ? <span className="w-tok-chip">Turn into dollars</span> : null}
              </Link>
            </li>
          )
        })}
      </ul>
      {held.length > 3 ? (
        <Link href="/wallet/tokens" className="w-tok-more">
          See all {held.length}
        </Link>
      ) : null}
    </section>
  )
}

/** /wallet/tokens: every other token, and the way to turn each into dollars. */
export function OtherTokens() {
  const { profile, network, monUsd, hideBalance } = useWallet()
  const { ready, held, convertible } = useWalletTokens()
  const conversion = useTokenConversion()
  const asked = useSearchParams().get('convert')
  const [open, setOpen] = useState<string | null>(null)
  const answered = useRef(false)

  useEffect(() => {
    void refreshTokens()
  }, [])
  // Opened from an arrival or Home to convert one: straight to it, once it's known to convert.
  useEffect(() => {
    if (answered.current || !asked || conversion.pending) return
    const found = held.find((h) => h.token.symbol === asked && canConvert(convertible, h.token))
    if (!found) return
    answered.current = true
    setOpen(found.token.symbol)
  }, [asked, held, convertible, conversion.pending])

  const converting = open ? held.find((h) => h.token.symbol === open) : undefined
  if (profile && converting && canConvert(convertible, converting.token) && !conversion.pending)
    return (
      <ConvertToken
        key={converting.token.address}
        token={converting.token}
        held={converting.amount}
        onBack={() => setOpen(null)}
        onSent={(pending) => {
          conversion.remember(pending)
          setOpen(null)
        }}
      />
    )

  const kept = held.filter((h) => !canConvert(convertible, h.token)).map((h) => h.token.symbol)
  return (
    <div className="w-screen w-tok-screen">
      <ScreenHead title="Other tokens" />
      <p className="w-lead">
        Tokens in this wallet besides your dollars. Turn them into dollars to pay with Kova.
      </p>
      {conversion.pending ? <ConversionProgress {...conversion} /> : null}
      {!ready ? (
        <p className="w-quiet">Looking on Monad…</p>
      ) : held.length === 0 ? (
        <div className="w-tok-empty">
          <Art name="kovi-sleep" size={140} />
          <strong>No other tokens</strong>
          <p>
            {network === 'mainnet'
              ? 'When USDC, USDT0 or other tokens reach this wallet on Monad, they show up here.'
              : 'When test USDC reaches this wallet, it shows up here.'}
          </p>
        </div>
      ) : (
        <ul className="w-tok-list">
          {held.map(({ token, amount }) => {
            const worth = tokenInDollars(token, amount, monUsd)
            const action =
              !canConvert(convertible, token) || conversion.pending
                ? null
                : worthMentioning(token, amount)
                  ? 'convert'
                  : 'dust'
            return (
              <li key={token.address} className="w-tok-item">
                <div className="w-tok-row">
                  <TokenCoin token={token} />
                  <span className="w-tok-text">
                    <strong>
                      {hideBalance ? '••••' : formatTokenAmount(token, amount)} {token.symbol}
                    </strong>
                    <small>
                      {token.name}
                      {worth !== null && !hideBalance ? ` · ${worthText(worth)}` : ''}
                    </small>
                  </span>
                  {action === 'convert' ? (
                    <button
                      type="button"
                      className="w-tok-go"
                      onClick={() => setOpen(token.symbol)}
                    >
                      Turn into dollars
                    </button>
                  ) : action === 'dust' ? (
                    <small className="w-tok-dust">Too little to convert</small>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {ready && kept.length > 0 ? (
        <p className="w-fine">
          {network === 'mainnet'
            ? `Kova can’t turn ${list(kept)} into dollars yet, so ${kept.length === 1 ? 'it stays' : 'they stay'} in your wallet as ${kept.length === 1 ? 'it is' : 'they are'}.`
            : 'Turning tokens into dollars works on mainnet.'}
        </p>
      ) : null}
      {profile ? (
        <a
          className="textlink"
          href={`https://monadvision.com/address/${profile.address}`}
          target="_blank"
          rel="noreferrer"
        >
          See your wallet’s transfers
        </a>
      ) : null}
    </div>
  )
}

const list = (names: string[]) =>
  names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`

function ConversionProgress({
  pending,
  activity,
  trackingProblem,
  remember,
}: ReturnType<typeof useTokenConversion>) {
  if (!pending) return null
  const status = activity?.status
  const finished = status === 'success' || status === 'refund' || status === 'failure'
  const stale = Date.now() - pending.startedAt > 10 * 60_000
  return (
    <section className="w-mon-progress" aria-live="polite">
      <h2>{tokenConversionStatus(pending.symbol, activity)}</h2>
      <p>
        {status === 'success'
          ? 'Your dollars are ready to spend.'
          : status === 'refund'
            ? `Relay is sending your ${pending.symbol} back to this wallet.`
            : status === 'failure'
              ? 'Check the conversion details before trying again.'
              : `Your ${pending.symbol} is on its way to become dollars. You can leave this screen; progress is saved.`}
      </p>
      {activity?.received_ausd ? (
        <strong>{formatUsd(parseUnits(activity.received_ausd, 6))} added</strong>
      ) : null}
      {trackingProblem ? (
        <p role="alert">
          Tracking is unavailable for now. Your transfer is saved; don’t send again.
        </p>
      ) : null}
      <a href={`https://monadvision.com/tx/${pending.hash}`} target="_blank" rel="noreferrer">
        View {pending.symbol} transfer
      </a>
      <a
        href={`https://relay.link/transaction/${activity?.id ?? pending.requestId}`}
        target="_blank"
        rel="noreferrer"
      >
        Conversion and recovery details
      </a>
      {finished || stale ? (
        <button className="pill" type="button" onClick={() => remember(null)}>
          Done
        </button>
      ) : null}
    </section>
  )
}

function ConvertToken({
  token,
  held,
  onBack,
  onSent,
}: {
  token: WalletToken
  held: bigint
  onBack(): void
  onSent(pending: ReturnType<typeof pendingTokenConversion>): void
}) {
  const { profile, signingAccount, refresh, monUsd, hideBalance } = useWallet()
  const [amount, setAmount] = useState(() => exactTokenAmount(token, held))
  const [plan, setPlan] = useState<TokenConversionPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const working = useRef(false)
  const generation = useRef(0)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  const wallet = profile!.address
  const worth = tokenInDollars(token, held, monUsd)

  const preview = async () => {
    if (working.current) return
    working.current = true
    const version = ++generation.current
    setBusy(true)
    setProblem(null)
    setPlan(null)
    try {
      const quote = await monApi<ChainDepositQuote>(`/api/wallet/${wallet}/chain-deposit-quote`, {
        chain_id: 143,
        token: token.address,
        amount,
        refund_to: wallet,
      })
      const result = await prepareTokenConversion(wallet, token, amount, quote)
      if (active.current && version === generation.current) setPlan(result)
    } catch (e) {
      if (version === generation.current)
        setProblem(e instanceof Error ? e.message : 'Couldn’t preview the conversion.')
    } finally {
      working.current = false
      if (version === generation.current) setBusy(false)
    }
  }

  const confirm = async () => {
    if (!plan || working.current) return
    working.current = true
    setBusy(true)
    setProblem(null)
    try {
      // Approved like a payment of what it becomes, even when a signing session is open.
      const signer = await signingAccount(parseUnits(plan.quote.expected_ausd, 6))
      if (!active.current) return
      const hash = await sendTokenConversion(plan, signer, relayTransfer)
      onSent(pendingTokenConversion(plan, hash))
      void refreshTokens()
      void refresh()
    } catch (e) {
      if (active.current)
        setProblem(e instanceof Error ? e.message : 'Couldn’t confirm the conversion.')
    } finally {
      working.current = false
      if (active.current) setBusy(false)
    }
  }

  return (
    <div className="w-screen w-mon-screen w-tok-screen">
      <ScreenHead title="Turn into dollars" onBack={onBack} />
      <section className="w-mon-holding" aria-label={`${token.symbol} in your wallet`}>
        <span className="w-tok-holding">
          <TokenCoin token={token} />
          <small>{token.name} in your wallet</small>
        </span>
        <strong>
          {hideBalance ? '••••' : formatTokenAmount(token, held)} {token.symbol}
        </strong>
        {worth !== null && !hideBalance ? <small>{worthText(worth)}</small> : null}
      </section>
      <div className="w-mon-input">
        <label htmlFor="token-amount">{token.symbol} to turn into dollars</label>
        <div>
          <input
            id="token-amount"
            inputMode="decimal"
            value={amount}
            disabled={busy}
            placeholder="0"
            onChange={(e) => {
              generation.current++
              setAmount(e.target.value)
              setPlan(null)
              setProblem(null)
            }}
          />
          <button
            type="button"
            className="textlink"
            disabled={busy}
            onClick={() => {
              generation.current++
              setAmount(exactTokenAmount(token, held))
              setPlan(null)
              setProblem(null)
            }}
          >
            Max
          </button>
        </div>
      </div>
      {plan ? (
        <section className="w-mon-preview" aria-label="Conversion preview">
          <small>You receive about</small>
          <strong>{formatUsd(parseUnits(plan.quote.expected_ausd, 6))}</strong>
          <dl>
            <dt>You turn in</dt>
            <dd>
              {formatTokenAmount(token, plan.amount)} {token.symbol}
            </dd>
            <dt>Conversion fee, included</dt>
            <dd>
              {plan.quote.route_fee_usd === null
                ? 'Included in estimate'
                : `$${plan.quote.route_fee_usd}`}
            </dd>
            <dt>Network fee</dt>
            <dd>{plan.gasless ? 'Paid by Kova' : `Up to ${formatMon(plan.networkFee)} MON`}</dd>
          </dl>
          <p className="w-fine">
            The final dollar amount is set when the conversion starts. Anything that can’t convert
            comes back to this wallet.
          </p>
          <button
            className="pill pill-block"
            type="button"
            disabled={busy}
            onClick={() => void confirm()}
          >
            {busy ? 'Confirming…' : `Turn ${token.symbol} into dollars`}
          </button>
        </section>
      ) : (
        <button
          className="pill pill-block"
          type="button"
          disabled={busy || !amount}
          onClick={() => void preview()}
        >
          {busy ? 'Getting the price…' : 'See what you get'}
        </button>
      )}
      {problem ? (
        <p className="w-error" role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  )
}
