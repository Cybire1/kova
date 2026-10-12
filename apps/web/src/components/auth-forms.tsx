'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useActionState, useCallback, useEffect, useRef, useState } from 'react'
import { stringToHex } from 'viem'
import {
  type FormState,
  type ShopChoice,
  signIn,
  signInDemo,
  signInWithWallet,
  walletChallenge,
} from '@/app/actions'
import { returningFromPrivy } from '@/lib/privy-return'
import { Icon, Pill } from './brand'
import type { EmbeddedWallet } from './privy-wallet'

// Privy is only downloaded when someone chooses email or Google, or comes back from Google.
const PrivyWallet = dynamic(() => import('./privy-wallet'), { ssr: false })

/** An email wallet signs without a prompt of its own (Privy's wallet UI is off): the page is the prompt. */
async function signWith(wallet: EmbeddedWallet, text: string) {
  return (await wallet.provider.request({
    method: 'personal_sign',
    params: [stringToHex(text), wallet.address],
  })) as string
}

const explain = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback

// --- Signing in -------------------------------------------------------------------------

export function SignInForm({
  notice,
  privyAppId,
  chainId,
}: {
  notice?: string
  privyAppId?: string | null
  chainId: number
}) {
  // Without Privy the secret key is the only way in, so it starts open.
  const [withKey, setWithKey] = useState(!privyAppId)
  const keyStart = chainId === 143 ? 'kova_live_sk_' : 'kova_test_sk_'
  return (
    <div className="auth-card">
      <h1>Welcome back</h1>
      <p className="auth-lead">
        {privyAppId
          ? 'Sign in the way you opened your shop.'
          : 'Sign in with your shop’s secret key.'}
      </p>
      {notice ? <p className="form-note">{notice}</p> : null}
      <div className="signin-ways">
        <Link href="/wallet/shop?go=signin" className="shop-wallet shop-wallet-make">
          <span className="wallet-glyph">
            <Icon name="face" size={16} />
          </span>
          <span>
            Use my Kova passkey
            <small className="wallet-sub">
              The one from the Kova app, or your Kova wallet on the web
            </small>
          </span>
          <Icon name="arrow" size={18} />
        </Link>
        {privyAppId ? <EmailSignIn appId={privyAppId} chainId={chainId} /> : null}
        {withKey ? (
          <KeySignIn keyStart={keyStart} focus={Boolean(privyAppId)} />
        ) : (
          <button
            type="button"
            className="shop-wallet shop-wallet-make"
            onClick={() => setWithKey(true)}
          >
            <span className="wallet-glyph">
              <Icon name="key" size={16} />
            </span>
            <span>
              Use a secret key
              <small className="wallet-sub">The {keyStart}… key you saved</small>
            </span>
            <Icon name="chevron" size={18} />
          </button>
        )}
      </div>
      <div className="auth-or">
        <span>or</span>
      </div>
      <form action={signInDemo}>
        <Pill type="submit" icon="tap" tone="light" wide>
          Explore the demo shop
        </Pill>
      </form>
      <p className="auth-switch">
        New to Kova? <Link href="/signup">Open a shop</Link>
      </p>
    </div>
  )
}

function KeySignIn({ keyStart, focus }: { keyStart: string; focus: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(signIn, {})
  const [show, setShow] = useState(false)
  const field = useRef<HTMLInputElement>(null)
  // Opened on purpose, so the cursor goes straight to the key. On a page where it's the only way
  // in, the page loads without grabbing focus.
  useEffect(() => {
    if (focus) field.current?.focus()
  }, [focus])
  return (
    <form action={action} className="stack-form signin-key">
      <label className="field-label" htmlFor="key">
        Secret key
      </label>
      <div className="keyfield">
        <input
          id="key"
          name="key"
          type={show ? 'text' : 'password'}
          placeholder={`${keyStart}…`}
          autoComplete="current-password"
          spellCheck={false}
          required
          ref={field}
        />
        <button
          type="button"
          className="round"
          aria-label={show ? 'Hide key' : 'Show key'}
          onClick={() => setShow(!show)}
        >
          <Icon name="eye" size={18} />
        </button>
      </div>
      {state.error ? <p className="form-error">{state.error}</p> : null}
      <Pill type="submit" icon="arrow" disabled={pending} wide>
        {pending ? 'Checking' : 'Sign in'}
      </Pill>
    </form>
  )
}

interface Proof {
  message: string
  signature: string
}

type Step =
  | { at: 'idle' }
  | { at: 'privy' }
  | { at: 'checking'; who: string }
  | { at: 'choose'; wallet: EmbeddedWallet; proof: Proof; shops: ShopChoice[]; picking?: string }
  | { at: 'no-shop'; wallet: EmbeddedWallet }
  | { at: 'done'; who: string }
  | { at: 'problem'; message: string }

const openedOn = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })

/**
 * Signing in the way most shops open: with the email or Google account their wallet was made
 * with. Privy signs them in and hands over that wallet, the wallet signs Kova's sign-in message
 * without a prompt, and Kova opens the shop that wallet owns.
 */
