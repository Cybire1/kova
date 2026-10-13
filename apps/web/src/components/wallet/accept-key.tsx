'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { Address } from 'viem'
import { Art, Icon } from '@/components/brand'
import { accept, inviteInfo, type KeyInvite } from '@/lib/wallet/keys'
import { ScreenHead } from './activity'
import { short, useWallet } from './provider'

/**
 * Accepting an allowance or a budget: this wallet makes the key on this device (from its own
 * signature, so nothing is stored) and the key signs that it may spend from the giver's wallet.
 * It spends nothing until the giver switches it on with their passkey.
 */
export function AcceptKey({ code }: { code: string }) {
  const { profile, signMessage } = useWallet()
  const [invite, setInvite] = useState<KeyInvite | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [accepted, setAccepted] = useState(false)
  useEffect(() => {
    inviteInfo(code)
      .then(setInvite)
      .catch((e: unknown) => setProblem(e instanceof Error ? e.message : 'This invite isn’t open.'))
  }, [code])
  if (!profile) return null
  const from = invite ? (invite.owner_name ?? short(invite.owner)) : ''
  const what = invite ? `$${invite.limit.replace(/\.00$/, '')} a ${invite.period}` : ''
  const mine = invite?.holder && invite.holder.toLowerCase() === profile.address.toLowerCase()

  return (
    <div className="w-screen">
      <ScreenHead title={invite?.kind === 'team' ? 'A budget for you' : 'An allowance for you'} />
      {problem ? (
        <p className="w-keys-problem">{problem}</p>
      ) : !invite ? (
        <div className="w-loading" aria-busy="true" />
      ) : (
        <div className="w-accept">
          <Art name="kovi-key" size={150} className="w-accept-art" />
          <h2>
            {from} gives you {what}
          </h2>
          <p className="w-lead">
            {invite.kind === 'team'
              ? `Spend it for ${from}’s shop, up to ${what}, straight from their wallet.`
              : `Spend it wherever Kova works, up to ${what}. The dollars stay in ${from}’s wallet until you spend them.`}
          </p>
          <ul className="w-facts">
            <li className="w-fact">
              <Icon name="key" size={16} /> Your phone makes its own key. Nobody else can spend with it.
            </li>
            <li className="w-fact">
              <Icon name="lock" size={16} /> {from} can freeze it any time, in one tap.
            </li>
            <li className="w-fact">
              <Icon name="clock" size={16} /> Until {new Date(invite.ends_at).toLocaleDateString([], { day: 'numeric', month: 'short' })}
            </li>
          </ul>
          {accepted || mine || invite.status === 'accepted' || invite.status === 'active' ? (
            <div className="w-accept-done">
              <strong>
                <Icon name="check" size={18} /> {invite.status === 'active' ? 'It’s on' : 'Accepted'}
              </strong>
              <span>
                {invite.status === 'active'
                  ? 'It’s on your Home now.'
                  : `${from} switches it on with their passkey. Then it shows on your Home.`}
              </span>
              <Link href="/wallet" className="pill pill-block" data-tone="ink">
                <span className="pill-label">Go to Home</span>
                <span className="pill-cap">
                  <Icon name="home" size={18} />
                </span>
              </Link>
            </div>
          ) : invite.status !== 'invited' ? (
            <p className="w-keys-problem">This invite has run out. Ask {from} for a new one.</p>
          ) : (
            <button
              type="button"
              className="pill pill-block"
              data-tone="ink"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                setProblem(null)
                accept(code, profile.address as Address, profile.name, signMessage)
                  .then(() => setAccepted(true))
                  .catch((e: unknown) => setProblem(e instanceof Error ? e.message : 'That didn’t go through.'))
                  .finally(() => setBusy(false))
              }}
            >
              <span className="pill-label">{busy ? 'Making your key…' : 'Accept'}</span>
              <span className="pill-cap">
                <Icon name="check" size={18} />
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
