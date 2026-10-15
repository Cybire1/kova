'use client'

import { useState } from 'react'
import { Icon } from './brand'

/** A secret shown exactly once, with a copy button and a plain warning. */
export function SecretReveal({
  label,
  value,
  note,
}: {
  label: string
  value: string
  note?: string
}) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="secret" role="status">
      <div className="secret-head">
        <Icon name="key" size={16} />
        <strong>{label}</strong>
      </div>
      <div className="secret-value">
        <code>{value}</code>
        <button
          type="button"
          className="mini"
          onClick={async () => {
            await navigator.clipboard.writeText(value)
            setCopied(true)
          }}
        >
          <Icon name={copied ? 'check' : 'copy'} size={14} /> {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p>
        {note ??
          'Copy it now and keep it somewhere safe. Kova only stores a hash, so it can’t show it again.'}
      </p>
    </div>
  )
}
