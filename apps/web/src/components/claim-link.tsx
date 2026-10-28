'use client'

import { getToken } from '@kova/monad'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type Address, getAddress, type Hex, isAddress, isAddressEqual } from 'viem'
import { passkeyDomain, passkeyHome } from '@/lib/passkey'
import { returningFromPrivy } from '@/lib/privy-return'
import {
  type Claimed,
  claimLink,
  type DollarLink,
  keptKey,
  keyOpens,
  linkBase,
  linkKeyFrom,
  linkNetwork,
  linkUrl,
} from '@/lib/wallet/dollar-links'
import {
  baseToNumber,
  currencyInfo,
  type DisplayCurrency,
  displayCurrencies,
  formatLocal,
  formatUsd,
  guessCurrency,
  isDisplayCurrency,
  type LiveRates,
  rateLabel,
  ratesFrom,
} from '@/lib/wallet/money'
import { Art, Icon } from './brand'
import { KeepInKova } from './keep-in-kova'
import { LinkEnvelope } from './link-envelope'
import type { EmbeddedWallet } from './privy-wallet'
import { ArcRoute, type Leg } from './wallet/arc'
import { InAppNote } from './wallet/in-app'
import { short, useWallet } from './wallet/provider'
import { CopyButton } from './wallet/ui'
import type { PaidGuest } from './wallet-pay'

// Privy is only downloaded when someone chooses email or Google.
const PrivyWallet = dynamic(() => import('./privy-wallet'), { ssr: false })

/**
 * Opening a link with dollars in it. The page reads the link's key from after the # (it never
 * leaves this browser), checks it opens the link's address, and greets whoever opened it with the
 * envelope: who sent it, how much, and about how much that is in their own money. Then it goes
 * wherever they choose: their Kova wallet (Face ID, made in a moment if they have none), a wallet
 * made from their email or Google (Privy), or any address. The key signs one transfer of
 * everything in the link to it, and Kova submits it and pays the gas.
 */

type Way = 'kova' | 'email' | 'address'

type Stage =
  | { at: 'choose' }
  /** No Kova wallet on this browser yet: make one with a passkey, or open the one you have. */
  | { at: 'faceid'; waiting: 'create' | 'open' | null }
  | { at: 'email' }
  | { at: 'claiming'; way: Way | 'back'; to: Address; leg: Leg }
  | { at: 'done'; way: Way | 'back'; to: Address; claimed: Claimed }

/** Where the key waits while Google sends someone away and back: Privy doesn't promise the #. */
const stash = (id: string) => `kova.claim.${id}`

const EURO_ZONES = new Set([
  'Amsterdam',
  'Athens',
  'Berlin',
  'Bratislava',
  'Brussels',
  'Dublin',
  'Helsinki',
  'Lisbon',
  'Ljubljana',
  'Luxembourg',
  'Madrid',
  'Malta',
  'Monaco',
  'Nicosia',
  'Paris',
  'Riga',
  'Rome',
  'Tallinn',
  'Vienna',
  'Vilnius',
  'Zagreb',
])

/** The money a visitor thinks in: where their clock is set, then their browser's language. */
function visitorCurrency(): DisplayCurrency {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''
    const [area, city = ''] = zone.split('/')
    if (zone === 'Europe/London' || zone === 'Europe/Belfast') return 'GBP'
    if (area === 'Europe' && EURO_ZONES.has(city)) return 'EUR'
    if (zone === 'Africa/Lagos') return 'NGN'
    if (zone === 'Africa/Nairobi') return 'KES'
    if (['Mexico_City', 'Cancun', 'Merida', 'Monterrey', 'Tijuana', 'Chihuahua'].includes(city))
      return 'MXN'
  } catch {
    // No time zone: the language decides.
  }
  return guessCurrency()
}

const CURRENCY = 'kova.web.claimCurrency.v1'

function explain(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (/reject|denied|cancel|not allowed|abort/i.test(message))
    return 'You cancelled. Nothing moved.'
  return message && message.length < 180
    ? message
    : 'Something went wrong. Nothing moved; try again.'
}

