'use client'

import { randomNonce } from '@kova/monad'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import type { Checkout } from '@/lib/api'
import { usd } from '@/lib/format'
import { guessCurrency } from '@/lib/wallet/money'
import { Art, Icon } from './brand'
import { makeWallet, settleNewWallet } from './wallet/provider'
import { balanceOf, type PaidGuest } from './wallet-pay'

type Step =
  | { at: 'offer' }
  | { at: 'making' }
  | { at: 'moving'; to: string }
  | { at: 'done'; amount: bigint; ms: number }
  | { at: 'problem'; message: string; to: string | null }

const dollars = (base: bigint) => usd(Number(base) / 1e6)

/** "ada.obi@gmail.com" → "Ada": a first guess at a name, for them to change. */
function nameFrom(who: string): string {
  const local = who.includes('@') ? (who.split('@')[0] ?? '') : ''
  const first = local.split(/[._+\-\d]/)[0] ?? ''
  return first.length > 1 ? first[0]?.toUpperCase() + first.slice(1).toLowerCase() : ''
}

/**
 * After paying as a guest (email or Google), what's left on that email wallet is easy to forget.
 * This offers to keep it in Kova: one passkey makes a Kova wallet (Face ID, nothing to remember),
 * and the email wallet signs one gas-free transfer of everything left into it. Kova's relayer
 * pays the gas, so the guest never needs MON. The email wallet is signed out after.
 */
export function KeepInKova({
  checkout,
  guest,
  label = 'Left on your email wallet',
}: {
  /** The dollar to move, and the chain: a charge, or a link someone claimed. */
  checkout: Pick<Checkout, 'token' | 'token_domain' | 'chain_id'>
  guest: PaidGuest
  label?: string
}) {
  const router = useRouter()
  const [left, setLeft] = useState<bigint | null>(null)
  const [name, setName] = useState(() => nameFrom(guest.who))
  const [step, setStep] = useState<Step>({ at: 'offer' })

  useEffect(() => {
    void balanceOf(guest.provider, checkout.token, guest.address)
      .then(setLeft)
      .catch(() => setLeft(0n))
  }, [guest, checkout.token])

  /** The email wallet signs one transfer of everything it holds to `to`; Kova's relayer sends it. */
  const move = async (to: string) => {
    setStep({ at: 'moving', to })
    try {
      const value = await balanceOf(guest.provider, checkout.token, guest.address)
      if (value === 0n) throw new Error('This email wallet is empty now.')
      if (!checkout.token_domain) throw new Error('This network can’t move dollars from here yet.')
      const message = {
        from: guest.address,
        to,
        value: value.toString(),
        validAfter: '0',
        validBefore: String(Math.floor(Date.now() / 1000) + 600),
        nonce: randomNonce(),
      }
      const started = performance.now()
      const signature = (await guest.provider.request({
        method: 'eth_signTypedData_v4',
        params: [
          guest.address,
          JSON.stringify({
            types: {
              EIP712Domain: [
                { name: 'name', type: 'string' },
                { name: 'version', type: 'string' },
                { name: 'chainId', type: 'uint256' },
                { name: 'verifyingContract', type: 'address' },
              ],
              TransferWithAuthorization: [
                { name: 'from', type: 'address' },
                { name: 'to', type: 'address' },
                { name: 'value', type: 'uint256' },
                { name: 'validAfter', type: 'uint256' },
                { name: 'validBefore', type: 'uint256' },
                { name: 'nonce', type: 'bytes32' },
              ],
            },
            domain: {
              ...checkout.token_domain,
              chainId: checkout.chain_id,
              verifyingContract: checkout.token,
            },
            primaryType: 'TransferWithAuthorization',
            message,
          }),
        ],
      })) as string
      const response = await fetch('/api/wallet/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: checkout.token, ...message, signature }),
      })
      const body = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok)
        throw new Error(
          body.error ?? 'Kova couldn’t move it. Your dollars are still on the email wallet.',
        )
      setStep({ at: 'done', amount: value, ms: Math.round(performance.now() - started) })
      // Their dollars live in Kova now; the email wallet has nothing left to do on this browser.
      void guest.logout()
    } catch (error) {
      setStep({
        at: 'problem',
        message: error instanceof Error ? error.message : 'Something went wrong.',
        to,
      })
    }
  }

  const keep = async () => {
    setStep({ at: 'making' })
    try {
      const made = await makeWallet(name || 'Kova', guessCurrency())
      settleNewWallet(made.profile, made.account, made.vaultSecret)
      await move(made.account.address)
    } catch (error) {
      setStep({
        at: 'problem',
        message: error instanceof Error ? error.message : 'Your passkey wasn’t made.',
        to: null,
      })
    }
  }

  const notNow = () => {
    void guest.logout()
    router.refresh()
  }

  if (left === null)
    return (
      <div className="keep keep-quiet" aria-busy="true">
        <span className="spinner" aria-hidden="true" />
      </div>
    )

  if (left === 0n) return <p className="keep-close">You can close this page.</p>

  if (step.at === 'done')
    return (
      <section className="keep keep-done" aria-live="polite">
        <Art name="kovi-catch" size={104} className="keep-kovi" />
        <h2>{dollars(step.amount)} is in Kova</h2>
        <p>
          Moved in {(step.ms / 1000).toFixed(2)} s, and Kova paid the fee. Your wallet opens with
          your passkey: Face ID, nothing to remember. It’s the same wallet in the Kova app.
        </p>
        <button
          type="button"
          className="pill pill-block"
          data-tone="ink"
          onClick={() => router.push('/wallet')}
        >
          <span className="pill-label">Open my Kova wallet</span>
          <span className="pill-cap">
            <Icon name="arrow" size={18} />
          </span>
        </button>
      </section>
    )

  const busy = step.at === 'making' || step.at === 'moving'
  return (
    <section className="keep" aria-live="polite">
      <div className="keep-head">
        <span className="keep-coins" aria-hidden="true">
          <Art name="coin-usd" size={40} />
          <Art name="coin-eur" size={30} className="keep-coin-back" />
        </span>
        <div>
          <small>{label}</small>
          <strong>{dollars(left)}</strong>
        </div>
      </div>
      <h2>Keep your {dollars(left)} in Kova</h2>
      <p>
        Make a Kova wallet with a passkey, Face ID and no password, and we’ll move your{' '}
        {dollars(left)} into it. Free: Kova pays the fee. Pay anyone, anywhere, from then on.
      </p>
      <label className="keep-name">
        <span>Your name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="So people know it’s you"
          maxLength={40}
          disabled={busy}
          autoComplete="given-name"
        />
      </label>
      {step.at === 'problem' ? <p className="wallet-problem">{step.message}</p> : null}
      <button
        type="button"
        className="pill pill-block"
        data-tone="coral"
        disabled={busy || !name.trim()}
        onClick={() => void (step.at === 'problem' && step.to ? move(step.to) : keep())}
      >
        <span className="pill-label">
          {step.at === 'making'
            ? 'Making your wallet…'
            : step.at === 'moving'
              ? `Moving ${dollars(left)}…`
              : step.at === 'problem' && step.to
                ? 'Try moving it again'
                : `Keep ${dollars(left)} in Kova`}
        </span>
        <span className="pill-cap">
          {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="face" size={18} />}
        </span>
      </button>
      <p className="keep-fine">
        Signed in as {guest.who}. The email wallet signs once to move it; nothing else changes.
      </p>
      {busy ? null : (
        <button type="button" className="textlink keep-skip" onClick={notNow}>
          No thanks, I’m done
        </button>
      )}
    </section>
  )
}
