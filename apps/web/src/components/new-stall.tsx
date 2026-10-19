'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { createStall, type FormState } from '@/app/actions'
import { Awning } from './awning'
import { Icon, Pill } from './brand'

/** Name your stall, watch its sign go up. */
export function NewStall() {
  const [state, action, pending] = useActionState<FormState, FormData>(createStall, {})
  const [name, setName] = useState('')
  const [tagline, setTagline] = useState('')
  return (
    <div className="new-stall">
      <Link href="/dashboard/stalls" className="backlink">
        <Icon name="back" size={16} /> Stalls
      </Link>
      <div className="new-stall-grid">
        <form action={action} className="stack-form new-stall-form">
          <h1>Open a stall</h1>
          <p className="field-help">
            You can change all of this later. Next you’ll add what it sells.
          </p>
          <label className="field-label" htmlFor="stall-name">
            Stall name
          </label>
          <input
            id="stall-name"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ada’s Bakery"
            minLength={2}
            maxLength={60}
            required
            // biome-ignore lint/a11y/noAutofocus: naming the shop is the page's only task
            autoFocus
          />
          <label className="field-label" htmlFor="stall-tagline">
            A line about it <span className="optional">optional</span>
          </label>
          <input
            id="stall-tagline"
            name="tagline"
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            placeholder="Fresh every morning, round the corner"
            maxLength={120}
          />
          {state.error ? <p className="form-error">{state.error}</p> : null}
          <Pill type="submit" icon="arrow" tone="coral" disabled={pending} wide>
            {pending ? 'Opening' : 'Open my stall'}
          </Pill>
        </form>
        <div className="stall-sign" aria-hidden="true">
          <Awning height={64} />
          <div className="stall-sign-board">
            <strong>{name.trim() || 'Your stall'}</strong>
            <span>{tagline.trim() || 'What makes it yours'}</span>
          </div>
          <div className="stall-sign-legs">
            <span />
            <span />
          </div>
        </div>
      </div>
    </div>
  )
}
