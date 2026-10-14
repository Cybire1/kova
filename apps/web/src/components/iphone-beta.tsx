'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'
import { Icon, Pill } from '@/components/brand'
import '@/styles/iphone.css'

/**
 * Kova for iPhone, while it's in TestFlight: people leave their email, and Kova's team sends each
 * one a TestFlight invite. The form posts to /api/ios-beta, which passes it to Kova's API.
 */

export type BetaSource = 'iphone-page' | 'home' | 'try'

/** One of the app's real screens, as a phone. */
export function PhoneShot({
  name,
  alt,
  priority,
  className,
}: {
  name: string
  alt: string
  priority?: boolean
  className?: string
}) {
  return (
    <span className={`ip-phone${className ? ` ${className}` : ''}`}>
      <Image
        src={`/iphone/${name}.webp`}
        alt={alt}
        width={780}
        height={1691}
        sizes="(max-width: 640px) 46vw, 300px"
        priority={priority}
      />
    </span>
  )
}

type State =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'joined' | 'already'; email: string; invited: boolean }
  | { kind: 'error'; message: string }

export function BetaForm({ source, id = 'join' }: { source: BetaSource; id?: string }) {
  const [state, setState] = useState<State>({ kind: 'idle' })

  async function submit(form: HTMLFormElement) {
    const data = new FormData(form)
    const email = String(data.get('email') ?? '').trim()
    const name = String(data.get('name') ?? '').trim()
    if (!email)
      return setState({
        kind: 'error',
        message: 'Enter your email, and we’ll send the invite there.',
      })
    setState({ kind: 'sending' })
    try {
      const response = await fetch('/api/ios-beta', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, ...(name ? { name } : {}), source }),
      })
      const body = (await response.json().catch(() => ({}))) as {
        status?: 'joined' | 'already'
        invited?: boolean
        error?: string
      }
      if (!response.ok || !body.status)
        throw new Error(body.error ?? 'That didn’t go through. Try again in a minute.')
      setState({ kind: body.status, email, invited: Boolean(body.invited) })
    } catch (error) {
      setState({
        kind: 'error',
        message:
          error instanceof Error ? error.message : 'That didn’t go through. Try again in a minute.',
      })
    }
  }

  if (state.kind === 'joined' || state.kind === 'already')
    return (
      <div className="ip-done" id={id} role="status">
        <span className="ip-done-tick" aria-hidden="true">
          <Icon name="check" size={20} />
        </span>
        <div>
          <p className="ip-done-title">
            {state.kind === 'joined' ? 'You’re on the list.' : 'You’re already on the list.'}
          </p>
          <p>
            {state.invited
              ? `Your TestFlight invite went to ${state.email}. Open it on your iPhone.`
              : `Your TestFlight invite comes to ${state.email}. Open it on your iPhone, install TestFlight, then Kova.`}
          </p>
        </div>
      </div>
    )

  return (
    <form
      className="ip-form"
      id={id}
      onSubmit={(event) => {
        event.preventDefault()
        void submit(event.currentTarget)
      }}
      noValidate
    >
      <div className="ip-fields">
        <label className="ip-field">
          <span>Your email</span>
          <input
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
            maxLength={200}
          />
        </label>
        <label className="ip-field">
          <span>
            Your name <small>(if you like)</small>
          </span>
          <input name="name" type="text" autoComplete="name" placeholder="Ada" maxLength={80} />
        </label>
      </div>
      <Pill type="submit" icon="arrow" tone="coral" disabled={state.kind === 'sending'}>
        {state.kind === 'sending' ? 'Joining…' : 'Join the iPhone beta'}
      </Pill>
      {state.kind === 'error' ? (
        <p className="form-error" role="alert">
          {state.message}
        </p>
      ) : null}
    </form>
  )
}

/** The way in from other pages: a dark card with two real screens and one button. */
export function IphoneCard({ href, compact }: { href: string; compact?: boolean }) {
  const inner = (
    <>
      <div className="ip-card-copy">
        <p className="ip-card-kicker">
          <Icon name="terminal" size={16} /> Kova for iPhone · Beta
        </p>
        <h2 className="ip-card-title">Get Kova for iPhone</h2>
        <p className="ip-card-body">
          Pay with no signal, send privately, and put a limit on every card. Join the beta and we’ll
          send your TestFlight invite.
        </p>
        <span className="ip-card-cta">
          Join the iPhone beta <Icon name="arrow" size={16} />
        </span>
      </div>
      <div className="ip-card-phones" aria-hidden="true">
        <PhoneShot name="offline" alt="" className="ip-card-back" />
        <PhoneShot name="home" alt="" className="ip-card-front" />
      </div>
    </>
  )
  const className = `ip-card${compact ? ' ip-card-compact' : ''}`
  return href.startsWith('/') ? (
    <Link href={href} className={className}>
      {inner}
    </Link>
  ) : (
    <a href={href} className={className}>
      {inner}
    </a>
  )
}
