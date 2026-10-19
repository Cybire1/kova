'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { linkShopOwner, settleToWallet, walletChallenge } from '@/app/actions'
import { passkeyDomain, passkeyHome } from '@/lib/passkey'
import { openWalletSigner, type WalletIdentity } from '@/lib/wallet/signer'
import { Icon } from './brand'

/** Who this browser's Kova wallet is: what /wallet remembers, with nothing secret in it. */
type WebWallet = WalletIdentity

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`
/** The wallet's Your shop card reads this, so Home shows the shop the passkey now opens. */
const rememberShop = (address: string, name: string) => {
  try {
    localStorage.setItem(`kova.web.shop.v1.${address.toLowerCase()}`, JSON.stringify(name))
  } catch {
    // No storage: Home just won't name the shop.
  }
}
const same = (a: string | null | undefined, b: string | null | undefined) =>
  Boolean(a && b && a.toLowerCase() === b.toLowerCase())

/**
 * One account: a shop opened with a key, with email or on a phone before shops had owners signs
 * in with the Kova passkey from here on, and its money can land in that same wallet, where the
 * app and the web both show it. The passkey signs once to prove the wallet is yours.
 */
export function PasskeyOwner({
  shop,
  owner,
  settlement,
}: {
  shop: string
  owner: string | null
  settlement: string
}) {
  const router = useRouter()
  const [wallet, setWallet] = useState<WebWallet | null>(null)
  const [home, setHome] = useState(true)
  const [settle, setSettle] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setHome(passkeyHome())
    try {
      const raw = localStorage.getItem('kova.web.profile.v1')
      if (raw) setWallet(JSON.parse(raw) as WebWallet)
    } catch {
      // No storage: no wallet on this browser.
    }
  }, [])

  const linked = same(owner, wallet?.address)
  const paysWallet = same(settlement, wallet?.address)

  useEffect(() => {
    if (linked && wallet) rememberShop(wallet.address, shop)
  }, [linked, wallet, shop])

  const link = async () => {
    if (!wallet) return
    setWorking(true)
    setError(null)
    try {
      const challenge = await walletChallenge(wallet.address, 'own_shop')
      if (!challenge.message) throw new Error(challenge.error ?? 'Kova didn’t answer. Try again.')
      const { session, account } = await openWalletSigner(wallet)
      try {
        if (!same(account.address, wallet.address))
          throw new Error(
            'That passkey opens a different Kova wallet. Choose the one for this wallet.',
          )
        const signature = await account.signMessage({ message: challenge.message })
        const result = await linkShopOwner({
          message: challenge.message,
          signature,
          settleTo: settle && !paysWallet ? wallet.address : undefined,
        })
        if (result.error) throw new Error(result.error)
      } finally {
        session.end()
      }
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kova couldn’t link your wallet. Try again.')
    } finally {
      setWorking(false)
    }
  }

  const payHere = async () => {
    if (!wallet) return
    setWorking(true)
    setError(null)
    const result = await settleToWallet(wallet.address)
    if (result.error) setError(result.error)
    else router.refresh()
    setWorking(false)
  }

  return (
    <section className="card card-pad owner-card" aria-label="Sign-in">
      <div className="owner-head">
        <span className={`owner-icon${linked ? ' owner-icon-on' : ''}`}>
          <Icon name={linked ? 'check' : 'face'} size={20} />
        </span>
        <div>
          <h2 className="setting-title">
            {linked ? 'Your Kova passkey signs in here' : 'Sign in with your Kova passkey'}
          </h2>
          <p className="field-help">
            {linked && wallet
              ? `This shop belongs to ${wallet.name ? `${wallet.name}’s` : 'your'} Kova wallet, ${short(wallet.address)}. Your passkey opens it here and in the Kova app.`
              : owner
                ? `This shop signs in with another wallet, ${short(owner)}. Switch it to your Kova wallet, and your passkey opens it everywhere.`
                : 'This shop signs in with a secret key or email. Link it to your Kova wallet, and your passkey opens it here and in the Kova app.'}
          </p>
        </div>
      </div>

      {!home && wallet?.auth !== 'google' ? (
        <p className="form-note">
          Passkeys for Kova work on{' '}
          <a href={`https://${passkeyDomain}/dashboard/settings`}>{passkeyDomain}</a>.
        </p>
      ) : !wallet ? (
        <div className="owner-actions">
          <p className="field-help">
            Open your Kova wallet on this browser first, then come back here from its Your shop
            card.
          </p>
          <Link href="/wallet" className="mini mini-ink">
            <Icon name="card" size={14} /> Open my wallet
          </Link>
        </div>
      ) : linked ? (
        paysWallet ? (
          <p className="owner-ok">
            <Icon name="check" size={16} /> Payments land in this wallet too, so you see every sale
            in it.
          </p>
        ) : (
          <div className="owner-actions">
            <p className="field-help">Payments still land in {short(settlement)}.</p>
            <button
              type="button"
              className="mini mini-ink"
              disabled={working}
              onClick={() => void payHere()}
            >
              <Icon name="card" size={14} /> {working ? 'Moving…' : 'Get paid into my Kova wallet'}
            </button>
          </div>
        )
      ) : (
        <div className="owner-actions">
          {!paysWallet ? (
            <label className="checkline">
              <input
                type="checkbox"
                checked={settle}
                onChange={(e) => setSettle(e.target.checked)}
              />
              Get paid into my Kova wallet too ({short(wallet.address)})
            </label>
          ) : null}
          <button
            type="button"
            className="pill"
            data-tone="coral"
            disabled={working}
            onClick={() => void link()}
          >
            <span className="pill-label">
              {working ? 'Waiting for your passkey…' : 'Use my Kova passkey'}
            </span>
            <span className="pill-cap">
              <Icon name="face" size={18} />
            </span>
          </button>
        </div>
      )}
      {error ? <p className="form-error">{error}</p> : null}
    </section>
  )
}
