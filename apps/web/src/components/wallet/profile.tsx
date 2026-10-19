'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Icon } from '@/components/brand'
import { personLink } from '@/lib/wallet/links'
import {
  currencyInfo,
  type DisplayCurrency,
  displayCurrencies,
  formatUsd,
  rateLabel,
} from '@/lib/wallet/money'
import { SESSION_LIMIT, TAP_LIMIT, useSessionState } from '@/lib/wallet/session'
import { ScreenHead } from './activity'
import { PrivateReceiving } from './private'
import { short, useWallet } from './provider'
import { CopyButton, QR } from './ui'

/** "$50", for limits that are always whole dollars. */
const whole = (base: bigint) => formatUsd(base).replace(/\.00$/, '')

/** You, as the app's Profile shows you: your pass, your money's currency, your keys, your shop. */
export function Profile() {
  const { profile, activity, contacts, network, rates, liveRates, setCurrency, lock, signOut } =
    useWallet()
  const session = useSessionState()
  const router = useRouter()
  const [origin, setOrigin] = useState('https://mykova.app')
  const [forgetting, setForgetting] = useState(false)
  useEffect(() => setOrigin(window.location.origin), [])
  if (!profile) return null

  const payments = activity.filter((e) => e.kind === 'paid' || e.kind === 'sent').length
  const moved = activity.reduce((sum, e) => sum + BigInt(e.amount), 0n)
  const mins = Math.floor(session.msLeft / 60_000)
  const secs = Math.floor((session.msLeft % 60_000) / 1000)
    .toString()
    .padStart(2, '0')

  return (
    <div className="w-screen">
      <ScreenHead title="You" />

      <section className="w-pass">
        <div className="w-pass-text">
          <strong>{profile.name || 'Your wallet'}</strong>
          <span>
            Member since{' '}
            {new Date(profile.createdAt).toLocaleDateString([], {
              month: 'short',
              year: 'numeric',
            })}
          </span>
          <small className="w-pass-label">
            Your address on Monad <em>{network === 'testnet' ? 'Testnet' : 'Mainnet'}</em>
          </small>
          <code>{short(profile.address)}</code>
          <CopyButton text={profile.address} className="w-copy w-copy-ink" />
        </div>
        <Link href="/wallet/receive" className="w-pass-qr" aria-label="Show my code">
          <QR
            value={personLink(origin, {
              address: profile.address,
              name: profile.name,
              currency: profile.currency,
            })}
            size={96}
            label="Your Kova code"
          />
        </Link>
      </section>

      <div className="w-stats">
        <span>
          <strong>{payments}</strong> Payments
        </span>
        <span>
          <strong>{contacts.length}</strong> People
        </span>
        <span>
          <strong>{formatUsd(moved)}</strong> Moved
        </span>
      </div>

      {/* Mainnet only: on testnet there's nothing real to cash out. */}
      {network === 'mainnet' ? (
        <Link href="/wallet/cash-out" className="w-add-chain">
          <span>
            <strong>Cash out</strong>
            <small>To your bank or card, with Ramp Network</small>
          </span>
          <Icon name="out" size={16} />
        </Link>
      ) : null}

      <Link href="/wallet/keys" className="w-add-chain">
        <span>
          <strong>Keys</strong>
          <small>Allowances, your team and AI agents: who may spend your dollars, and how much</small>
        </span>
        <Icon name="key" size={16} />
      </Link>

      {network==='testnet'?<Link href="/wallet/ussd" className="w-add-chain"><span><strong>Pay by USSD</strong><small>Link your simulator number and test payments without data</small></span><Icon name="arrow" size={16} /></Link>:null}

      <section className="w-money">
        <div>
          <small>Your money shows in</small>
          <strong>
            {currencyInfo[profile.currency].symbol} {currencyInfo[profile.currency].name}
          </strong>
          <span>
            {profile.currency === 'USD'
              ? 'Dollars, just as they are.'
              : `$1 = ${currencyInfo[profile.currency].symbol}${rates[profile.currency].toLocaleString('en-US', { maximumFractionDigits: 3 })}, ${rateLabel(liveRates)}`}
          </span>
        </div>
        <label className="w-money-change">
          <span className="sr-only">Show my money in</span>
          <select
            value={profile.currency}
            onChange={(e) => setCurrency(e.target.value as DisplayCurrency)}
          >
            {displayCurrencies.map((code) => (
              <option key={code} value={code}>
                {currencyInfo[code].symbol} {currencyInfo[code].name}
              </option>
            ))}
          </select>
          Change
        </label>
      </section>

      <section className="w-keys">
        <div className="w-keys-head">
          <span className="w-keys-icon">
            <Icon name="face" size={18} />
          </span>
          <span>
            <strong>{profile.auth === 'google' ? 'Your Google account' : 'Your passkey'}</strong>
            <small>{profile.auth === 'google'
              ? `${profile.email || 'Google'} opens this same wallet on a new phone or browser.`
              : 'The same one as the Kova app. It opens this wallet on any device.'}</small>
          </span>
        </div>
        <div className={`w-session${session.open ? ' w-session-open' : ''}`}>
          <span>
            <strong>{session.open ? `Open for ${mins}:${secs}` : 'Locked'}</strong>
            <small>
              {session.open
                ? `Pays up to ${formatUsd(session.canApprove)} before asking again`
                : profile.auth === 'google' ? 'Your next payment asks you to unlock your Google wallet' : 'Your next payment asks for your passkey'}
            </small>
          </span>
          {session.open ? (
            <button type="button" className="mini mini-ink" onClick={lock}>
              <Icon name="lock" size={14} /> Lock
            </button>
          ) : null}
        </div>
        <div className="w-rules">
          <span>{whole(TAP_LIMIT)} a tap</span>
          <span>{whole(SESSION_LIMIT)} a session</span>
          <span>3 quiet minutes</span>
        </div>
        <p className="w-fine">
          Your name and the people you pay are encrypted by your wallet. Kova stores them and can’t
          read them.
        </p>
      </section>

      <PrivateReceiving />

      {forgetting ? (
        <div className="w-forget">
          <p>
            This browser forgets your wallet. Your money stays on Monad. Sign in again with
            {profile.auth === 'google' ? ' the same Google account' : ' your Kova passkey'} to reopen it.
          </p>
          <div className="w-forget-actions">
            <button type="button" className="mini" onClick={() => setForgetting(false)}>
              Keep it
            </button>
            <button
              type="button"
              className="mini mini-ink"
              onClick={() => {
                signOut()
                router.replace('/wallet')
              }}
            >
              Forget this wallet here
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="textlink w-forget-link"
          onClick={() => setForgetting(true)}
        >
          Forget this wallet on this browser
        </button>
      )}
    </div>
  )
}
