'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Art, Icon } from '@/components/brand'
import { personLink } from '@/lib/wallet/links'
import {
  applyKey,
  baseToNumber,
  formatLocal,
  formatUsd,
  groupTyped,
  type Key,
  toBase,
} from '@/lib/wallet/money'
import { ScreenHead } from './activity'
import { short, useWallet } from './provider'
import { CopyButton, Keypad, NoSignal, QR, ShareButton } from './ui'

function useOrigin() {
  const [origin, setOrigin] = useState('https://mykova.app')
  useEffect(() => setOrigin(window.location.origin), [])
  return origin
}

/** Asking for money: an amount and what it's for, then a link and a code anyone can pay. */
export function Request() {
  const { profile, rates } = useWallet()
  const origin = useOrigin()
  const [typed, setTyped] = useState('')
  const [note, setNote] = useState('')
  const [ready, setReady] = useState(false)
  const onKey = useCallback((key: Key) => setTyped((v) => applyKey(v, key, 2)), [])
  if (!profile) return null
  const amount = typed && Number(typed) > 0 ? Number(typed).toFixed(2) : ''
  const firstName = profile.name.split(' ')[0] || 'me'

  if (ready && amount) {
    const link = personLink(origin, {
      address: profile.address,
      name: profile.name,
      currency: profile.currency,
      amount,
      note: note.trim() || undefined,
    })
    return (
      <div className="w-screen">
        <ScreenHead title="" back="/wallet">
          <button type="button" className="textlink" onClick={() => setReady(false)}>
            Change amount
          </button>
        </ScreenHead>
        <div className="w-code-screen">
          <h1 className="w-title">Scan to pay {firstName}</h1>
          <p className="w-code-amount">{formatUsd(toBase(amount))}</p>
          {note.trim() ? <p className="w-lead">for {note.trim()}</p> : null}
          <div className="w-code-card">
            <QR value={link} size={200} label={`Code to pay ${profile.name} ${amount} dollars`} />
          </div>
          <p className="w-fine w-center">
            They can scan it with the Kova app or any phone camera. It opens on the web if they
            don’t have Kova, and they can pay with email or Google.
          </p>
          <ShareButton
            title={`Pay ${profile.name}`}
            text={`${profile.name} asked you for $${amount}${note.trim() ? ` for ${note.trim()}` : ''} on Kova:`}
            url={link}
            label="Share request"
          />
          <CopyButton text={link} label="Copy link" className="w-copy w-copy-wide" />
        </div>
      </div>
    )
  }

  return (
    <div className="w-screen w-amount-screen">
      <ScreenHead title="Request" />
      <p className={`w-typed${typed ? '' : ' w-typed-empty'}`} aria-live="polite">
        <span className="w-typed-sign">$</span>
        {groupTyped(typed)}
      </p>
      <p className="w-typed-sub">
        {amount && profile.currency !== 'USD'
          ? `About ${formatLocal(baseToNumber(toBase(amount)), profile.currency, rates)}`
          : 'They pay in dollars, from anywhere'}
      </p>
      <input
        className="w-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What’s it for?"
        maxLength={60}
        aria-label="What’s it for?"
      />
      <Keypad onKey={onKey} />
      <button
        type="button"
        className="pill pill-block"
        data-tone="ink"
        disabled={!amount}
        onClick={() => setReady(true)}
      >
        <span className="pill-label">Create request</span>
        <span className="pill-cap">
          <Icon name="arrow" size={18} />
        </span>
      </button>
    </div>
  )
}

/** Getting paid: your code and your link. Your address, for crypto wallets, is folded away below. */
export function Receive() {
  const { profile, network } = useWallet()
  const origin = useOrigin()
  // "Show my address" (Add money) opens straight to the address.
  const crypto = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    if (crypto.current && new URLSearchParams(window.location.search).get('address') === '1')
      crypto.current.open = true
  }, [])
  if (!profile) return null
  const link = personLink(origin, {
    address: profile.address,
    name: profile.name,
    currency: profile.currency,
  })
  const firstName = profile.name.split(' ')[0] || 'me'
  return (
    <div className="w-screen">
      <ScreenHead title="Get paid" />
      <div className="w-code-screen">
        <h1 className="w-title">Scan to pay {firstName}</h1>
        <p className="w-lead">Share this code or link to receive Kova payments.</p>
        <div className="w-code-card w-code-card-peek">
          <Art name="kovi-peek" size={104} className="w-code-kovi" />
          <QR value={link} size={200} label={`Code to pay ${profile.name}`} />
        </div>
        <details className="w-crypto" ref={crypto}>
          <summary>
            Paying from a crypto wallet or exchange?
            <span className="w-crypto-chev">
              <Icon name="chevronDown" size={16} />
            </span>
          </summary>
          <div className="w-crypto-body">
            <div className="w-address">
              <span>
                <small>Receive AUSD on Monad</small>
                <code>{short(profile.address)}</code>
              </span>
              <CopyButton text={profile.address} />
            </div>
            <p className="w-fine">
              AUSD arrives ready to spend. MON sent here appears separately and needs conversion.
            </p>
            {network === 'mainnet' ? (
              <Link className="w-mon-card" href="/wallet/add/chain">
                <span>
                  <strong>Depositing MON or other crypto?</strong>
                  <small>Choose a token and network. We convert it to dollars for you.</small>
                </span>
                <Icon name="arrow" size={18} />
              </Link>
            ) : null}
          </div>
        </details>
        <p className="w-offline-hint">
          <NoSignal size={15} />
          <span>
            No signal? A Kova phone can still scan this and pay you. It settles as soon as either of
            you is back online.
          </span>
        </p>
        <ShareButton
          title={`Pay ${profile.name}`}
          text="Pay me on Kova:"
          url={link}
          label="Share my link"
        />
      </div>
    </div>
  )
}
