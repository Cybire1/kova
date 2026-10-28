'use client'

import {
  type ChainDepositQuote,
  conversionStatus,
  conversionWasNotSent,
  formatMon,
  MIN_MON_CARD_BALANCE,
  type MonConversionPlan,
  maxMonConversion,
  monCardVisible,
  monInDollars,
  type PendingMonConversion,
  prepareMonConversion,
  sendMonConversion,
} from '@kova/monad'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { parseUnits, zeroAddress } from 'viem'
import { Icon } from '@/components/brand'
import { monApi, useMonConversion } from '@/lib/wallet/mon'
import { formatUsd } from '@/lib/wallet/money'
import { ScreenHead } from './activity'
import { useWallet } from './provider'

export function MonWalletCard() {
  const { monBalance, monUsd, hideBalance, network } = useWallet()
  const { pending, activity, reverted, ready, dismissedAt, dismissCard, completeCard } =
    useMonConversion()
  const completing = useRef(false)
  const completed = activity?.status === 'success' && activity.received_ausd !== null
  useEffect(() => {
    if (!completed || completing.current) return
    completing.current = true
    void completeCard()
      .catch(() => {})
      .finally(() => {
        completing.current = false
      })
  }, [completed, activity, completeCard])
  if (network !== 'mainnet' || !ready || !monCardVisible(monBalance, dismissedAt, completed))
    return null
  return (
    <div className="w-mon-card">
      <Link href="/wallet/convert-mon" className="w-mon-card-main">
        <span className="w-mon-icon">
          <Icon name="receive" size={22} />
        </span>
        <span>
          <strong>
            {pending
              ? reverted
                ? 'MON conversion didn’t go through'
                : conversionStatus(activity)
              : `${hideBalance ? '••••' : formatMon(monBalance!)} MON in your wallet${!hideBalance && monUsd && monBalance ? `, ≈ ${formatUsd(monInDollars(monBalance, monUsd))}` : ''}`}
          </strong>
          <small>
            {pending ? 'View progress and details' : 'Convert to dollars to pay with Kova'}
          </small>
        </span>
        <Icon name="arrow" size={18} />
      </Link>
      <button
        type="button"
        className="w-mon-dismiss"
        aria-label="Dismiss MON balance"
        onClick={() => void dismissCard()}
      >
        <Icon name="close" size={18} />
      </button>
    </div>
  )
}

export function MonConversionEntry() {
  const { monBalance, network } = useWallet()
  const { pending } = useMonConversion()
  if (
    network !== 'mainnet' ||
    (!pending && (monBalance === null || monBalance < MIN_MON_CARD_BALANCE))
  )
    return null
  return (
    <Link href="/wallet/convert-mon" className="w-add-chain">
      <span>
        <strong>{pending ? 'View MON conversion' : 'Convert MON in your wallet'}</strong>
        <small>
          {pending ? 'Progress and recovery details' : 'Turn your MON into dollars to spend'}
        </small>
      </span>
      <Icon name="arrow" size={18} />
    </Link>
  )
}

export function ConvertMon() {
  const { profile, network } = useWallet()
  return profile && network === 'mainnet' ? (
    <ConversionForm key={profile.address} />
  ) : (
    <div className="w-screen">
      <ScreenHead title="Convert MON" />
      <p>MON conversion is available on mainnet.</p>
    </div>
  )
}

