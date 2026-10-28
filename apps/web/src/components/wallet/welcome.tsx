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
import { InAppNote } from './in-app'
import { useWallet } from './provider'
import { Avatar } from './ui'

type Step = { at: 'start' } | { at: 'name' } | { at: 'waiting'; what: 'create' | 'open' }

/**
 * Your Kova wallet on the web. One passkey is one Kova account: the passkey the Kova app made
 * opens the same wallet here, with your name, currency and people, and a wallet made here opens
 * in the app ("I already have Kova"). Nothing to install, no seed phrase, nothing kept but who you are.
 */
export function Welcome({
  forShop = false,
  invitation,
}: {
  forShop?: boolean
  invitation?: { amount: string; sender: string; phone: string }
}) {
  const { create, open, signInGoogle, googleEnabled, googleBusy, googleError } = useWallet()
  const [step, setStep] = useState<Step>({ at: 'start' })
  const [name, setNameText] = useState('')
  const [currency, setCurrency] = useState<DisplayCurrency>('USD')
  const [error, setError] = useState<string | null>(null)
  const [home, setHome] = useState(true)
  // Opened from the Home Screen: an iPhone keeps a Home Screen app's storage apart from the
  // browser's, so someone who already has Kova arrives signed out. Their passkey comes first.
  const [installed, setInstalled] = useState(false)

  useEffect(() => {
    setCurrency(guessCurrency())
    setHome(passkeyHome())
    setInstalled(
      window.matchMedia('(display-mode: standalone)').matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true,
    )
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
      <h1 className="w-hero-title">
        {invitation
          ? `$${invitation.amount} is waiting for you`
          : installed
            ? 'Welcome back'
            : 'Tap. Paid. Anywhere.'}
      </h1>
      <p className="w-lead">
        {invitation
          ? `${invitation.sender} sent you dollars on Kova. Open or create your wallet, then verify ${invitation.phone} to claim them.`
          : forShop
            ? 'Your shop lives in your Kova wallet: its sales land there, and your wallet opens both. Sign in with Google or a passkey, then open your shop.'
            : installed
              ? 'Open your wallet with Face ID: the same one as in your browser.'
              : 'Your Kova wallet, in your browser and the app. Open it with Google or a passkey.'}
      </p>

      <InAppNote />

      {!home ? (
        <p className="form-note">
          Kova wallets open on <a href={`https://${passkeyDomain}/wallet`}>{passkeyDomain}</a>,
          where your passkey lives.
        </p>
      ) : null}

      <div className="w-ways">
        {installed ? (
          <>
            <button
              type="button"
              className="shop-wallet shop-wallet-make"
              disabled={step.at === 'waiting' || googleBusy || !home}
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
            {googleEnabled ? (
              <button
                type="button"
                className="shop-wallet shop-wallet-make"
                disabled={googleBusy || step.at === 'waiting'}
                onClick={() => {
                  setError(null)
                  void signInGoogle().catch((error: unknown) => {
                    setError(
                      error instanceof Error ? error.message : 'Google sign-in failed. Try again.',
                    )
                  })
                }}
              >
                <span className="wallet-glyph" aria-hidden="true" style={{ background: '#fff' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.24 1.06-3.71 1.06-2.87 0-5.3-1.94-6.17-4.54H2.15v2.84C3.96 20.53 7.69 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.83 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.15A10.9 10.9 0 001 12c0 1.78.43 3.45 1.15 4.93l3.68-2.84z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.16-3.16C17.45 2.08 14.97 1 12 1 7.69 1 3.96 3.47 2.15 7.07l3.68 2.84c.87-2.6 3.3-4.53 6.17-4.53z"
                    />
                  </svg>
                </span>
                <span>
                  {googleBusy ? 'Opening your wallet…' : 'Continue with Google'}
                  <small className="wallet-sub">
                    New here or coming back: the same Google account opens the same wallet
                  </small>
                </span>
                <Icon name="arrow" size={18} />
              </button>
            ) : null}
          </>
        ) : (
          <>
            {googleEnabled ? (
              <button
                type="button"
                className="shop-wallet shop-wallet-make"
                disabled={googleBusy || step.at === 'waiting'}
                onClick={() => {
                  setError(null)
                  void signInGoogle().catch((error: unknown) => {
                    setError(
                      error instanceof Error ? error.message : 'Google sign-in failed. Try again.',
                    )
                  })
                }}
              >
                <span className="wallet-glyph" aria-hidden="true" style={{ background: '#fff' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.24 1.06-3.71 1.06-2.87 0-5.3-1.94-6.17-4.54H2.15v2.84C3.96 20.53 7.69 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.83 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.15A10.9 10.9 0 001 12c0 1.78.43 3.45 1.15 4.93l3.68-2.84z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.16-3.16C17.45 2.08 14.97 1 12 1 7.69 1 3.96 3.47 2.15 7.07l3.68 2.84c.87-2.6 3.3-4.53 6.17-4.53z"
                    />
                  </svg>
                </span>
                <span>
                  {googleBusy ? 'Opening your wallet…' : 'Continue with Google'}
                  <small className="wallet-sub">
                    New here or coming back: the same Google account opens the same wallet
                  </small>
                </span>
                <Icon name="arrow" size={18} />
              </button>
            ) : null}
            <button
              type="button"
              className="shop-wallet shop-wallet-make"
              disabled={step.at === 'waiting' || googleBusy || !home}
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
          </>
        )}
        <button
          type="button"
          className="shop-wallet shop-wallet-make"
          disabled={step.at === 'waiting' || googleBusy || !home}
          onClick={() => setStep({ at: 'name' })}
        >
          <span className="wallet-glyph wallet-glyph-coral">
            <Icon name="plus" size={16} />
          </span>
          <span>
            Create with a passkey
            <small className="wallet-sub">
              Protected by your passkey. Nothing to install, no seed phrase.
            </small>
          </span>
          <Icon name="arrow" size={18} />
        </button>
      </div>
      {error || googleError ? (
        <p className="form-error" role="alert">
          {error || googleError}
        </p>
      ) : null}
      <p className="w-fine">
        On a Mac or iPhone, iCloud Keychain brings the Kova app’s passkey here. Anywhere else,
        choose “Use a phone” and scan the code with the phone that has Kova.
      </p>
    </div>
  )
}
