'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { getAddress } from 'viem'
import { Art, Icon } from '@/components/brand'
import { balanceOf } from '@/lib/wallet/chain'
import {
  claimLink,
  type DollarLink,
  dropLinkKey,
  type KeptLink,
  keptLinks,
  linkBase,
  linksFrom,
  linkUrl,
  recordLink,
  settleLinkKey,
  shareMessage,
} from '@/lib/wallet/dollar-links'
import { formatUsd } from '@/lib/wallet/money'
import { ScreenHead } from './activity'
import { short, useWallet } from './provider'
import { Avatar, CopyButton, when } from './ui'

/**
 * Your links: the dollars you sent as links, and what became of each. Until someone claims one,
 * the key this browser kept takes it back: it signs the same claim anyone would, to your own
 * wallet, and Kova pays the gas. Links made in the app show here too; their keys live on the phone.
 */
export function Links() {
  const { profile, network, refresh } = useWallet()
  const [links, setLinks] = useState<DollarLink[] | null>(null)
  const [kept, setKept] = useState<Record<string, KeptLink>>({})
  const [origin, setOrigin] = useState('https://mykova.app')
  /** The last link taken back, and how long Monad took. */
  const [back, setBack] = useState<{ amount: bigint; ms: number } | null>(null)
  const address = profile?.address

  const load = useCallback(async () => {
    if (!address) return
    setKept(keptLinks(network))
    setLinks(await linksFrom(address).catch(() => []))
  }, [address, network])

  // Links whose dollars left but Kova never recorded (a dropped connection): finish them now.
  useEffect(() => {
    setOrigin(window.location.origin)
    if (!address) return
    void (async () => {
      for (const [slot, link] of Object.entries(keptLinks(network))) {
        if (!slot.startsWith('pending:')) continue
        const held = await balanceOf(network, link.address).catch(() => null)
        if (held === 0n && Date.now() - link.at > 10 * 60_000) dropLinkKey(link, network)
        if (!held) continue
        const recorded = await recordLink({
          link_address: link.address,
          sender_address: address,
          ...(profile?.name ? { sender_name: profile.name } : {}),
          ...(link.note ? { note: link.note } : {}),
        }).catch(() => null)
        if (recorded) settleLinkKey(link, recorded.id, network)
      }
      await load()
    })()
  }, [address, network, load, profile?.name])

  if (!profile) return null
  const open = links?.filter((l) => !['claimed', 'returned'].includes(l.status)) ?? []
  const closed = links?.filter((l) => ['claimed', 'returned'].includes(l.status)) ?? []

  return (
    <div className="w-screen">
      <ScreenHead title="Your links">
        <Link href="/wallet/send/link" className="textlink">
          New link
        </Link>
      </ScreenHead>
      <p className="w-lead lk-list-lead">
        Dollars you sent as links. Until someone claims one, you can take it back.
      </p>

      {back ? (
        <p className="lk-list-back" role="status">
          <Icon name="check" size={16} />
          {formatUsd(back.amount)} is back in your wallet, in {(back.ms / 1000).toFixed(1)} s
        </p>
      ) : null}

      {links === null ? (
        <div className="w-loading lk-list-loading" aria-busy="true" />
      ) : links.length === 0 ? (
        <div className="w-empty w-empty-art">
          <Art name="kovi-peek" size={120} />
          <strong>No links yet</strong>
          <span>
            Send dollars to anyone as a link, even someone without Kova. They claim it in a tap.
          </span>
          <Link href="/wallet/send/link" className="pill lk-list-new" data-tone="ink">
            <span className="pill-label">Send as a link</span>
            <span className="pill-cap">
              <Icon name="link" size={18} />
            </span>
          </Link>
        </div>
      ) : (
        <>
          {open.length ? (
            <>
              <h2 className="w-section">Waiting to be claimed</h2>
              <div className="lk-rows">
                {open.map((link) => (
                  <Row
                    key={link.id}
                    link={link}
                    kept={kept[link.id] ?? null}
                    origin={origin}
                    sender={profile.name}
                    onTakeBack={async (key) => {
                      const claimed = await claimLink(link, key, profile.address)
                      setLinks(
                        (current) =>
                          current?.map((l) => (l.id === claimed.id ? claimed : l)) ?? null,
                      )
                      setBack({ amount: linkBase(link), ms: claimed.ms })
                      navigator.vibrate?.(20)
                      void refresh()
                    }}
                  />
                ))}
              </div>
            </>
          ) : null}
          {closed.length ? (
            <>
              <h2 className="w-section">Done</h2>
              <div className="lk-rows">
                {closed.map((link) => (
                  <Row
                    key={link.id}
                    link={link}
                    kept={null}
                    origin={origin}
                    sender={profile.name}
                  />
                ))}
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  )
}

function Row({
  link,
  kept,
  origin,
  sender,
  onTakeBack,
}: {
  link: DollarLink
  kept: KeptLink | null
  origin: string
  sender: string
  onTakeBack?: (key: KeptLink['key']) => Promise<void>
}) {
  const [stage, setStage] = useState<'idle' | 'sure' | 'taking'>('idle')
  const [problem, setProblem] = useState<string | null>(null)
  const amount = linkBase(link)
  const url = link.phone_payment
    ? `${origin}/wallet/phone/${link.id}`
    : kept
      ? linkUrl(origin, link.id, kept.key)
      : null
  const whatsapp = url
    ? `https://wa.me/?text=${encodeURIComponent(shareMessage(sender, amount, url, link.note))}`
    : ''
  const at = when(Date.parse(link.claimed_at ?? link.created_at))
  const by = link.claimed_by ? short(getAddress(link.claimed_by)) : 'someone'
  const status =
    link.status === 'open'
      ? `Made ${at}`
      : link.status === 'returned'
        ? `You took it back, ${at}`
        : `Claimed by ${by}, ${at}`

  return (
    <div className={`lk-row lk-row-${link.status}`}>
      <div className="lk-row-top">
        {link.status === 'claimed' && link.claimed_by ? (
          <Avatar name={link.claimed_by} id={link.claimed_by} size={40} />
        ) : (
          <span className={`lk-row-disc${link.status === 'returned' ? ' lk-row-disc-back' : ''}`}>
            <Icon name={link.status === 'returned' ? 'down' : 'link'} size={18} />
          </span>
        )}
        <span className="lk-row-text">
          <strong>{link.note || 'No note'}</strong>
          <small>{status}</small>
        </span>
        <span className="lk-row-amount">
          {formatUsd(amount)}
          <small>
            {!['claimed', 'returned'].includes(link.status)
              ? 'Waiting'
              : link.status === 'claimed'
                ? 'Claimed'
                : 'Back'}
          </small>
        </span>
      </div>

      {link.phone_payment ? (
        <div className="lk-row-actions">
          <Link className="textlink" href={`/wallet/phone/${link.id}`}>
            Open phone payment
          </Link>
          {url ? <CopyButton text={url} label="Copy invitation" /> : null}
        </div>
      ) : link.status === 'open' && kept && url && onTakeBack ? (
        <div className="lk-row-actions">
          {stage === 'sure' ? (
            <>
              <span className="lk-row-ask">Take back {formatUsd(amount)}?</span>
              <button type="button" className="lk-row-back" onClick={() => void take()}>
                Yes, take it back
              </button>
              <button type="button" className="w-copy" onClick={() => setStage('idle')}>
                Keep it
              </button>
            </>
          ) : (
            <>
              <CopyButton text={url} label="Copy link" />
              <a className="w-copy" href={whatsapp} target="_blank" rel="noreferrer">
                <Icon name="whatsapp" size={15} /> WhatsApp
              </a>
              <button
                type="button"
                className="lk-row-back"
                disabled={stage === 'taking'}
                onClick={() => setStage('sure')}
              >
                {stage === 'taking' ? 'Taking it back…' : 'Take back'}
              </button>
            </>
          )}
        </div>
      ) : link.status === 'open' ? (
        <p className="lk-row-elsewhere">
          Made on another device. Take it back from the Kova app there.
        </p>
      ) : null}
      {problem ? <p className="form-error">{problem}</p> : null}
    </div>
  )

  async function take() {
    if (!kept || !onTakeBack) return
    setStage('taking')
    setProblem(null)
    try {
      await onTakeBack(kept.key)
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Kova couldn’t take it back. Try again.')
    }
    setStage('idle')
  }
}
