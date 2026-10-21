'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Awning } from '@/components/awning'
import { Art, Icon } from '@/components/brand'
import { formatUsd, toBase } from '@/lib/wallet/money'
import { KeysOnHome } from './keys'
import { MonWalletCard } from './mon'
import { MoneyRow } from './money'
import { isUnnamed, useWallet } from './provider'
import { StocksCard } from './stocks'
import { ActionTile, Avatar, BalanceCard, EntryRow } from './ui'

/**
 * Home is for paying, and you should never have to look for your money: the app's Home. The
 * balance opens the screen on a solid teal card (money at rest is teal across Kova), Pay sits
 * right beneath it with Send and Request beside it, and the people you pay are one tap away.
 */
export function Home() {
  const { profile, balance, monBalance, activity, contacts, network } = useWallet()
  if (!profile) return null
  const empty = balance === 0n && !(monBalance && monBalance > 0n)

  return (
    <div className="w-screen">
      <div className="w-hello">
        <Link href="/wallet/profile" aria-label="Your profile">
          <Avatar name={profile.name} id={profile.address} size={38} />
        </Link>
        <div className="w-hello-text">
          <span>Hello</span>
          <strong>{profile.name ? profile.name.split(' ')[0] : 'there'}</strong>
        </div>
        <Link href="/wallet/activity" className="round" aria-label="Activity">
          <Icon name="bell" size={18} />
        </Link>
      </div>

      {profile.name ? null : <NameYourself />}

      <BalanceCard />
      <MonWalletCard />

      <div className="w-hero">
        <Link href="/wallet/pay" className="w-pay" aria-label="Pay. Scan a code or pay a link">
          <span className="w-pay-icons">
            <span className="w-pay-icon w-pay-icon-coral">
              <Icon name="scan" size={20} />
            </span>
            <span className="w-pay-icon">
              <Icon name="tap" size={20} />
            </span>
          </span>
          <svg
            className="w-pay-waves"
            width="92"
            height="92"
            viewBox="-46 -46 92 92"
            aria-hidden="true"
          >
            <circle r="40" fill="none" stroke="#fff" strokeOpacity="0.12" strokeWidth="2" />
            <circle r="26" fill="none" stroke="#fff" strokeOpacity="0.18" strokeWidth="2" />
            <circle r="12" fill="none" stroke="#fff" strokeOpacity="0.26" strokeWidth="2" />
          </svg>
          <span>
            <span className="w-pay-label">Pay</span>
            <span className="w-pay-sub">Scan a code or pay a link</span>
          </span>
        </Link>
        <div className="w-hero-side">
          <ActionTile kind="send" />
          <ActionTile kind="request" />
        </div>
      </div>

      <KeysOnHome />

      <ShopCard />

      <StocksCard />

      <MoneyRow />
      <Link href="/wallet/keys" className="w-add-chain">
        <span>
          <strong>Keys</strong>
          <small>Allowances, your team and AI agents, each with its own limit</small>
        </span>
        <Icon name="key" size={16} />
      </Link>

      {empty ? (
        <Link href="/wallet/add" className="w-notice">
          <span className="w-notice-icon">
            <Icon name="plus" size={18} />
          </span>
          <span className="w-notice-text">
            <strong>{network === 'testnet' ? 'Add test dollars' : 'Add money'}</strong>
            <span>
              {network === 'testnet'
                ? 'Free on Monad testnet, $5 a day'
                : 'Deposit crypto, or add money by card or bank.'}
            </span>
          </span>
          <span className="w-notice-cta">Add</span>
        </Link>
      ) : null}

      <IosBeta />

      <h2 className="w-section">Send again</h2>
      <div className="w-people">
        <Link href="/wallet/send" className="w-person" aria-label="Pay someone new">
          <span className="w-person-new">
            <Icon name="plus" size={20} />
          </span>
          <span>New</span>
        </Link>
        {contacts.slice(0, 8).map((c) => (
          <Link
            key={c.address}
            href={`/wallet/send/${c.address}?name=${encodeURIComponent(c.name)}${c.currency ? `&cur=${c.currency}` : ''}`}
            className="w-person"
            aria-label={`Send to ${c.name}`}
          >
            <Avatar name={c.name} id={c.address} size={48} />
            <span>{isUnnamed(c.name) ? c.address.slice(0, 6) : c.name.split(' ')[0]}</span>
          </Link>
        ))}
      </div>

      <div className="w-section-row">
        <h2 className="w-section">Recent</h2>
        {activity.length > 3 ? (
          <Link href="/wallet/activity" className="w-see-all">
            See all
          </Link>
        ) : null}
      </div>
      {activity.length === 0 ? (
        <p className="w-quiet">Your payments show up here the moment they land.</p>
      ) : (
        <div className="w-entries">
          {activity.slice(0, 3).map((entry) => (
            <EntryRow key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Your shop, one of the wallet's features, under the stall's awning as in the app: the way into
 * shop mode. Signed in, it shows today's takings; otherwise the passkey signs you in on the way;
 * with no shop yet, it opens one.
 */
function ShopCard() {
  const { shop, knownShop } = useWallet()
  const name = shop?.name ?? knownShop
  const today = shop?.today
  const line = shop
    ? today && today.count > 0
      ? `${formatUsd(toBase(today.total))} today, ${today.count} ${today.count === 1 ? 'sale' : 'sales'}`
      : 'No sales yet today'
    : name
      ? 'Your passkey signs you in'
      : 'Take payments into this wallet'
  return (
    <Link
      href={shop ? '/dashboard' : name ? '/wallet/shop?go=signin' : '/wallet/shop?go=open'}
      className="w-shopcard"
    >
      <Awning height={22} stripe={16} />
      <span className="w-shopcard-body">
        <Art name="badge-shop" size={42} className="w-face" />
        <span className="w-shopcard-text">
          <small>{name ? 'Your shop' : 'Run a shop?'}</small>
          <strong>{name ?? 'Open a shop'}</strong>
          <span>{line}</span>
        </span>
        <span className="w-shopcard-go">
          <Icon name="arrow" size={18} />
        </span>
      </span>
    </Link>
  )
}

/** A wallet from before names were kept: ask once, like the app's restore does. */
function NameYourself() {
  const { setName } = useWallet()
  const [name, setText] = useState('')
  return (
    <form
      className="w-nameyourself"
      onSubmit={(e) => {
        e.preventDefault()
        if (name.trim()) setName(name)
      }}
    >
      <label htmlFor="w-name-yourself">
        <strong>What should people call you?</strong>
        <span>It’s the name people see when you ask them for money.</span>
      </label>
      <div className="w-nameyourself-row">
        <input
          id="w-name-yourself"
          value={name}
          onChange={(e) => setText(e.target.value)}
          placeholder="Your name"
          maxLength={40}
          autoComplete="name"
        />
        <button type="submit" className="pill" data-tone="ink" disabled={!name.trim()}>
          <span className="pill-label">Save</span>
          <span className="pill-cap">
            <Icon name="check" size={18} />
          </span>
        </button>
      </div>
    </form>
  )
}

const IOS_BETA_AWAY = 'kova.iosBeta.away'

/**
 * Kova for iOS is in beta: an invite on Home until it's tapped or put away. Hidden until the browser
 * says it wasn't put away before, so it never flashes. The link tells the waitlist it came from here.
 */
function IosBeta() {
  const [away, setAway] = useState(true)
  useEffect(() => {
    try {
      setAway(localStorage.getItem(IOS_BETA_AWAY) === '1')
    } catch {
      setAway(false)
    }
  }, [])
  if (away) return null
  const putAway = () => {
    try {
      localStorage.setItem(IOS_BETA_AWAY, '1')
    } catch {
      // Private mode: it comes back next visit, which is fine.
    }
    setAway(true)
  }
  return (
    <div className="w-ios">
      <a href="https://mykova.app/waitlist?ref=wallet" className="w-notice" onClick={putAway}>
        <span className="w-notice-icon">
          <Icon name="terminal" size={18} />
        </span>
        <span className="w-notice-text">
          <strong>Kova for iOS</strong>
          <span>Join the beta. The app comes through TestFlight.</span>
        </span>
        <span className="w-notice-cta">Join</span>
      </a>
      <button type="button" className="w-ios-away" aria-label="Not now" onClick={putAway}>
        <Icon name="close" size={14} />
      </button>
    </div>
  )
}
