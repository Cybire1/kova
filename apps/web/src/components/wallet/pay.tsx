'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { getAddress } from 'viem'
import { Art, Icon } from '@/components/brand'
import { OrderReady } from '@/components/order-ready'
import { StampsAfterPay } from '@/components/stamp-card'
import type { Checkout } from '@/lib/api'
import { rememberPayer } from '@/lib/payer'
import type { ChargeToPay } from '@/lib/wallet/chain'
import { parseScanned } from '@/lib/wallet/links'
import { baseToNumber, formatLocal, formatUsd } from '@/lib/wallet/money'
import { sessionCovers } from '@/lib/wallet/session'
import { ScreenHead } from './activity'
import { MoveInFirst, privateCovers } from './private'
import { useWallet } from './provider'

interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>
}
type DetectorClass = new (options: { formats: string[] }) => Detector

/** Where a code or link goes: a shop's charge, a stall, or a person. */
function useRoute() {
  const router = useRouter()
  return (value: string): string | null => {
    const s = parseScanned(value)
    if (!s) return 'That code isn’t a Kova payment. Try the shop’s Kova QR.'
    if (s.kind === 'charge') router.push(`/wallet/pay/${s.id}`)
    else if (s.kind === 'stall') router.push(`/s/${s.slug}`)
    else if (s.kind === 'pair')
      return 'That code pairs a phone with a shop. Open it in the Kova app.'
    else if (s.kind === 'claim') router.push(`/c/${s.id}${s.key ? `#${s.key}` : ''}`)
    else {
      const params = new URLSearchParams()
      if (s.name) params.set('name', s.name)
      if (s.currency) params.set('cur', s.currency)
      if (s.amount) params.set('amount', s.amount)
      if (s.note) params.set('note', s.note)
      router.push(`/wallet/send/${getAddress(s.address)}${params.size ? `?${params}` : ''}`)
    }
    return null
  }
}

/**
 * Pay: a shop's code, a stall's poster, a friend's code, or a link someone sent. The camera reads
 * codes where the browser can (Chrome); elsewhere your phone's own camera opens the same link.
 */
export function Pay() {
  const route = useRoute()
  const [camera, setCamera] = useState<'off' | 'starting' | 'on' | 'none'>('off')
  const [error, setError] = useState<string | null>(null)
  const [link, setLink] = useState('')
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)

  useEffect(() => {
    if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) setCamera('none')
    return () => {
      for (const track of stream.current?.getTracks() ?? []) track.stop()
    }
  }, [])

  const start = async () => {
    setError(null)
    setCamera('starting')
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      })
      if (!video.current) return
      video.current.srcObject = stream.current
      await video.current.play()
      setCamera('on')
      const Detector = (window as unknown as { BarcodeDetector: DetectorClass }).BarcodeDetector
      const detector = new Detector({ formats: ['qr_code'] })
      const look = async () => {
        if (!video.current || !stream.current) return
        const found = await detector.detect(video.current).catch(() => [])
        const value = found[0]?.rawValue
        if (value) {
          const problem = route(value)
          if (!problem) {
            for (const track of stream.current.getTracks()) track.stop()
            return
          }
          setError(problem)
        }
        setTimeout(() => void look(), 250)
      }
      void look()
    } catch {
      setCamera('off')
      setError('Kova couldn’t use the camera. Allow it in the browser, or paste the link.')
    }
  }

  return (
    <div className="w-screen">
      <ScreenHead title="Scan to pay" />
      <div className={`w-scan${camera === 'on' ? ' w-scan-on' : ''}`}>
        <video ref={video} muted playsInline className="w-scan-video" />
        {camera !== 'on' ? (
          <div className="w-scan-idle">
            <span className="w-scan-frame" aria-hidden="true">
              <Icon name="scan" size={34} />
            </span>
            {camera === 'none' ? (
              <>
                <strong>Scan with your phone’s camera</strong>
                <span>
                  A shop’s Kova code opens the payment right here. Or paste the link below.
                </span>
              </>
            ) : (
              <>
                <strong>Point at a Kova code</strong>
                <span>
                  A shop’s QR, a stall’s table poster, or a friend’s code. It only looks for payment
                  codes.
                </span>
                <button
                  type="button"
                  className="pill"
                  data-tone="coral"
                  disabled={camera === 'starting'}
                  onClick={() => void start()}
                >
                  <span className="pill-label">
                    {camera === 'starting' ? 'Starting camera…' : 'Use the camera'}
                  </span>
                  <span className="pill-cap">
                    <Icon name="camera" size={18} />
                  </span>
                </button>
              </>
            )}
          </div>
        ) : (
          <span className="w-scan-target" aria-hidden="true" />
        )}
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      <form
        className="w-find"
        onSubmit={(e) => {
          e.preventDefault()
          setError(route(link))
        }}
      >
        <Icon name="external" size={18} />
        <input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="Paste a payment link"
          aria-label="Payment link"
          spellCheck={false}
          autoComplete="off"
        />
        <button type="submit" className="w-find-btn" disabled={!link.trim()}>
          Go
        </button>
      </form>
      <Link href="/wallet/receive" className="w-show-code">
        <Icon name="receive" size={16} /> Show my code instead
      </Link>
    </div>
  )
}

