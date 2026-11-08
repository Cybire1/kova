'use client'

import { extensionConnectMessage } from '@kova/monad'
import { useEffect, useState } from 'react'
import { LogoMark, Wordmark } from '@/components/brand'
import { useWallet } from '@/components/wallet/provider'
import {
  answerExtension,
  type ExtensionAnswer,
  type ExtensionRequest,
  readExtensionRequest,
} from '@/lib/extension'
import { returningFromPrivy } from '@/lib/privy-return'
import { freeze, listKeys, removeKey, type SpendKey, switchOn } from '@/lib/wallet/keys'

type Phase = 'ready' | 'busy' | 'done'

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

/**
 * Google sign-in leaves this page for Google and comes back without the request in the address.
 * The request is kept in this window's session for ten minutes, and read back on the way in.
 */
const KEPT = 'kova.extension.request'
function requestHash(): string {
  const hash = window.location.hash
  try {
    if (hash.length > 1) sessionStorage.setItem(KEPT, JSON.stringify({ hash, at: Date.now() }))
    else if (returningFromPrivy()) {
      const kept = JSON.parse(sessionStorage.getItem(KEPT) ?? 'null') as {
        hash?: string
        at?: number
      } | null
      if (kept?.hash && typeof kept.at === 'number' && Date.now() - kept.at < 10 * 60_000)
        return kept.hash
    }
  } catch {
    // No session storage: Google sign-in can't bring the request back, the passkey still works.
  }
  return hash
}
const dollars = (v: string) => `$${v.replace(/\.00$/, '')}`

/**
 * mykova.app/extension: the one place Kova for Chrome borrows the wallet. It shows what the
 * extension asked for in plain words (amounts read from Kova, never from the request), asks the
 * wallet's passkey (Face ID, Touch ID) or Google, does it, and hands the answer back.
 */