function ConversionForm() {
  const { profile, monBalance, signingAccount, refresh } = useWallet()
  const { pending, activity, trackingProblem, reverted, remember, ready } = useMonConversion()
  const [amount, setAmount] = useState('')
  const [plan, setPlan] = useState<MonConversionPlan | null>(null)
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

  const preview = async (useMax = false) => {
    if (working.current || pending) return
    working.current = true
    const version = ++generation.current
    setBusy(true)
    setProblem(null)
    setPlan(null)
    try {
      const input = useMax ? await maxMonConversion(wallet) : amount
      if (useMax && version === generation.current) setAmount(input)
      const quote = await monApi<ChainDepositQuote>(`/api/wallet/${wallet}/chain-deposit-quote`, {
        chain_id: 143,
        token: zeroAddress,
        amount: input,
        refund_to: wallet,
      })
      const result = await prepareMonConversion(wallet, input, quote)
      if (active.current && version === generation.current) setPlan(result)
    } catch (e) {
      if (version === generation.current)
        setProblem(e instanceof Error ? e.message : 'Couldn’t preview conversion.')
    } finally {
      working.current = false
      if (version === generation.current) setBusy(false)
    }
  }

  const confirm = async () => {
    if (!plan || working.current || pending) return
    working.current = true
    setBusy(true)
    setProblem(null)
    let remembered = false
    try {
      // Explicit confirmation is required even when a payment signing session is already open.
      const signer = await signingAccount(parseUnits(plan.quote.expected_ausd, 6))
      if (!active.current) return
      const record: PendingMonConversion = {
        wallet,
        requestId: plan.quote.request_id,
        depositAddress: plan.quote.address,
        amount: plan.quote.amount,
        startedAt: Date.parse(plan.quote.quoted_at),
      }
      await remember(record)
      remembered = true
      const hash = await sendMonConversion(plan, signer)
      await remember({ ...record, hash })
      setPlan(null)
      void refresh()
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Couldn’t confirm conversion.'
      if (remembered && conversionWasNotSent(e)) {
        await remember(null)
        setPlan(null)
      }
      setProblem(message)
    } finally {
      working.current = false
      setBusy(false)
    }
  }

  return (
    <div className="w-screen w-mon-screen">
      <ScreenHead title="Convert MON" />
      <p className="w-lead">
        Your MON is in this wallet. Convert it to dollars to use it for Kova payments.
      </p>
      <section className="w-mon-holding" aria-label="MON balance">
        <small>MON in your wallet</small>
        <strong>{monBalance === null ? 'Loading…' : `${formatMon(monBalance)} MON`}</strong>
      </section>
      {!ready ? (
        <p>Loading conversion history…</p>
      ) : pending ? (
        <section className="w-mon-progress" aria-live="polite">
          <h2>{reverted ? 'Transfer didn’t go through' : conversionStatus(activity)}</h2>
          <p>
            {reverted
              ? 'Your MON wasn’t converted. A small fee may still have been taken.'
              : activity?.status === 'success'
                ? 'Your dollars are ready to spend.'
                : activity?.status === 'refund'
                  ? 'Relay is returning the funds to this wallet. Check the recovery details for progress.'
                  : activity?.status === 'failure'
                    ? 'Check Relay’s recovery details before starting another conversion.'
                    : 'Your transfer is being checked. You can leave this screen; progress is saved.'}
          </p>
          {activity?.received_ausd ? (
            <strong>{formatUsd(parseUnits(activity.received_ausd, 6))} added</strong>
          ) : null}
          {trackingProblem ? (
            <p role="alert">
              Tracking is temporarily unavailable. Your transfer is saved; don’t send again.
            </p>
          ) : null}
          {pending.hash ? (
            <a href={`https://monadvision.com/tx/${pending.hash}`} target="_blank" rel="noreferrer">
              View MON transfer
            </a>
          ) : null}
          <a
            href={`https://relay.link/transaction/${activity?.id ?? pending.requestId}`}
            target="_blank"
            rel="noreferrer"
          >
            Conversion and recovery details
          </a>
          {reverted || activity?.status === 'success' ? (
            <button className="pill" type="button" onClick={() => void remember(null)}>
              Done
            </button>
          ) : null}
        </section>
      ) : (
        <>
          <div className="w-mon-input">
            <label htmlFor="mon-amount">MON to convert</label>
            <div>
              <input
                id="mon-amount"
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
                onClick={() => void preview(true)}
              >
                Max
              </button>
            </div>
          </div>
          <p className="w-fine">Max leaves a little MON to cover the fee.</p>
          {plan ? (
            <section className="w-mon-preview" aria-label="Conversion preview">
              <small>You receive approximately</small>
              <strong>{formatUsd(parseUnits(plan.quote.expected_ausd, 6))}</strong>
              <dl>
                <dt>You convert</dt>
                <dd>{formatMon(plan.value)} MON</dd>
                <dt>Conversion fee, included</dt>
                <dd>
                  {plan.quote.route_fee_usd === null
                    ? 'Included in estimate'
                    : `$${plan.quote.route_fee_usd}`}
                </dd>
                <dt>Network fee, up to</dt>
                <dd>{formatMon(plan.networkFee)} MON</dd>
              </dl>
              <p className="w-fine">
                The final dollar amount is set when conversion starts. Any refund returns to this
                wallet.
              </p>
              <button
                className="pill pill-block"
                type="button"
                disabled={busy}
                onClick={() => void confirm()}
              >
                {busy ? 'Confirming…' : 'Confirm conversion'}
              </button>
            </section>
          ) : (
            <button
              className="pill pill-block"
              type="button"
              disabled={busy || !amount || monBalance === null || monBalance === 0n}
              onClick={() => void preview()}
            >
              {busy ? 'Getting estimate…' : 'Preview conversion'}
            </button>
          )}
        </>
      )}
      {problem ? (
        <p className="w-error" role="alert">
          {problem}
        </p>
      ) : null}
      <a
        className="textlink"
        href={`https://monadvision.com/address/${wallet}`}
        target="_blank"
        rel="noreferrer"
      >
        See your wallet’s transfers
      </a>
    </div>
  )
}