type Stage =
  | { at: 'loading' }
  | { at: 'closed'; message: string }
  | { at: 'review' }
  | { at: 'paying' }
  | { at: 'paid'; ms: number; hash: string }
  | { at: 'problem'; message: string }

/** A charge as Kova shows it to the payer, with the stall order behind it. */
type Charge = Omit<ChargeToPay, 'order'> & { status: string; order?: Checkout['order'] }

/** Paying a shop's charge from this wallet: what it's for, then paid in about a second. */
export function PayCharge({ id }: { id: string }) {
  const { balance, payCheckout, profile, rates, privateBalance } = useWallet()
  const [charge, setCharge] = useState<Charge | null>(null)
  const [stage, setStage] = useState<Stage>({ at: 'loading' })

  useEffect(() => {
    let live = true
    fetch(`/api/checkout/${encodeURIComponent(id)}`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error()
        return (await r.json()) as Charge
      })
      .then((c) => {
        if (!live) return
        setCharge(c)
        if (c.status === 'paid')
          setStage({ at: 'closed', message: 'This charge has already been paid.' })
        else if (c.status === 'expired')
          setStage({ at: 'closed', message: 'This charge expired. Ask the shop for a new code.' })
        else if (c.status === 'processing')
          setStage({
            at: 'closed',
            message: 'This charge is being paid right now. Give it a second.',
          })
        else if (c.status !== 'requires_payment')
          setStage({ at: 'closed', message: 'This charge is no longer open.' })
        else setStage({ at: 'review' })
      })
      .catch(
        () =>
          live &&
          setStage({ at: 'closed', message: 'Kova couldn’t find this charge. Check the link.' }),
      )
    return () => {
      live = false
    }
  }, [id])

  if (stage.at === 'loading' || !charge)
    return (
      <div className="w-screen">
        <ScreenHead title="Pay" back="/wallet/pay" />
        {stage.at === 'closed' ? (
          <div className="w-empty">
            <strong>Not this time</strong>
            <span>{stage.message}</span>
          </div>
        ) : (
          <div className="w-loading" aria-busy="true" />
        )}
      </div>
    )

  const amount = BigInt(charge.amount_base)
  const place = charge.order?.stall?.name ?? charge.merchant_name
  const short_ = balance !== null && amount > balance
  /** Short, but private dollars waiting to move in would cover it. */
  const coverable = privateCovers(balance, privateBalance, amount)
  const order = charge.order

  if (stage.at === 'paid')
    return (
      <div className="w-screen w-moment">
        <Art name="scene-paid-terminal" size={168} className="w-moment-art" />
        <h1 className="w-hero-title">Paid!</h1>
        <p className="w-moment-big">
          {formatUsd(amount)} to {place}
        </p>
        {order?.reward ? <p className="w-moment-reward">One {order.reward.name} free with your stamp card</p> : null}
        <div className="w-stats w-stats-moment">
          <span>
            <strong>{(stage.ms / 1000).toFixed(1)}s</strong> Took
          </span>
          <span>
            <strong>$0.00</strong> Fee
          </span>
          <span>
            <strong>{balance === null ? '…' : formatUsd(balance)}</strong> Left
          </span>
        </div>
        {order?.stall && order.status && !order.pay_for_me ? (
          <div className="w-moment-order">
            <OrderReady checkoutId={charge.id} order={order} shop={order.stall.name} />
            <StampsAfterPay slug={order.stall.slug} shop={order.stall.name} usedReward={Boolean(order.reward)} />
          </div>
        ) : null}
        <div className="w-moment-actions">
          <Link href="/wallet" className="pill pill-block" data-tone="ink">
            <span className="pill-label">Done</span>
            <span className="pill-cap">
              <Icon name="check" size={18} />
            </span>
          </Link>
          <Link href={`/wallet/activity/${stage.hash}`} className="textlink">
            See receipt
          </Link>
        </div>
      </div>
    )

  const lines = order?.lines ?? []
  return (
    <div className="w-screen">
      <ScreenHead title="" back="/wallet/pay" />
      {stage.at === 'closed' ? (
        <div className="w-empty">
          <strong>Not this time</strong>
          <span>{stage.message}</span>
        </div>
      ) : (
        <div className="w-review">
          <Art name="badge-shop" size={60} className="w-face" />
          <p className="w-lead">Pay for your order at</p>
          <h1 className="w-title">{place}</h1>
          <p className="w-code-amount">{formatUsd(amount)}</p>
          {profile && profile.currency !== 'USD' ? (
            <p className="w-lead">
              about {formatLocal(baseToNumber(amount), profile.currency, rates)}
            </p>
          ) : null}
          <div className="w-review-card">
            {lines.length ? (
              <div className="w-review-lines">
                {lines.slice(0, 4).map((l) => (
                  <span key={l.item_id}>
                    {l.quantity} × {l.name}
                  </span>
                ))}
                {lines.length > 4 ? <span>and {lines.length - 4} more</span> : null}
              </div>
            ) : charge.reference ? (
              <div className="w-review-row">
                <span>For</span>
                <strong>{charge.reference}</strong>
              </div>
            ) : null}
            {order?.table ? (
              <div className="w-review-row">
                <span>Table</span>
                <strong>{order.table}, they’ll bring it over</strong>
              </div>
            ) : null}
            {order?.reward ? (
              <div className="w-review-row w-review-reward">
                <span>Stamp card</span>
                <strong>One {order.reward.name} free</strong>
              </div>
            ) : null}
            <div className="w-review-row">
              <span>From</span>
              <strong>Your wallet, {balance === null ? '…' : formatUsd(balance)}</strong>
            </div>
            <div className="w-review-row">
              <span>Fee</span>
              <strong>$0.00, Kova covers it</strong>
            </div>
          </div>
          {stage.at === 'problem' ? (
            <p className="form-error">
              {stage.message}
              {/* A timeout may still land: then the message says so, and we don't claim otherwise. */}
              {/went through/i.test(stage.message) ? '' : ' Nothing was paid.'}
            </p>
          ) : null}
          {coverable ? (
            <>
              <p className="w-fine w-center">
                You need {formatUsd(amount - (balance ?? 0n))} more, and you have{' '}
                {formatUsd(privateBalance)} sent to you privately. Moving it in takes about a
                second.
              </p>
              <MoveInFirst tone="coral" />
            </>
          ) : short_ ? (
            <>
              <p className="form-error">
                You need {formatUsd(amount - (balance ?? 0n))} more. Add money first.
              </p>
              <Link href="/wallet/add" className="pill pill-block" data-tone="ink">
                <span className="pill-label">Add money</span>
                <span className="pill-cap">
                  <Icon name="plus" size={18} />
                </span>
              </Link>
            </>
          ) : (
            <button
              type="button"
              className="pill pill-block"
              data-tone="coral"
              disabled={stage.at === 'paying'}
              onClick={async () => {
                setStage({ at: 'paying' })
                try {
                  const moved = await payCheckout(charge)
                  // This wallet is the stamp card at the shop.
                  if (profile) rememberPayer(profile.address)
                  setStage({ at: 'paid', ms: moved.ms, hash: moved.hash })
                } catch (e) {
                  const message = e instanceof Error ? e.message : 'Kova couldn’t pay it.'
                  setStage(/cancel/i.test(message) ? { at: 'review' } : { at: 'problem', message })
                }
              }}
            >
              <span className="pill-label">
                {stage.at === 'paying' ? 'Paying…' : `Pay ${formatUsd(amount)}`}
              </span>
              <span className="pill-cap">
                <Icon name={sessionCovers(amount) ? 'bolt' : 'face'} size={18} />
              </span>
            </button>
          )}
          {short_ ? null : (
            <p className="w-fine w-center">
              {sessionCovers(amount)
                ? 'Your wallet is open, so this one needs no passkey.'
                : 'Your passkey approves it. The shop gets it in about a second.'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
