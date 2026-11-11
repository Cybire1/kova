'use client'

import { useState } from 'react'

/**
 * Kova for Chrome, while the Chrome Web Store reviews it: people leave their email, and Kova writes
 * to them the day it's in the store. Posts to /api/ios-beta with the source "chrome", so it's the
 * same list (the API's routes/ios-beta.ts), told apart by where each person asked from.
 */
type State =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'joined' | 'already'; email: string }
  | { kind: 'error'; message: string }

const FAILED = 'That didn’t go through. Try again in a minute.'

export function ChromeWaitlist() {
  const [state, setState] = useState<State>({ kind: 'idle' })

  async function submit(form: HTMLFormElement) {
    const email = String(new FormData(form).get('email') ?? '').trim()
    if (!email)
      return setState({ kind: 'error', message: 'Enter your email, and we’ll write to you there.' })
    setState({ kind: 'sending' })
    try {
      const response = await fetch('/api/ios-beta', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, source: 'chrome' }),
      })
      const body = (await response.json().catch(() => ({}))) as {
        status?: 'joined' | 'already'
        error?: string
      }
      if (!response.ok || !body.status) throw new Error(body.error ?? FAILED)
      setState({ kind: body.status, email })
    } catch (error) {
      setState({ kind: 'error', message: error instanceof Error ? error.message : FAILED })
    }
  }

  if (state.kind === 'joined' || state.kind === 'already')
    return (
      <div className="ch-wl-done" role="status">
        <span className="ch-wl-tick" aria-hidden="true">
          <svg aria-hidden="true" className="i">
            <use href="#i-check" />
          </svg>
        </span>
        <div>
          <b>{state.kind === 'joined' ? 'You’re on the list.' : 'You’re already on the list.'}</b>
          <span>We’ll write to {state.email} the day it’s in the Chrome Web Store.</span>
        </div>
      </div>
    )

  return (
    <form
      className="ch-wl-form"
      onSubmit={(event) => {
        event.preventDefault()
        void submit(event.currentTarget)
      }}
      noValidate
    >
      <label className="ch-wl-field">
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
      <button className="btn b-ink" type="submit" disabled={state.kind === 'sending'}>
        {state.kind === 'sending' ? 'Joining…' : 'Join the waitlist'}
        <span className="o">
          <svg aria-hidden="true" className="i">
            <use href="#i-arrow" />
          </svg>
        </span>
      </button>
      {state.kind === 'error' ? (
        <p className="ch-wl-error" role="alert">
          {state.message}
        </p>
      ) : null}
    </form>
  )
}