export function ExtensionApproval() {
  const wallet = useWallet()
  const [request, setRequest] = useState<ExtensionRequest | null | undefined>(undefined)
  const [key, setKey] = useState<SpendKey | null>(null)
  const [keyError, setKeyError] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('ready')
  const [error, setError] = useState<string | null>(null)
  const [unreachable, setUnreachable] = useState(false)

  useEffect(() => {
    setRequest(readExtensionRequest(requestHash()))
  }, [])

  const owner = request && request.action !== 'connect' ? request.owner : null
  const mismatch =
    !!owner &&
    wallet.status === 'ready' &&
    !!wallet.profile &&
    wallet.profile.address.toLowerCase() !== owner.toLowerCase()

  // The budget's own terms, from Kova: the request only says which key.
  useEffect(() => {
    if (!request || request.action === 'connect' || request.action === 'sign') return
    let live = true
    listKeys(request.owner)
      .then((list) => {
        if (!live) return
        const found = list.data.find((k) => k.id === request.key)
        if (found) setKey(found)
        else setKeyError('Kova doesn’t know this budget. Try again from Kova for Chrome.')
      })
      .catch((e: Error) => live && setKeyError(e.message))
    return () => {
      live = false
    }
  }, [request])

  const finish = (answer: ExtensionAnswer) => {
    if (!request) return
    if (!answerExtension(request, answer)) {
      setUnreachable(true)
      return
    }
    if (answer.ok) setPhase('done')
    window.setTimeout(() => window.close(), answer.ok ? 700 : 150)
  }

  const cancel = () =>
    request &&
    finish({
      type: 'kova-approval',
      id: request.id,
      ok: false,
      error: 'Cancelled',
      cancelled: true,
    })

  const run = async () => {
    if (!request || !wallet.profile) return
    setPhase('busy')
    setError(null)
    try {
      const me = wallet.profile.address
      let data: Record<string, unknown> = {}
      if (request.action === 'connect') {
        const at = Math.floor(Date.now() / 1000)
        const signature = await wallet.signMessage(extensionConnectMessage({ wallet: me, at }))
        data = {
          address: me,
          name: wallet.profile.name,
          currency: wallet.profile.currency,
          at,
          signature,
        }
      } else if (request.action === 'sign') {
        data = { signature: await wallet.signMessage(request.message) }
      } else {
        if (!key) throw new Error('One moment: Kova is still reading this budget.')
        if (request.action === 'link') data = { key: await switchOn(me, key, wallet.signTypedData) }
        else if (request.action === 'unfreeze')
          data = { key: await freeze(me, key, false, wallet.signTypedData) }
        else {
          await removeKey(me, key, wallet.signTypedData, wallet.signMessage)
          data = { removed: true }
        }
      }
      finish({ type: 'kova-approval', id: request.id, ok: true, data })
    } catch (e) {
      setPhase('ready')
      setError(e instanceof Error ? e.message : 'That didn’t go through. Nothing moved.')
    }
  }

  const google = wallet.profile?.auth === 'google'

  if (request === undefined || wallet.status === 'loading') return <Frame busy />

  if (request === null)
    return (
      <Frame>
        <h1>This link isn’t from Kova for Chrome</h1>
        <p className="kx-lead">Open Kova for Chrome and try again from there.</p>
      </Frame>
    )

  if (wallet.status === 'none' || !wallet.profile)
    return (
      <Frame>
        <h1>Open your Kova wallet</h1>
        <p className="kx-lead">
          Kova for Chrome uses the same wallet as the Kova app. Open it the way you open the app:
          with your passkey, or with Google.
        </p>
        {(error ?? wallet.googleError) ? (
          <p className="kx-error">{error ?? wallet.googleError}</p>
        ) : null}
        <div className="kx-actions">
          <button
            type="button"
            className="kx-btn kx-ink"
            disabled={wallet.googleBusy}
            onClick={() => {
              setError(null)
              wallet.open().catch((e: Error) => setError(e.message))
            }}
          >
            Open with passkey
          </button>
          {wallet.googleEnabled ? (
            <button
              type="button"
              className="kx-btn kx-soft kx-google"
              disabled={wallet.googleBusy}
              onClick={() => {
                setError(null)
                wallet.signInGoogle().catch((e: Error) => setError(e.message))
              }}
            >
              <GoogleMark />
              {wallet.googleBusy ? 'Opening your wallet…' : 'Continue with Google'}
            </button>
          ) : null}
          <a className="kx-btn kx-soft" href="/wallet" target="_blank" rel="noopener">
            New to Kova? Make a wallet
          </a>
        </div>
      </Frame>
    )

  if (mismatch)
    return (
      <Frame>
        <h1>A different wallet is open here</h1>
        <p className="kx-lead">
          Kova for Chrome is connected to {short(owner ?? '')}, but this browser has{' '}
          {short(wallet.profile.address)} open. Open the same wallet, or connect Kova for Chrome
          again.
        </p>
        <div className="kx-actions">
          <button type="button" className="kx-btn kx-soft" onClick={cancel}>
            Close
          </button>
        </div>
      </Frame>
    )

  if (unreachable)
    return (
      <Frame>
        <h1>Kova for Chrome didn’t answer</h1>
        <p className="kx-lead">
          Open this from Kova for Chrome, in Chrome, with the extension switched on.
        </p>
      </Frame>
    )

  if (phase === 'done')
    return (
      <Frame>
        <div className="kx-done" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
            <path
              d="m5 12.5 4.5 4.5L19 7.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <h1 className="kx-center">Done</h1>
        <p className="kx-lead kx-center">You can go back to the site.</p>
      </Frame>
    )

  const site = key?.name ?? (request.action === 'sign' ? request.site : null)
  const busy = phase === 'busy'
  const faceLabel = (verb: string) =>
    busy ? 'One moment…' : `${verb} with ${google ? 'Google' : 'your passkey'}`

  return (
    <Frame google={google}>
      {request.action === 'connect' ? (
        <>
          <span className="kx-tag">Kova for Chrome</span>
          <h1>Connect this browser</h1>
          <div className="kx-who">
            <span className="kx-av">{wallet.profile.name.slice(0, 1).toUpperCase() || 'K'}</span>
            <span>
              <b>{wallet.profile.name || 'Your wallet'}</b>
              <small>{short(wallet.profile.address)}</small>
            </span>
          </div>
          <ul className="kx-points">
            <li>Kova for Chrome can see your address and balance.</li>
            <li>Every website gets its own budget, which you approve here.</li>
            <li>It can never move the rest of your dollars.</li>
          </ul>
        </>
      ) : request.action === 'sign' ? (
        <>
          <span className="kx-tag">{site}</span>
          <h1>{site} asks you to sign</h1>
          <pre className="kx-message">{request.message}</pre>
          <p className="kx-fine">Signing proves it’s you. It moves no money.</p>
        </>
      ) : key ? (
        <>
          <span className="kx-tag">{key.name}</span>
          {request.action === 'link' ? (
            <>
              <h1>
                Give {key.name} up to {dollars(key.limit)} a {key.period}
              </h1>
              <ul className="kx-points">
                <li>
                  It can spend up to {dollars(key.limit)} a {key.period} of your Kova dollars. Monad
                  enforces the limit, not just Kova.
                </li>
                <li>It can’t see or move the rest of your balance.</li>
                <li>Freeze or remove it any time from Kova for Chrome or the app.</li>
              </ul>
            </>
          ) : request.action === 'unfreeze' ? (
            <>
              <h1>Unfreeze {key.name}</h1>
              <p className="kx-lead">
                It can spend again, up to {dollars(key.limit)} a {key.period}.
              </p>
            </>
          ) : (
            <>
              <h1>Remove {key.name}</h1>
              <p className="kx-lead">
                Its budget ends now, on Monad too. Your dollars stay where they are.
              </p>
            </>
          )}
        </>
      ) : (
        <>
          <h1>Reading this budget…</h1>
          {keyError ? <p className="kx-error">{keyError}</p> : null}
        </>
      )}

      {error ? <p className="kx-error">{error}</p> : null}
      <div className="kx-actions">
        <button
          type="button"
          className={request.action === 'remove' ? 'kx-btn kx-coral' : 'kx-btn kx-ink'}
          disabled={busy || (request.action !== 'connect' && request.action !== 'sign' && !key)}
          onClick={() => void run()}
        >
          {request.action === 'connect'
            ? faceLabel('Connect')
            : request.action === 'sign'
              ? faceLabel('Sign')
              : request.action === 'link'
                ? faceLabel('Switch on')
                : request.action === 'unfreeze'
                  ? faceLabel('Unfreeze')
                  : faceLabel('Remove')}
        </button>
        <button type="button" className="kx-btn kx-soft" onClick={cancel} disabled={busy}>
          Not now
        </button>
      </div>
    </Frame>
  )
}

function Frame({
  children,
  busy,
  google,
}: {
  children?: React.ReactNode
  busy?: boolean
  google?: boolean
}) {
  return (
    <main className="kx">
      <header className="kx-head">
        <LogoMark size={26} />
        <Wordmark height={16} />
      </header>
      <section className="kx-body">{busy ? <div className="kx-spin" /> : children}</section>
      <footer className="kx-foot">
        {google
          ? 'Kova never sees your Google password.'
          : 'Your passkey never leaves this device.'}
      </footer>
    </main>
  )
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
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
  )
}
