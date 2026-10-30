'use client'

import { getNetwork, MAX_SPLIT_SHARES, SPLIT_WHOLE, splitAmount, splitProblem } from '@kova/monad'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { type Address, getAddress, isAddressEqual } from 'viem'
import { Art, Icon } from '@/components/brand'
import type { SplitShareOut } from '@/lib/api'
import { formatUsd } from '@/lib/wallet/money'
import {
  getSplits,
  type ShopSplits,
  SignedOut,
  SwitchedOff,
  saveSplits,
} from '@/lib/wallet/programs'
import '@/styles/programs.css'
import { ScreenHead } from './activity'
import { Steps } from './flow'
import { short, useWallet } from './provider'
import { useNames } from './repeat'
import { Who } from './send'
import { Avatar } from './ui'

/**
 * Splits: a shop's sales shared out as they land. Some to a savings wallet, some to a partner,
 * the rest to the shop: up to five shares, each a percentage of every sale. The wallet the shop is
 * paid into signs the rules; Kova relays them to the shop's own splitter on Monad, and from the
 * next sale on, each one is shared out in the same moment it's paid.
 */

type Loaded =
  | { state: 'loading' }
  | { state: 'signed-out' }
  | { state: 'error'; problem: string }
  | { state: 'ready'; splits: ShopSplits }

type Editing = {
  /** The share being changed, or null for a new one. */
  index: number | null
  stage: 'who' | 'share'
  to: Address | null
  name: string
  /** The percentage as typed: "10", "2.5". */
  pct: string
}

const ORDER = ['list', 'who', 'share'] as const
const SAMPLES = [10_000_000n, 50_000_000n, 100_000_000n]
const PICKS = [5, 10, 15, 20, 25]

const cancelled = (message: string) => /cancel|not allowed|abort/i.test(message)
const problemOf = (e: unknown) =>
  e instanceof Error ? e.message : 'That didn’t go through. Try again.'

/** 1000 → "10%", 250 → "2.5%". */
export const percent = (bps: number) => `${Number((bps / 100).toFixed(2))}%`
const toBps = (typed: string) => Math.round(Number(typed || '0') * 100)
const sameShares = (a: SplitShareOut[], b: SplitShareOut[]) =>
  a.length === b.length &&
  a.every(
    (s, i) =>
      b[i] &&
      isAddressEqual(s.to, b[i].to) &&
      s.bps === b[i].bps &&
      (s.name ?? '') === (b[i].name ?? ''),
  )

