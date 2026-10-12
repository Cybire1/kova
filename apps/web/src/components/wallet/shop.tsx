'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import {
  openShopWithWallet,
  type ShopChoice,
  signInWithWallet,
  walletChallenge,
} from '@/app/actions'
import { Art, Icon } from '@/components/brand'
import { ScreenHead } from './activity'
import { useWallet } from './provider'

type Stage =
  | { at: 'choose' }
  | { at: 'working'; what: 'sign-in' | 'open' }
  | { at: 'no-shop' }
  | { at: 'pick'; message: string; signature: string; shops: ShopChoice[] }
  | { at: 'open' }

/**
 * Your shop, from your wallet. A shop opened here is owned by this wallet: its sales land in it,
 * you see them on Home, and you sign in to the shop with the same passkey, here or anywhere.
 */
export function Shop() {
  const router = useRouter()
  const go = useSearchParams().get('go')
  const { profile, signMessage, shop, rememberShop } = useWallet()
  const [stage, setStage] = useState<Stage>(go === 'open' ? { at: 'open' } : { at: 'choose' })
  const started = useRef(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const signIn = async (merchant?: string, proof?: { message: string; signature: string }) => {
    if (!profile) return
    setError(null)
    setStage({ at: 'working', what: 'sign-in' })
    try {
      let signed = proof
      if (!signed) {
        const challenge = await walletChallenge(profile.address, 'sign_in')
        if (!challenge.message) throw new Error(challenge.error ?? 'Kova didn’t answer. Try again.')
        signed = { message: challenge.message, signature: await signMessage(challenge.message) }
      }
      const result = await signInWithWallet({ ...signed, merchant })
      if (result.ok) {
        if (result.name) rememberShop(result.name)
        return router.push('/dashboard')
      }
      if (result.noShop) return setStage({ at: 'no-shop' })
      if (result.shops) return setStage({ at: 'pick', ...signed, shops: result.shops })
      throw new Error(result.error ?? 'Kova couldn’t sign you in.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kova couldn’t sign you in.')
      setStage({ at: 'choose' })
    }
  }

  const open = async () => {
    if (!profile) return
    if (name.trim().length < 2) return setError('Give your shop a name.')
    setError(null)
    setStage({ at: 'working', what: 'open' })
    try {
      const challenge = await walletChallenge(profile.address, 'open_shop')
      if (!challenge.message) throw new Error(challenge.error ?? 'Kova didn’t answer. Try again.')
      const signature = await signMessage(challenge.message)
      const opened = await openShopWithWallet({
        name,
        address: profile.address,
        message: challenge.message,
        signature,
      })
      if (!opened.ok) throw new Error(opened.error ?? 'Kova couldn’t open your shop.')
      rememberShop(opened.name ?? name.trim())
      router.push('/dashboard')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kova couldn’t open your shop.')
      setStage({ at: 'open' })
    }
  }

  // Signed in to a shop on this browser already: this screen is only the way in.
  useEffect(() => {
    if (shop) router.replace('/dashboard')
  }, [shop, router])

  // Sent here from Sign in with "Use my Kova passkey": the wallet is open, so sign in straight away.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, when the wallet is ready; signIn reads the latest profile when it runs
  useEffect(() => {
    if (go !== 'signin' || !profile || started.current) return
    started.current = true
    void signIn()
  }, [go, profile])

  const working = stage.at === 'working'
  if (!profile) return null
  return (
    <div className="w-screen">
      <ScreenHead title="Your shop" />
      <div className="w-shop">
        <Art name="scene-paid-terminal" size={144} className="w-shop-art" />
        <h1 className="w-title">Take payments into this wallet</h1>
        <p className="w-lead">
          A shop, a stall page and a till, with sales landing here in about a second. You sign in to
          it with your passkey, on the web or in the Kova app.
        </p>

        {stage.at === 'pick' ? (
          <div className="signin-panel">
            <p className="signin-panel-title">Which shop?</p>
            <div className="signin-shops">
              {stage.shops.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="shop-wallet shop-wallet-make"
                  onClick={() =>
                    void signIn(s.id, { message: stage.message, signature: stage.signature })
                  }
                >
                  <span className="wallet-glyph">
                    <Icon name="stall" size={16} />
                  </span>
                  <span>
                    {s.name}
                    <small className="wallet-sub">
                      Opened{' '}
                      {new Date(s.created_at).toLocaleDateString([], {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })}
                    </small>
                  </span>
                  <Icon name="arrow" size={18} />
                </button>
              ))}
            </div>
          </div>
        ) : stage.at === 'open' ||
          (stage.at === 'working' && stage.what === 'open') ||
          stage.at === 'no-shop' ? (
          <form
            className="w-namecard"
            onSubmit={(e) => {
              e.preventDefault()
              void open()
            }}
          >
            {stage.at === 'no-shop' ? (
              <p className="w-namecard-note">
                No shop signs in with this wallet yet. Open one: it takes a name.
              </p>
            ) : null}
            <div className="w-namecard-top">
              <Art name="badge-shop" size={40} className="w-face" />
              <span>Your shop’s name</span>
            </div>
            <label className="sr-only" htmlFor="w-shop-name">
              Shop name
            </label>
            <input
              id="w-shop-name"
              className="w-namecard-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ada’s Bakery"
              maxLength={60}
              autoComplete="organization"
            />
            {error ? <p className="form-error">{error}</p> : null}
            <button type="submit" className="pill pill-block" data-tone="coral" disabled={working}>
              <span className="pill-label">{working ? 'Opening your shop…' : 'Open my shop'}</span>
              <span className="pill-cap">
                <Icon name="face" size={18} />
              </span>
            </button>
            <button
              type="button"
              className="textlink w-back-link"
              disabled={working}
              onClick={() => void signIn()}
            >
              I already have a shop
            </button>
            <p className="w-fine">
              Payments land in this wallet, {profile.address.slice(0, 6)}…
              {profile.address.slice(-4)}. Kova never holds them.
            </p>
          </form>
        ) : (
          <div className="w-ways">
            <button
              type="button"
              className="shop-wallet shop-wallet-make"
              disabled={working}
              onClick={() => setStage({ at: 'open' })}
            >
              <span className="wallet-glyph wallet-glyph-coral">
                <Icon name="plus" size={16} />
              </span>
              <span>
                Open a shop
                <small className="wallet-sub">It takes a name. Sales land in this wallet.</small>
              </span>
              <Icon name="arrow" size={18} />
            </button>
            <button
              type="button"
              className="shop-wallet shop-wallet-make"
              disabled={working}
              onClick={() => void signIn()}
            >
              <span className="wallet-glyph">
                {working ? (
                  <span className="spinner w-spinner-light" aria-hidden="true" />
                ) : (
                  <Icon name="face" size={16} />
                )}
              </span>
              <span>
                {working ? 'Signing in…' : 'Sign in to my shop'}
                <small className="wallet-sub">
                  A shop you opened with this wallet, here or in the app
                </small>
              </span>
              <Icon name="arrow" size={18} />
            </button>
          </div>
        )}
        {error && stage.at === 'choose' ? <p className="form-error">{error}</p> : null}
        <p className="w-fine">
          Opened your shop with email, Google or a secret key?{' '}
          <a href="/signin">Sign in to it here</a>.
        </p>
      </div>
    </div>
  )
}
