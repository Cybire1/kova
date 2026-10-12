'use client'

import { useEffect, useState } from 'react'
import { Icon } from '@/components/brand'

type Where = { app: string | null; os: 'ios' | 'android' | 'other' }

/** Apps that open links in a browser of their own, where passkeys often don't work. */
const APPS: [RegExp, string][] = [
  [/Twitter|TwitterAndroid/i, 'X'],
  [/Instagram/i, 'Instagram'],
  [/FBAN|FBAV|FB_IAB/i, 'Facebook'],
  [/LinkedInApp/i, 'LinkedIn'],
  [/Snapchat/i, 'Snapchat'],
  [/TikTok|musical_ly|BytedanceWebview/i, 'TikTok'],
  [/\bLine\//i, 'LINE'],
]

function detect(): Where | null {
  const ua = navigator.userAgent
  const app = APPS.find(([pattern]) => pattern.test(ua))?.[1] ?? null
  const noPasskeys = typeof window.PublicKeyCredential === 'undefined'
  if (!app && !noPasskeys) return null
  const os = /iPhone|iPad|iPod/i.test(ua) ? 'ios' : /Android/i.test(ua) ? 'android' : 'other'
  return { app, os }
}

/**
 * Opened from a link inside X or Instagram: Kova's passkey may not work in that app's browser, so
 * say so before the passkey sheet fails, and offer the way out. It never blocks: some of these
 * browsers do support passkeys.
 */
export function InAppNote({ href }: { href?: string } = {}) {
  const [where, setWhere] = useState<Where | null>(null)
  const [copied, setCopied] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => setWhere(detect()), [])
  if (!where || dismissed) return null

  const url = href ?? `${window.location.origin}/wallet`
  const browser = where.os === 'ios' ? 'Safari' : where.os === 'android' ? 'Chrome' : 'your browser'
  // An Android intent can't carry a link's #, so a link with one is copied instead.
  const open =
    where.os === 'ios'
      ? `x-safari-${url}`
      : where.os === 'android' && !url.includes('#')
        ? `intent://${url.replace(/^https?:\/\//, '')}#Intent;scheme=https;end`
        : null

  return (
    <div className="w-inapp" role="note">
      <strong>Open Kova in {browser}</strong>
      <span>
        Kova opens with a passkey, and {where.app ? `${where.app}’s built-in browser` : 'this browser'}{' '}
        often can’t use one.
      </span>
      <div className="w-inapp-actions">
        {open ? (
          <a className="pill" data-tone="ink" href={open}>
            <span className="pill-label">Open in {browser}</span>
            <span className="pill-cap">
              <Icon name="arrow" size={16} />
            </span>
          </a>
        ) : null}
        <button
          type="button"
          className="mini"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(url)
              .then(() => setCopied(true))
              .catch(() => {})
          }}
        >
          {copied ? 'Link copied' : 'Copy link'}
        </button>
        <button type="button" className="textlink" onClick={() => setDismissed(true)}>
          Continue here
        </button>
      </div>
    </div>
  )
}