function EmailSignIn({ appId, chainId }: { appId: string; chainId: number }) {
  const router = useRouter()
  const [step, setStep] = useState<Step>({ at: 'idle' })
  // Every attempt is a new Privy sign-in that asks who they are, even if someone was signed in here.
  const [attempt, setAttempt] = useState(0)

  // Back from Google: Privy picks up where it left off.
  useEffect(() => {
    if (returningFromPrivy()) setStep({ at: 'privy' })
  }, [])

  const finish = useCallback(
    async (wallet: EmbeddedWallet, proof: Proof, merchant?: string) => {
      const result = await signInWithWallet({ ...proof, merchant })
      if (result.ok) {
        setStep({ at: 'done', who: wallet.signedInAs })
        // Kova's session runs the dashboard now. Privy's would only sign the next person here in as them.
        await wallet.logout().catch(() => {})
        router.replace('/dashboard')
      } else if (result.noShop) setStep({ at: 'no-shop', wallet })
      else if (result.shops) setStep({ at: 'choose', wallet, proof, shops: result.shops })
      else {
        await wallet.logout().catch(() => {})
        setStep({ at: 'problem', message: result.error ?? 'Kova couldn’t sign you in. Try again.' })
      }
    },
    [router],
  )

  const onWallet = useCallback(
    async (wallet: EmbeddedWallet) => {
      setStep({ at: 'checking', who: wallet.signedInAs })
      try {
        const challenge = await walletChallenge(wallet.address, 'sign_in')
        if (!challenge.message) throw new Error(challenge.error ?? 'Kova didn’t answer. Try again.')
        await finish(wallet, {
          message: challenge.message,
          signature: await signWith(wallet, challenge.message),
        })
      } catch (error) {
        await wallet.logout().catch(() => {})
        setStep({ at: 'problem', message: explain(error, 'Kova couldn’t sign you in. Try again.') })
      }
    },
    [finish],
  )
  const onCancel = useCallback(() => setStep({ at: 'idle' }), [])

  const start = () => {
    setAttempt((n) => n + 1)
    setStep({ at: 'privy' })
  }

  const differentEmail = (
    <button type="button" className="textlink inline-link signin-again" onClick={start}>
      Use a different email
    </button>
  )

  return (
    <>
      {step.at !== 'idle' && step.at !== 'problem' ? (
        <PrivyWallet
          key={attempt}
          appId={appId}
          chainId={chainId}
          onWallet={onWallet}
          onCancel={onCancel}
          title="Sign in to your shop"
          fresh
        />
      ) : null}

      {step.at === 'checking' || step.at === 'done' ? (
        <div className="shop-wallet" role="status">
          <span className="wallet-glyph wallet-glyph-coral">
            <span className="spinner" aria-hidden="true" />
          </span>
          <span>
            {step.at === 'done' ? 'Opening your dashboard' : `Signing in as ${step.who}`}
            <small className="wallet-sub">
              {step.at === 'done' ? `Signed in as ${step.who}` : 'Checking it’s your shop’s wallet'}
            </small>
          </span>
        </div>
      ) : step.at === 'no-shop' ? (
        <div className="signin-panel" role="status">
          <p className="signin-panel-title">No shop uses {step.wallet.signedInAs} yet</p>
          <p className="signin-panel-body">
            New shops open in the Kova app: your wallet first, then your shop. It takes a passkey
            and a name.
          </p>
          <Pill href="/wallet/shop?go=open" icon="arrow" tone="coral" wide>
            Open a shop in the Kova app
          </Pill>
          {differentEmail}
        </div>
      ) : step.at === 'choose' ? (
        <div className="signin-panel">
          <p className="signin-panel-title">Which shop?</p>
          <p className="signin-panel-body">
            {step.wallet.signedInAs} signs in to {step.shops.length} shops.
          </p>
          <div className="signin-shops">
            {step.shops.map((shop) => (
              <button
                key={shop.id}
                type="button"
                className="shop-wallet shop-wallet-make"
                disabled={Boolean(step.picking)}
                onClick={() => {
                  setStep({ ...step, picking: shop.id })
                  void finish(step.wallet, step.proof, shop.id)
                }}
              >
                <span className="wallet-glyph">
                  <Icon name="stall" size={16} />
                </span>
                <span>
                  {shop.name}
                  <small className="wallet-sub">Opened {openedOn(shop.created_at)}</small>
                </span>
                {step.picking === shop.id ? (
                  <span className="spinner" aria-hidden="true" />
                ) : (
                  <Icon name="arrow" size={18} />
                )}
              </button>
            ))}
          </div>
          {differentEmail}
        </div>
      ) : (
        <>
          <button
            type="button"
            className="shop-wallet shop-wallet-make"
            disabled={step.at === 'privy'}
            onClick={start}
          >
            <span className="wallet-glyph wallet-glyph-coral">
              <Icon name="mail" size={16} />
            </span>
            <span>
              {step.at === 'privy' ? 'Opening sign-in…' : 'Continue with email or\u00a0Google'}
              <small className="wallet-sub">The one you opened your shop with</small>
            </span>
            <Icon name="arrow" size={18} />
          </button>
          {step.at === 'problem' ? <p className="form-error">{step.message}</p> : null}
        </>
      )}
    </>
  )
}
