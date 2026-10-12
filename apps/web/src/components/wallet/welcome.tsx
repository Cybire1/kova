'use client'

import { useEffect, useState } from 'react'
import { Art, Icon } from '@/components/brand'
import { passkeyDomain, passkeyHome } from '@/lib/passkey'
import {
  currencyInfo,
  type DisplayCurrency,
  displayCurrencies,
  guessCurrency,
} from '@/lib/wallet/money'
import { useWallet } from './provider'
import { Avatar } from './ui'
import { InAppNote } from './in-app'

type Step = { at: 'start' } | { at: 'name' } | { at: 'waiting'; what: 'create' | 'open' }

/**
 * Your Kova wallet on the web. One passkey is one Kova account: the passkey the Kova app made
 * opens the same wallet here, with your name, currency and people, and a wallet made here opens
 * in the app ("I already have Kova"). Nothing to install, no seed phrase, nothing kept but who you are.
 */
export function Welcome({ forShop = false }: { forShop?: boolean }) {
  const { create, open } = useWallet()
  const [step, setStep] = useState<Step>({ at: 'start' })
  const [name, setNameText] = useState('')
  const [currency, setCurrency] = useState<DisplayCurrency>('USD')
  const [error, setError] = useState<string | null>(null)
  const [home, setHome] = useState(true)

  useEffect(() => {
    setCurrency(guessCurrency())
    setHome(passkeyHome())
  }, [])

  const openWallet = async () => {
    setError(null)
    setStep({ at: 'waiting', what: 'open' })
    try {
      // Home takes over from here, and asks for a name if the wallet never had one.
      await open()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The passkey didn’t work. Try again.')
      setStep({ at: 'start' })
    }
  }

  const finish = async () => {
    const clean = name.trim()
    if (clean.length < 1) return setError('Write the name people know you by.')
    setError(null)
    setStep({ at: 'waiting', what: 'create' })
    try {
      await create(clean, currency)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The passkey didn’t work. Try again.')
      setStep({ at: 'name' })
    }
  }

  const making = step.at === 'waiting' && step.what === 'create'
  if (step.at === 'name' || making)
    return (
      <div className="w-welcome w-welcome-name">
        <h1 className="w-title">What should people call you?</h1>
        <form
          className="w-namecard"
          onSubmit={(e) => {
            e.preventDefault()
            void finish()
          }}
        >
          <div className="w-namecard-top">
            <Avatar name={name || '?'} size={36} />
            <span>Asks you for money</span>
          </div>
          <label className="sr-only" htmlFor="w-name">
            Your name
          </label>
          <input
            id="w-name"
            className="w-namecard-input"
            value={name}
            onChange={(e) => setNameText(e.target.value)}
            placeholder="Your name"
            maxLength={40}
            autoComplete="name"
            // biome-ignore lint/a11y/noAutofocus: the one field on this step
            autoFocus
          />
          <label className="w-namecard-currency">
            <span>Show my money in</span>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value as DisplayCurrency)}
            >
              {displayCurrencies.map((code) => (
                <option key={code} value={code}>
                  {currencyInfo[code].symbol} {currencyInfo[code].name}
                </option>
              ))}
            </select>
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <button type="submit" className="pill pill-block" data-tone="coral" disabled={making}>
            <span className="pill-label">
              {making ? 'Waiting for your passkey…' : 'Create with my passkey'}
            </span>
            <span className="pill-cap">
              <Icon name="face" size={18} />
            </span>
          </button>
        </form>
        <p className="w-fine">
          Your passkey protects this wallet, and your phone or computer keeps it, as it does your
          passwords. Kova never sees it.
        </p>
        <button
          type="button"
          className="textlink w-back-link"
          onClick={() => setStep({ at: 'start' })}
        >
          Back
        </button>
      </div>
    )

  return (
    <div className="w-welcome">
      <Art name="scene-welcome" size={224} className="w-welcome-art" priority />
      <h1 className="w-hero-title">Tap. Paid. Anywhere.</h1>
      <p className="w-lead">
        {forShop
          ? 'Your shop lives in your Kova wallet: its sales land there, and your passkey opens both. Open your wallet, or make one, then your shop.'
          : 'Your Kova wallet, in your browser. The same one as in the Kova app: one passkey, one wallet.'}
      </p>

      <InAppNote />

      {!home ? (
        <p className="form-note">
          Kova wallets open on <a href={`https://${passkeyDomain}/wallet`}>{passkeyDomain}</a>,
          where your passkey lives.
        </p>
      ) : null}

      <div className="w-ways">
        <button
          type="button"
          className="shop-wallet shop-wallet-make"
          disabled={step.at === 'waiting' || !home}
          onClick={() => void openWallet()}
        >
          <span className="wallet-glyph">
            {step.at === 'waiting' && step.what === 'open' ? (
              <span className="spinner w-spinner-light" aria-hidden="true" />
            ) : (
              <Icon name="face" size={16} />
            )}
          </span>
          <span>
            {step.at === 'waiting' && step.what === 'open'
              ? 'Waiting for your passkey…'
              : 'Open my Kova wallet'}
            <small className="wallet-sub">
              With the passkey from the Kova app, or one you made here
            </small>
          </span>
          <Icon name="arrow" size={18} />
        </button>
        <button
          type="button"
          className="shop-wallet shop-wallet-make"
          disabled={step.at === 'waiting' || !home}
          onClick={() => setStep({ at: 'name' })}
        >
          <span className="wallet-glyph wallet-glyph-coral">
            <Icon name="plus" size={16} />
          </span>
          <span>
            Create my wallet
            <small className="wallet-sub">
              Protected by your passkey. Nothing to install, no seed phrase.
            </small>
          </span>
          <Icon name="arrow" size={18} />
        </button>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      <p className="w-fine">
        On a Mac or iPhone, iCloud Keychain brings the Kova app’s passkey here. Anywhere else,
        choose “Use a phone” and scan the code with the phone that has Kova.
      </p>
    </div>
  )
}
