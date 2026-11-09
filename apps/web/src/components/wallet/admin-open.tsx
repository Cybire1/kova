'use client'

import { useState } from 'react'
import { getAddress } from 'viem'
import { Icon } from '@/components/brand'
import { adminMessage } from '@/lib/admin-message'
import { ScreenHead } from './activity'
import { useWallet } from './provider'

/**
 * The way into Kova's dashboard (/admin): this wallet signs which wallet, this site and the time,
 * and the site opens the dashboard for 12 hours if the wallet is on Kova's team list.
 */
export function AdminOpen() {
  const { profile, signMessage } = useWallet()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const open = async () => {
    if (!profile) return
    setBusy(true)
    setProblem(null)
    try {
      const address = getAddress(profile.address)
      const signedAt = Math.floor(Date.now() / 1000)
      const signature = await signMessage(adminMessage(address, window.location.host, signedAt))
      const response = await fetch('/api/admin/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address, signed_at: signedAt, signature }),
      })
      const body = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) throw new Error(body.error ?? 'The dashboard didn’t open. Try again.')
      window.location.assign('/admin')
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'The dashboard didn’t open. Try again.')
      setBusy(false)
    }
  }

  return (
    <div className="w-screen">
      <ScreenHead title="Kova’s dashboard" />
      <div className="w-section" style={{ display: 'grid', gap: '0.75rem' }}>
        <h2 className="w-title">Everyone on Kova, and who’s stuck</h2>
        <p className="w-lead">
          For Kova’s team. Sign with this wallet to open the dashboard on this browser for 12 hours.
        </p>
        <button
          type="button"
          className="pill pill-block"
          data-tone="ink"
          disabled={busy || !profile}
          onClick={() => void open()}
        >
          <span className="pill-label">{busy ? 'Opening…' : 'Sign and open'}</span>
          <span className="pill-cap">
            <Icon name="arrow" size={18} />
          </span>
        </button>
        {problem ? (
          <p className="w-quiet" role="alert" style={{ color: 'var(--danger)' }}>
            {problem}
          </p>
        ) : null}
      </div>
    </div>
  )
}