export function ClaimLink({
  link: initial,
  liveRates,
  privyAppId,
}: {
  link: DollarLink
  liveRates: LiveRates | null
  privyAppId: string | null
}) {
  const { status, profile, create, open, refresh } = useWallet()
  const [link, setLink] = useState(initial)
  /** The link's key: undefined while reading the #, null when it's missing or wrong. */
  const [key, setKey] = useState<Hex | null | undefined>(undefined)
  /** The sender, back on their own link: this browser kept its key when they made it. */
  const [mine, setMine] = useState(false)
  const [origin, setOrigin] = useState('https://mykova.app')
  const [stage, setStage] = useState<Stage>({ at: 'choose' })
  const [problem, setProblem] = useState<string | null>(null)
  const [pasting, setPasting] = useState(false)
  const [pasted, setPasted] = useState('')
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState<DisplayCurrency>('USD')
  const [canPasskey, setCanPasskey] = useState(true)
  const [guest, setGuest] = useState<PaidGuest | null>(null)
  const [devGuest, setDevGuest] = useState(false)
  const rates = useMemo(() => ratesFrom(liveRates), [liveRates])
  const side = useRef<HTMLElement>(null)

  // On a phone the claim happens below the envelope: bring Kovi's flight, and the moment, into view.
  useEffect(() => {
    if (stage.at !== 'claiming' && stage.at !== 'done') return
    const el = side.current
    if (!el || el.getBoundingClientRect().top < window.innerHeight * 0.5) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
  }, [stage.at])

  const amount = linkBase(link)
  const sender = link.sender_name?.trim() || short(link.sender_address)
  const senderFirst = link.sender_name?.trim().split(' ')[0] || 'They'
  const network = linkNetwork(link)

  // The key, from the # (or from this tab, back from Google), checked against the link's address.
  useEffect(() => {
    setOrigin(window.location.origin)
    setCanPasskey(passkeyHome())
    setDevGuest(
      window.location.hostname === 'localhost' &&
        new URLSearchParams(window.location.search).get('guest') === 'dev',
    )
    let found = linkKeyFrom(window.location.hash)
    if (!found && returningFromPrivy()) {
      try {
        found = linkKeyFrom(sessionStorage.getItem(stash(link.id)))
      } catch {}
      // Back in the address bar, so a reload still has it.
      if (found) window.history.replaceState(null, '', `${window.location.pathname}#${found}`)
    }
    const kept = keptKey(link.id, network)
    if (!found && kept) found = kept
    setMine(Boolean(kept))
    setKey(found && keyOpens(found, link.link_address) ? found : null)
    if (returningFromPrivy()) setStage({ at: 'email' })
    let picked: DisplayCurrency | null = null
    try {
      const saved = localStorage.getItem(CURRENCY)
      if (isDisplayCurrency(saved)) picked = saved
    } catch {}
    setCurrency(picked ?? visitorCurrency())
  }, [link.id, link.link_address])

  // A Kova wallet on this browser thinks in its own currency, unless they picked one here.
  useEffect(() => {
    if (!profile) return
    try {
      if (localStorage.getItem(CURRENCY)) return
    } catch {}
    setCurrency(profile.currency)
  }, [profile])

  const pickCurrency = (next: DisplayCurrency) => {
    setCurrency(next)
    try {
      localStorage.setItem(CURRENCY, next)
    } catch {}
  }

  /** The key signs everything in the link over to `to`; Kova submits it. Kovi flies it there. */
  const claim = useCallback(
    async (way: Way | 'back', to: Address) => {
      if (!key) return
      setProblem(null)
      setStage({ at: 'claiming', way, to, leg: 'flying' })
      const started = Date.now()
      try {
        const claimed = await claimLink(link, key, to)
        await new Promise((r) => setTimeout(r, Math.max(0, 1360 - (Date.now() - started))))
        setStage({ at: 'claiming', way, to, leg: 'landed' })
        await new Promise((r) => setTimeout(r, 620))
        setLink(claimed)
        setStage({ at: 'done', way, to, claimed })
        try {
          sessionStorage.removeItem(stash(link.id))
        } catch {}
        navigator.vibrate?.(30)
        if (way === 'kova' || way === 'back') void refresh()
      } catch (error) {
        setProblem(explain(error))
        setStage({ at: 'choose' })
        // Someone else may have claimed it meanwhile: show the link as it is now.
        void fetch(`/api/links/${encodeURIComponent(link.id)}`, { cache: 'no-store' })
          .then((r) => (r.ok ? (r.json() as Promise<DollarLink>) : null))
          .then((fresh) => fresh && setLink(fresh))
          .catch(() => {})
      }
    },
    [key, link, refresh],
  )

  const toKova = async () => {
    if (status === 'ready' && profile) return claim('kova', profile.address)
    setProblem(null)
    setStage({ at: 'faceid', waiting: null })
  }

  const makeWallet = async () => {
    const clean = name.trim()
    if (!clean) return setProblem('Write the name people know you by.')
    setProblem(null)
    setStage({ at: 'faceid', waiting: 'create' })
    try {
      await create(clean, currency)
    } catch (error) {
      setProblem(explain(error))
      setStage({ at: 'faceid', waiting: null })
    }
  }

  const openWallet = async () => {
    setProblem(null)
    setStage({ at: 'faceid', waiting: 'open' })
    try {
      await open()
    } catch (error) {
      setProblem(explain(error))
      setStage({ at: 'faceid', waiting: null })
    }
  }

  // The passkey made or opened the wallet: the dollars go straight into it.
  useEffect(() => {
    if (stage.at === 'faceid' && stage.waiting && status === 'ready' && profile)
      void claim('kova', profile.address)
  }, [stage, status, profile, claim])

  const toEmail = () => {
    setProblem(null)
    try {
      if (key) sessionStorage.setItem(stash(link.id), key)
    } catch {}
    setStage({ at: 'email' })
  }

  const onEmailWallet = useCallback(
    (wallet: EmbeddedWallet) => {
      setGuest({
        provider: wallet.provider,
        address: wallet.address,
        who: wallet.signedInAs,
        logout: wallet.logout,
      })
      void claim('email', getAddress(wallet.address))
    },
    [claim],
  )
  const onEmailCancel = useCallback(() => setStage({ at: 'choose' }), [])

  const pickDevGuest = async () => {
    const { devGuestWallet } = await import('./dev-guest')
    onEmailWallet(devGuestWallet(link.chain_id))
  }

  const toAddress = () => {
    const value = pasted.trim()
    if (!isAddress(value)) return setProblem('That isn’t a wallet address. It starts with 0x.')
    if (isAddressEqual(getAddress(value), getAddress(link.link_address)))
      return setProblem('That’s the link’s own address. Paste the wallet it should go to.')
    void claim('address', getAddress(value))
  }

  const local = currency === 'USD' ? null : formatLocal(baseToNumber(amount), currency, rates)
  const closed = link.status !== 'open' && stage.at !== 'done' && stage.at !== 'claiming'
  const youClaimed =
    link.claimed_by && profile
      ? isAddressEqual(getAddress(link.claimed_by), profile.address)
      : false
  const when = link.claimed_at ? `, ${ago(link.claimed_at)}` : ''
  const claimedLine = youClaimed
    ? `${formatUsd(amount)} went to your Kova wallet${when}.`
    : `Claimed by ${link.claimed_by ? short(getAddress(link.claimed_by)) : 'someone'}${when}. ` +
      `If that wasn’t you, ask ${senderFirst} about it.`

  const envelope = (
    <LinkEnvelope
      from={sender}
      fromId={link.sender_address}
      amount={formatUsd(amount)}
      note={link.note}
      stamp={
        stage.at === 'done' || link.status === 'open'
          ? null
          : link.status === 'returned'
            ? 'Taken back'
            : 'Claimed'
      }
    >
      <div className="lk-local">
        <span className="lk-local-amount">{local ? `about ${local}` : 'US dollars'}</span>
        <label className="lk-cur">
          <span className="sr-only">Show the amount in</span>
          <span className="lk-cur-code" aria-hidden="true">
            {currency}
          </span>
          <select
            value={currency}
            onChange={(e) => pickCurrency(e.target.value as DisplayCurrency)}
          >
            {displayCurrencies.map((code) => (
              <option key={code} value={code}>
                {code} · {currencyInfo[code].name}
              </option>
            ))}
          </select>
          <Icon name="chevronDown" size={14} />
        </label>
      </div>
      {local ? (
        <p className="lk-rate">Approximate, at the {rateLabel(liveRates)}. You get US dollars.</p>
      ) : null}
    </LinkEnvelope>
  )

  return (
    <div className="lk-grid">
      <section className="lk-hero" aria-label="The link">
        <Art name="scene-coin-rain" size={640} className="lk-rain" />
        {envelope}
      </section>

      <section ref={side} className="lk-side" aria-live="polite">
        {key === undefined ? (
          <div className="lk-panel lk-panel-quiet" aria-busy="true">
            <span className="spinner" aria-hidden="true" />
          </div>
        ) : stage.at === 'done' ? (
          <Done
            stage={stage}
            amount={amount}
            local={local}
            senderFirst={senderFirst}
            guest={guest}
            link={link}
          />
        ) : stage.at === 'claiming' ? (
          <div className="lk-panel lk-flying">
            <h2 className="lk-h">
              {stage.way === 'back' ? 'Taking it back' : `Claiming ${formatUsd(amount)}`}
            </h2>
            <ArcRoute
              you={{ name: sender, id: link.sender_address, label: senderFirst }}
              them={{
                name: stage.way === 'kova' && profile?.name ? profile.name : 'You',
                id: stage.to,
              }}
              leg={stage.leg}
            />
            <p className="w-fine w-center">Kova covers the fee. This takes about a second.</p>
          </div>
        ) : closed ? (
          <div className="lk-panel lk-closed">
            {link.status === 'returned' ? (
              <>
                <Art name="kovi-wave" size={88} className="lk-closed-art" />
                <h2 className="lk-h">{senderFirst} took this back</h2>
                <p className="w-lead">
                  Nobody claimed it, so the dollars went back to {sender}. Ask them to send a new
                  link if it was meant for you.
                </p>
              </>
            ) : (
              <>
                <Art
                  name={youClaimed ? 'kovi-catch' : 'kovi-sleep'}
                  size={88}
                  className="lk-closed-art"
                />
                <h2 className="lk-h">{youClaimed ? 'You claimed this' : 'Already claimed'}</h2>
                <p className="w-lead">{claimedLine}</p>
                {link.claim_explorer_url ? (
                  <a
                    href={link.claim_explorer_url}
                    className="lk-explorer"
                    target="_blank"
                    rel="noreferrer"
                  >
                    See proof <Icon name="external" size={14} />
                  </a>
                ) : null}
              </>
            )}
            <Link
              href="/wallet"
              className="pill pill-block"
              data-tone={youClaimed ? 'ink' : 'light'}
            >
              <span className="pill-label">
                {youClaimed || status === 'ready' ? 'Open my wallet' : 'Get a Kova wallet'}
              </span>
              <span className="pill-cap">
                <Icon name="arrow" size={18} />
              </span>
            </Link>
          </div>
        ) : key === null ? (
          <div className="lk-panel lk-closed" role="alert">
            <Art name="kovi-oops" size={88} className="lk-closed-art" />
            <h2 className="lk-h">This link is incomplete</h2>
            <p className="w-lead">
              The part that claims the dollars is missing, so they can’t be claimed from here. Ask{' '}
              {senderFirst} to send the whole link again, and open it as it is.
            </p>
          </div>
        ) : (
          <div className="lk-panel">
            {problem ? (
              <p className="w-sheet-problem lk-problem" role="alert">
                <Icon name="info" size={16} />
                {problem}
              </p>
            ) : null}
            {mine ? (
              <Mine
                url={linkUrl(origin, link.id, key)}
                onTakeBack={() => void claim('back', getAddress(link.sender_address))}
              />
            ) : null}

            {stage.at === 'faceid' ? (
              <form
                className="lk-faceid"
                onSubmit={(e) => {
                  e.preventDefault()
                  void makeWallet()
                }}
              >
                <div className="lk-faceid-top">
                  <button
                    type="button"
                    className="round"
                    aria-label="Back"
                    disabled={stage.waiting !== null}
                    onClick={() => setStage({ at: 'choose' })}
                  >
                    <Icon name="back" size={18} />
                  </button>
                  <h2 className="lk-h">Your Kova wallet</h2>
                </div>
                <p className="w-lead">
                  It opens with Face ID or your fingerprint. Nothing to install, nothing to
                  remember.
                </p>
                <InAppNote href={`${origin}/c/${link.id}#${key}`} />
                <label className="lk-name">
                  <span>What should people call you?</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    maxLength={40}
                    autoComplete="given-name"
                    disabled={stage.waiting !== null}
                  />
                </label>
                <button
                  type="submit"
                  className="pill pill-block"
                  data-tone="coral"
                  disabled={stage.waiting !== null || !canPasskey}
                >
                  <span className="pill-label">
                    {stage.waiting === 'create'
                      ? 'Waiting for your passkey…'
                      : `Make it and claim ${formatUsd(amount)}`}
                  </span>
                  <span className="pill-cap">
                    {stage.waiting === 'create' ? (
                      <span className="spinner" aria-hidden="true" />
                    ) : (
                      <Icon name="face" size={18} />
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  className="pill pill-block"
                  data-tone="light"
                  disabled={stage.waiting !== null || !canPasskey}
                  onClick={() => void openWallet()}
                >
                  <span className="pill-label">
                    {stage.waiting === 'open' ? 'Waiting for your passkey…' : 'I already have Kova'}
                  </span>
                  <span className="pill-cap">
                    {stage.waiting === 'open' ? (
                      <span className="spinner w-spinner-light" aria-hidden="true" />
                    ) : (
                      <Icon name="key" size={16} />
                    )}
                  </span>
                </button>
                {canPasskey ? null : (
                  <p className="form-note">
                    Kova wallets open on{' '}
                    <a href={`https://${passkeyDomain}/c/${link.id}#${key}`}>{passkeyDomain}</a>,
                    where your passkey lives.
                  </p>
                )}
              </form>
            ) : (
              <>
                <h2 className="lk-h">{mine ? 'Or claim it yourself' : 'Claim it'}</h2>
                <p className="lk-sub">
                  It lands in about a second, and it’s free: Kova covers the fee.
                </p>
                <div className="lk-ways">
                  <button
                    type="button"
                    className="pill pill-block"
                    data-tone="coral"
                    onClick={() => void toKova()}
                  >
                    <span className="pill-label">
                      {status === 'ready' && profile
                        ? 'Claim to my Kova wallet'
                        : 'Claim with Face ID'}
                    </span>
                    <span className="pill-cap">
                      <Icon name={status === 'ready' ? 'arrow' : 'face'} size={18} />
                    </span>
                  </button>
                  {status === 'ready' && profile ? (
                    <p className="lk-who">
                      {profile.name ? `${profile.name}, ` : ''}
                      {short(profile.address)}
                    </p>
                  ) : null}
                  {privyAppId ? (
                    <button
                      type="button"
                      className="pill pill-block"
                      data-tone="light"
                      disabled={stage.at === 'email'}
                      onClick={toEmail}
                    >
                      <span className="pill-label">
                        {stage.at === 'email' ? 'Opening sign-in…' : 'Claim with email or Google'}
                      </span>
                      <span className="pill-cap">
                        {stage.at === 'email' ? (
                          <span className="spinner w-spinner-light" aria-hidden="true" />
                        ) : (
                          <Icon name="mail" size={18} />
                        )}
                      </span>
                    </button>
                  ) : null}
                  {devGuest ? (
                    <button
                      type="button"
                      className="shop-wallet shop-wallet-make"
                      onClick={() => void pickDevGuest()}
                    >
                      <span className="wallet-glyph wallet-glyph-coral">
                        <Icon name="code" size={16} />
                      </span>
                      <span>
                        Dev guest wallet
                        <small className="wallet-sub">localhost only: stands in for email</small>
                      </span>
                      <Icon name="arrow" size={18} />
                    </button>
                  ) : null}
                </div>
                {privyAppId ? (
                  <p className="lk-fine">
                    With email or Google, a wallet is made for you on the spot. No app, no password.
                  </p>
                ) : null}

                {pasting ? (
                  <form
                    className="lk-paste"
                    onSubmit={(e) => {
                      e.preventDefault()
                      toAddress()
                    }}
                  >
                    <label htmlFor="lk-address">Send it to a wallet on Monad</label>
                    <div className="lk-paste-row">
                      <input
                        id="lk-address"
                        value={pasted}
                        onChange={(e) => {
                          setPasted(e.target.value)
                          setProblem(null)
                        }}
                        placeholder="0x…"
                        spellCheck={false}
                        autoComplete="off"
                        // biome-ignore lint/a11y/noAutofocus: the one field, opened on purpose
                        autoFocus
                      />
                      <button type="submit" disabled={!pasted.trim()}>
                        Claim
                      </button>
                    </div>
                    <small>Only an address on Monad that can hold AUSD.</small>
                  </form>
                ) : (
                  <button type="button" className="lk-paste-open" onClick={() => setPasting(true)}>
                    Paste a wallet address instead
                  </button>
                )}
              </>
            )}

            {stage.at === 'email' && privyAppId ? (
              <PrivyWallet
                appId={privyAppId}
                chainId={link.chain_id}
                onWallet={onEmailWallet}
                onCancel={onEmailCancel}
                title={`Claim ${formatUsd(amount)} from ${senderFirst}`}
              />
            ) : null}
          </div>
        )}
        <p className="lk-foot">
          {network === 'testnet' ? 'Test dollars on Monad testnet. ' : ''}Kova never sees the part
          of this link that claims it.
        </p>
      </section>
    </div>
  )
}

function ago(iso: string) {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (!Number.isFinite(minutes) || minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' })
}

/** The sender, back on a link they made here: share it again, or take the dollars back. */
function Mine({ url, onTakeBack }: { url: string; onTakeBack: () => void }) {
  const [sure, setSure] = useState(false)
  return (
    <div className="lk-mine">
      <span className="lk-mine-icon">
        <Icon name="link" size={16} />
      </span>
      <div className="lk-mine-text">
        <strong>This is your link</strong>
        <span>Send it to the person it’s for. Changed your mind? Take the dollars back.</span>
        <div className="lk-mine-actions">
          <CopyButton text={url} label="Copy link" className="w-copy w-copy-ink" />
          {sure ? (
            <button type="button" className="lk-mine-back" onClick={onTakeBack}>
              Yes, take it back
            </button>
          ) : (
            <button type="button" className="lk-mine-back" onClick={() => setSure(true)}>
              Take it back
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/** It's yours: the moment the dollars land, and where to go from there. */
function Done({
  stage,
  amount,
  local,
  senderFirst,
  guest,
  link,
}: {
  stage: Extract<Stage, { at: 'done' }>
  amount: bigint
  local: string | null
  senderFirst: string
  guest: PaidGuest | null
  link: DollarLink
}) {
  const back = stage.way === 'back'
  const seconds = (stage.claimed.ms / 1000).toFixed(stage.claimed.ms < 10_000 ? 1 : 0)
  const token = getToken(linkNetwork(link), 'AUSD')
  const about = local ? `, about ${local}` : ''
  const who = guest ? `, signed in as ${guest.who}` : ''
  return (
    <div className="lk-panel lk-done">
      <div className="w-sheet-cheer lk-cheer">
        <Art name="kovi-cheer" size={104} />
        <Art name="sparkle-4" size={22} className="w-spark w-spark-1" />
        <Art name="sparkle-8" size={26} className="w-spark w-spark-2" />
        <Art name="sparkle-11" size={18} className="w-spark w-spark-3" />
      </div>
      <h2 className="lk-done-h">{back ? 'Back with you' : 'It’s yours'}</h2>
      <p className="lk-done-p">
        {back
          ? `${formatUsd(amount)} is back in your wallet. The link is closed now.`
          : stage.way === 'kova'
            ? `${formatUsd(amount)} from ${senderFirst} is in your Kova wallet${about}.`
            : stage.way === 'email'
              ? `${formatUsd(amount)} from ${senderFirst} is in your wallet${who}.`
              : `${formatUsd(amount)} went to ${short(stage.to)}.`}
      </p>
      <span className="w-sheet-time">
        <Icon name="bolt" size={14} />
        Arrived in {seconds} s
      </span>
      {stage.claimed.claim_explorer_url ? (
        <a
          href={stage.claimed.claim_explorer_url}
          className="lk-explorer"
          target="_blank"
          rel="noreferrer"
        >
          See proof <Icon name="external" size={14} />
        </a>
      ) : null}

      {stage.way === 'kova' || back ? (
        <div className="lk-done-ways">
          <Link href="/wallet" className="pill pill-block" data-tone="ink">
            <span className="pill-label">Open my wallet</span>
            <span className="pill-cap">
              <Icon name="arrow" size={18} />
            </span>
          </Link>
          {back ? null : (
            <Link href="/wallet/send" className="pill pill-block" data-tone="light">
              <span className="pill-label">Send it on</span>
              <span className="pill-cap">
                <Icon name="send" size={18} />
              </span>
            </Link>
          )}
        </div>
      ) : stage.way === 'email' && guest ? (
        <>
          <p className="lk-done-note">
            Pay at any Kova shop with it: choose email or Google when you pay, and sign in the same
            way.
          </p>
          <KeepInKova
            checkout={{
              token: token.address,
              token_domain: token.domain,
              chain_id: link.chain_id,
            }}
            guest={guest}
            label="In your email wallet"
          />
        </>
      ) : (
        <div className="lk-done-ways">
          <Link href="/wallet" className="pill pill-block" data-tone="light">
            <span className="pill-label">Get a Kova wallet</span>
            <span className="pill-cap">
              <Icon name="arrow" size={18} />
            </span>
          </Link>
        </div>
      )}
    </div>
  )
}