export function SplitsScreen() {
  const { profile, signTypedData, network } = useWallet()
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [draft, setDraft] = useState<SplitShareOut[] | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [editProblem, setEditProblem] = useState<string | null>(null)
  const [sample, setSample] = useState(SAMPLES[0] as bigint)
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [savedNote, setSavedNote] = useState<{ tx: string | null; off: boolean } | null>(null)
  const [sureOff, setSureOff] = useState(false)

  const load = useCallback(async () => {
    try {
      setLoaded({ state: 'ready', splits: await getSplits() })
    } catch (e) {
      if (e instanceof SignedOut) return setLoaded({ state: 'signed-out' })
      setLoaded({ state: 'error', problem: problemOf(e) })
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const splits = loaded.state === 'ready' ? loaded.splits : null
  const live = splits?.live ? splits : null
  const saved = live?.shares ?? []
  const shares = draft ?? saved
  const changed = draft !== null && !sameShares(draft, saved)
  const name = useNames([...saved, ...(draft ?? [])].map((s) => s.to))
  const label = (s: SplitShareOut) => s.name?.trim() || name(s.to)
  const owner = live?.owner ?? null
  const mine = Boolean(owner && profile && isAddressEqual(owner, profile.address as Address))
  const total = shares.reduce((a, s) => a + s.bps, 0)
  const rule = owner ? splitProblem(shares, owner) : null
  const { parts, kept } = useMemo(() => splitAmount(sample, shares), [sample, shares])
  const sentence = `Of a ${formatUsd(sample)} sale: ${[
    ...shares.map((s, i) => `${formatUsd(parts[i] ?? 0n)} to ${label(s)}`),
    `${formatUsd(kept)} to you`,
  ].join(' · ')}`

  if (!profile) return null

  const head = <ScreenHead title="Splits" back="/dashboard/more" />

  if (loaded.state === 'loading')
    return (
      <div className="w-screen">
        {head}
        <div className="rp-skel" role="status" aria-busy="true" aria-label="Loading">
          <span className="w-skel rp-skel-hero" />
          <span className="w-skel rp-skel-row" />
          <span className="w-skel rp-skel-row" />
        </div>
      </div>
    )

  if (loaded.state === 'signed-out')
    return (
      <div className="w-screen">
        {head}
        <div className="w-empty w-empty-art">
          <Art name="badge-shop" size={88} />
          <strong>Sign in to your shop first</strong>
          <span>
            Splits share out a shop’s sales. Sign in to yours with your passkey, then open Splits
            from More.
          </span>
          <Link href="/wallet/shop?go=signin" className="pill sp-cta" data-tone="ink">
            <span className="pill-label">Sign in to my shop</span>
            <span className="pill-cap">
              <Icon name="face" size={18} />
            </span>
          </Link>
        </div>
      </div>
    )

  if (loaded.state === 'error')
    return (
      <div className="w-screen">
        {head}
        <div className="w-empty w-empty-art">
          <Art name="kovi-oops" size={112} />
          <strong>Splits didn’t load</strong>
          <span>{loaded.problem}</span>
          <button type="button" className="mini mini-ink rp-retry" onClick={() => void load()}>
            <Icon name="refresh" size={14} /> Try again
          </button>
        </div>
      </div>
    )

  if (!live)
    return (
      <div className="w-screen">
        {head}
        <div className="w-empty w-empty-art">
          <Art name="kovi-sleep" size={112} />
          <strong>Splits are switching on soon.</strong>
          <span>
            Share every sale out as it lands: 10% to your savings, 5% to a partner, the rest to you.
            It opens here as soon as Kova switches it on.
          </span>
        </div>
      </div>
    )

  const ready = live

  // ── Adding or changing one share ──────────────────────────────────────────────────────────

  const startEdit = (index: number | null) => {
    const s = index === null ? null : shares[index]
    setEditProblem(null)
    setSavedNote(null)
    setEditing(
      s
        ? { index, stage: 'share', to: s.to, name: s.name ?? '', pct: String(s.bps / 100) }
        : { index: null, stage: 'who', to: null, name: '', pct: '' },
    )
  }

  const pickWho = (p: { address: string; name?: string }) => {
    if (!editing) return
    const to = getAddress(p.address)
    if (isAddressEqual(to, ready.owner))
      return setEditProblem(
        'That’s the wallet this shop is paid into. The rest of every sale already goes there.',
      )
    if (shares.some((s, i) => i !== editing.index && isAddressEqual(s.to, to)))
      return setEditProblem('They already have a share. Change theirs instead.')
    setEditProblem(null)
    const called = p.name && !p.name.startsWith('0x') ? p.name : name(to)
    setEditing({
      ...editing,
      stage: 'share',
      to,
      name: editing.name || (called.startsWith('0x') ? '' : called),
    })
  }

  if (editing) {
    const others = shares.filter((_, i) => i !== editing.index)
    const room = SPLIT_WHOLE - others.reduce((a, s) => a + s.bps, 0)
    const bps = toBps(editing.pct)
    const over = bps > room
    const valid = editing.to !== null && bps > 0 && !over
    const theirs = (sample * BigInt(Math.max(0, Math.min(bps, SPLIT_WHOLE)))) / BigInt(SPLIT_WHOLE)
    const close = () => {
      setEditing(null)
      setEditProblem(null)
    }
    const commit = () => {
      if (!valid || !editing.to) return
      const share: SplitShareOut = {
        to: editing.to,
        bps,
        ...(editing.name.trim() ? { name: editing.name.trim().slice(0, 40) } : {}),
      }
      const next = [...shares]
      if (editing.index === null) next.push(share)
      else next[editing.index] = share
      setDraft(next)
      close()
    }
    const remove = () => {
      if (editing.index === null) return close()
      setDraft(shares.filter((_, i) => i !== editing.index))
      close()
    }

    if (editing.stage === 'who')
      return (
        <Steps step="who" order={ORDER}>
          <div className="w-screen">
            <ScreenHead title="New share" onBack={close} />
            {editProblem ? <p className="form-error">{editProblem}</p> : null}
            <Who
              people={{
                title: 'Who gets a share?',
                verb: 'Share with',
                empty:
                  'Type their .nad name, or paste a Kova link or wallet address. Your own savings wallet, a partner, a supplier: anyone with a wallet.',
              }}
              onPick={pickWho}
            />
          </div>
        </Steps>
      )

    const to = editing.to as Address
    const shown = editing.name.trim() || name(to)
    return (
      <Steps step="share" order={ORDER}>
        <div className="w-screen">
          <ScreenHead
            title={editing.index === null ? 'New share' : 'Change share'}
            onBack={editing.index === null ? () => setEditing({ ...editing, stage: 'who' }) : close}
          />
          <div className="rp-to">
            <Avatar name={shown} id={to} size={36} />
            <span>
              <strong>{shown}</strong>
              <small>{short(to)}</small>
            </span>
            {editing.index === null ? null : (
              <button
                type="button"
                className="textlink sp-change"
                onClick={() => setEditing({ ...editing, stage: 'who' })}
              >
                Change
              </button>
            )}
          </div>

          <label className="sp-field">
            <span>What you call it</span>
            <input
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder="Savings, Ada, Rent…"
              maxLength={40}
              autoComplete="off"
            />
          </label>

          <div className="sp-pct">
            <span className="cx-amount-label">Their share of every sale</span>
            <label className="sp-pct-big">
              <span className="sr-only">Percentage</span>
              <input
                inputMode="decimal"
                value={editing.pct}
                placeholder="0"
                size={Math.max(1, editing.pct.length)}
                onChange={(e) => {
                  const v = e.target.value.replace(',', '.').replace(/[^0-9.]/g, '')
                  if (/^\d{0,3}(\.\d{0,2})?$/.test(v)) setEditing({ ...editing, pct: v })
                }}
              />
              <span aria-hidden="true">%</span>
            </label>
            <fieldset className="rp-quick sp-picks">
              <legend className="sr-only">Quick picks</legend>
              {PICKS.filter((p) => p * 100 <= room).map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={bps === p * 100}
                  className={bps === p * 100 ? 'rp-quick-on' : undefined}
                  onClick={() => setEditing({ ...editing, pct: String(p) })}
                >
                  <strong>{p}%</strong>
                </button>
              ))}
            </fieldset>
            <p className={`sp-pct-line${over ? ' sp-pct-over' : ''}`} aria-live="polite">
              {over
                ? room > 0
                  ? `That’s more than is left. Up to ${percent(room)} can go to them.`
                  : 'Every sale is already shared out. Make another share smaller first.'
                : bps > 0
                  ? `${formatUsd(theirs)} of every ${formatUsd(sample)} sale. You keep ${percent(room - bps)} of what’s left over.`
                  : `Up to ${percent(room)} is free to share.`}
            </p>
          </div>

          <button
            type="button"
            className="pill pill-block rp-go"
            data-tone="ink"
            disabled={!valid}
            onClick={commit}
          >
            <span className="pill-label">
              {editing.index === null ? 'Add this share' : 'Update this share'}
            </span>
            <span className="pill-cap">
              <Icon name="check" size={18} />
            </span>
          </button>
          {editing.index === null ? null : (
            <button type="button" className="cx-line-button sp-remove" onClick={remove}>
              <Icon name="trash" size={16} /> Remove this share
            </button>
          )}
          <p className="w-fine rp-center">Nothing changes until you save, with your passkey.</p>
        </div>
      </Steps>
    )
  }

  // ── The shares ────────────────────────────────────────────────────────────────────────────

  const save = async (next: SplitShareOut[]) => {
    setSaving(true)
    setProblem(null)
    setSavedNote(null)
    try {
      const done = await saveSplits(next, signTypedData)
      setLoaded({
        state: 'ready',
        splits: { ...done, shop_name: ready.shop_name, demo: ready.demo },
      })
      setDraft(null)
      setSureOff(false)
      setSavedNote({ tx: done.live ? (done.tx_hash ?? null) : null, off: next.length === 0 })
    } catch (e) {
      if (e instanceof SwitchedOff)
        return setLoaded({
          state: 'ready',
          splits: { object: 'splits', live: false, shop_name: ready.shop_name, demo: ready.demo },
        })
      const message = problemOf(e)
      if (!cancelled(message)) setProblem(message)
    } finally {
      setSaving(false)
    }
  }

  /** Why this wallet can only look: a demo shop, private takings, or another wallet's shop. */
  const blocked: {
    art: 'kovi-key' | 'badge-shop'
    title: string
    text: string
    href?: string
    cta?: string
  } | null = ready.demo
    ? {
        art: 'badge-shop',
        title: 'This is a shared demo shop',
        text: 'Its sales stay as they are. Open your own shop to share out your sales.',
        href: '/wallet/shop?go=open',
        cta: 'Open my shop',
      }
    : ready.private_takings
      ? {
          art: 'kovi-key',
          title: 'Turn off private takings to use splits.',
          text: 'Private takings pay each sale to its own one-time address, so there’s nothing for a splitter to share out as it lands.',
          href: '/dashboard/private',
          cta: 'Go to Private takings',
        }
      : !mine
        ? {
            art: 'badge-shop',
            title: 'Splits are set by the wallet this shop is paid into',
            text: `That’s ${short(ready.owner)}, and this wallet is ${short(profile.address)}. Open that wallet on this browser to change them.`,
          }
        : null
  const editable = !blocked
  const proof = savedNote?.tx ? `${getNetwork(network).explorerUrl}/tx/${savedNote.tx}` : null
  const fresh = saved.length === 0 && shares.length === 0

  return (
    <Steps step="list" order={ORDER}>
      <div className="w-screen">
        {head}
        <p className="w-lead sp-lead">
          Share every sale of {ready.shop_name} out as it lands: some to savings, some to a partner,
          the rest to you.
        </p>

        <p className="sp-state" data-on={ready.on ? 'true' : undefined}>
          <span className="sp-state-dot" aria-hidden="true" />
          {ready.on
            ? 'On. Every sale is shared out the moment it lands.'
            : 'Off. Every sale lands in full in your wallet.'}
        </p>

        <section className="sp-preview" aria-label={sentence}>
          <div className="sp-preview-head">
            <span>Of a sale of</span>
            <fieldset className="sp-samples">
              <legend className="sr-only">Sale amount</legend>
              {SAMPLES.map((v) => (
                <button
                  key={String(v)}
                  type="button"
                  aria-pressed={sample === v}
                  className={sample === v ? 'sp-sample-on' : undefined}
                  onClick={() => setSample(v)}
                >
                  {formatUsd(v).replace('.00', '')}
                </button>
              ))}
            </fieldset>
          </div>
          <div className="sp-bar" aria-hidden="true">
            {shares.map((s, i) =>
              s.bps > 0 ? (
                <span
                  key={s.to}
                  data-c={i}
                  style={{ flexGrow: Math.min(s.bps, SPLIT_WHOLE) }}
                  title={`${label(s)}, ${percent(s.bps)}`}
                />
              ) : null,
            )}
            {total < SPLIT_WHOLE ? (
              <span data-c="you" style={{ flexGrow: SPLIT_WHOLE - total }} />
            ) : null}
          </div>
          <p className="sp-sentence">{sentence}</p>
        </section>

        {fresh && editable ? (
          <div className="sp-intro">
            <Art name="scene-coin-rain" size={128} className="rp-intro-art" />
            <h2 className="w-title">Pay everyone the moment you’re paid</h2>
            <p className="w-lead">
              Put 10% of every sale into savings, give a partner their 5%, keep the rest. No
              transfers to remember: each share leaves with the sale.
            </p>
            <button
              type="button"
              className="pill pill-block"
              data-tone="coral"
              onClick={() => startEdit(null)}
            >
              <span className="pill-label">Add the first share</span>
              <span className="pill-cap">
                <Icon name="plus" size={18} />
              </span>
            </button>
          </div>
        ) : (
          <section aria-labelledby="sp-shares">
            <div className="w-section-row">
              <h2 className="w-section" id="sp-shares">
                Shares
              </h2>
              <span className="sp-count">
                {shares.length} of {MAX_SPLIT_SHARES}
              </span>
            </div>
            <ul className="sp-list">
              {shares.map((s, i) => (
                <li key={s.to} className="sp-share">
                  <span className="sp-share-dot" data-c={i} aria-hidden="true">
                    <Avatar name={label(s)} id={s.to} size={40} />
                  </span>
                  <span className="sp-share-text">
                    <strong>{label(s)}</strong>
                    <small>{short(s.to)}</small>
                  </span>
                  <span className="sp-share-pct">
                    <strong>{percent(s.bps)}</strong>
                    <small>{formatUsd(parts[i] ?? 0n)}</small>
                  </span>
                  {editable ? (
                    <span className="sp-share-actions">
                      <button
                        type="button"
                        className="round"
                        aria-label={`Change ${label(s)}’s share`}
                        disabled={saving}
                        onClick={() => startEdit(i)}
                      >
                        <Icon name="pen" size={16} />
                      </button>
                      <button
                        type="button"
                        className="round"
                        aria-label={`Remove ${label(s)}’s share`}
                        disabled={saving}
                        onClick={() => {
                          setSavedNote(null)
                          setDraft(shares.filter((_, j) => j !== i))
                        }}
                      >
                        <Icon name="trash" size={16} />
                      </button>
                    </span>
                  ) : null}
                </li>
              ))}
              <li className="sp-share sp-share-you">
                <span className="sp-share-dot" data-c="you" aria-hidden="true">
                  <Avatar name={profile.name || 'You'} id={ready.owner} size={40} />
                </span>
                <span className="sp-share-text">
                  <strong>You, the rest</strong>
                  <small>{short(ready.owner)}</small>
                </span>
                <span className="sp-share-pct">
                  <strong>{percent(Math.max(0, SPLIT_WHOLE - total))}</strong>
                  <small>{formatUsd(kept)}</small>
                </span>
              </li>
            </ul>
            {editable && shares.length < MAX_SPLIT_SHARES ? (
              <button
                type="button"
                className="sp-add"
                disabled={saving || total >= SPLIT_WHOLE}
                onClick={() => startEdit(null)}
              >
                <Icon name="plus" size={18} />
                {total >= SPLIT_WHOLE ? 'Nothing left to share' : 'Add a share'}
              </button>
            ) : editable ? (
              <p className="w-quiet">That’s the most: {MAX_SPLIT_SHARES} shares.</p>
            ) : null}
          </section>
        )}

        {blocked ? (
          <div className="sp-blocked" role="note">
            <Art name={blocked.art} size={64} />
            <div>
              <strong>{blocked.title}</strong>
              <p>{blocked.text}</p>
              {blocked.href && blocked.cta ? (
                <Link href={blocked.href} className="mini mini-ink">
                  {blocked.cta} <Icon name="arrow" size={14} />
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}

        {editable && changed && rule ? (
          <p className="rp-short" role="alert">
            <Icon name="info" size={15} />
            <span>{rule}</span>
          </p>
        ) : null}
        {problem ? <p className="form-error">{problem}</p> : null}

        {savedNote ? (
          <p className="m-listed sp-saved" role="status">
            <Icon name="check" size={16} />
            <span>
              {savedNote.off
                ? 'Splits are off. Every sale now lands in full in your wallet.'
                : 'Saved on Monad. From the next sale, each one is shared out as it lands.'}{' '}
              {proof ? (
                <a href={proof} target="_blank" rel="noreferrer" className="textlink">
                  See proof
                </a>
              ) : null}
            </span>
          </p>
        ) : null}

        {editable && changed ? (
          <div className="sp-save">
            <button
              type="button"
              className="pill pill-block"
              data-tone="coral"
              disabled={saving || Boolean(rule)}
              onClick={() => void save(shares)}
            >
              <span className="pill-label">
                {saving
                  ? 'Saving on Monad…'
                  : shares.length === 0
                    ? 'Turn splits off'
                    : `Save ${shares.length} ${shares.length === 1 ? 'share' : 'shares'}`}
              </span>
              <span className="pill-cap">
                {saving ? (
                  <span className="spinner" aria-hidden="true" />
                ) : (
                  <Icon name="face" size={18} />
                )}
              </span>
            </button>
            <button
              type="button"
              className="textlink sp-undo"
              disabled={saving}
              onClick={() => {
                setDraft(null)
                setProblem(null)
              }}
            >
              Undo changes
            </button>
          </div>
        ) : null}

        {editable && !changed && ready.on && saved.length ? (
          <section className="sp-off" aria-label="Turn splits off">
            {sureOff ? (
              <>
                <p>
                  <strong>Turn splits off?</strong> From the next sale, every sale lands in full in
                  your wallet. What’s already shared stays where it went.
                </p>
                <div className="rp-sure-actions">
                  <button
                    type="button"
                    className="mini mini-danger"
                    disabled={saving}
                    onClick={() => void save([])}
                  >
                    {saving ? 'Turning off…' : 'Turn splits off'}
                  </button>
                  <button
                    type="button"
                    className="mini"
                    disabled={saving}
                    onClick={() => setSureOff(false)}
                  >
                    Keep them on
                  </button>
                </div>
              </>
            ) : (
              <button type="button" className="textlink" onClick={() => setSureOff(true)}>
                Turn splits off
              </button>
            )}
          </section>
        ) : null}

        <p className="w-fine sp-fine">
          Each share is paid on Monad in the same moment as the sale, by this shop’s own splitter.
          Kova never holds it, and covers every fee. Your passkey signs each change.
        </p>
      </div>
    </Steps>
  )
}
