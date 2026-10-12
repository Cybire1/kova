'use client'

import { useActionState, useEffect, useState, useTransition } from 'react'
import { createKey, createWebhook, deleteWebhook, type FormState, revokeKey, testWebhook } from '@/app/actions'
import type { ApiKey, KovaEvent, WebhookEndpoint } from '@/lib/api'
import { ago } from '@/lib/format'
import { Art, Icon } from './brand'
import { SecretReveal } from './secret'

// --- Quickstart ---------------------------------------------------------------------------

export function Quickstart({ apiUrl }: { apiUrl: string }) {
  const samples = {
    cURL: `curl ${apiUrl}/v1/payment_intents \\
  -H "Authorization: Bearer $KOVA_SECRET_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "amount": "12.50", "reference": "Order 1042" }'`,
    'Node.js': `const res = await fetch('${apiUrl}/v1/payment_intents', {
  method: 'POST',
  headers: {
    authorization: \`Bearer \${process.env.KOVA_SECRET_KEY}\`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ amount: '12.50', reference: 'Order 1042' }),
})
const charge = await res.json()
// Show charge.id as a QR of https://<your-kova-web>/pay/<id>`,
    'Verify a webhook': `import { createHmac, timingSafeEqual } from 'node:crypto'

// header: Kova-Signature: t=1790208020,v1=9e56…
export function verify(body: string, header: string, secret: string) {
  const { t, v1 } = Object.fromEntries(header.split(',').map((p) => p.split('=')))
  const expected = createHmac('sha256', secret).update(\`\${t}.\${body}\`).digest('hex')
  const fresh = Math.abs(Date.now() / 1000 - Number(t)) < 300
  return fresh && timingSafeEqual(Buffer.from(v1), Buffer.from(expected))
}`,
  }
  type Tab = keyof typeof samples
  const [tab, setTab] = useState<Tab>('cURL')
  const [copied, setCopied] = useState(false)
  return (
    <section className="codecard" aria-label="Quickstart">
      <div className="codecard-head">
        <div role="tablist" className="codetabs">
          {(Object.keys(samples) as Tab[]).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => (setTab(t), setCopied(false))}>
              {t}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="codecopy"
          aria-label={copied ? 'Copied' : `Copy the ${tab} example`}
          onClick={async () => {
            await navigator.clipboard.writeText(samples[tab])
            setCopied(true)
          }}
        >
          <Icon name={copied ? 'check' : 'copy'} size={14} />
          <span className="codecopy-label">{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre>
        <code>{samples[tab]}</code>
      </pre>
    </section>
  )
}

// --- Keys ---------------------------------------------------------------------------------

export function KeysCard({ keys }: { keys: ApiKey[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createKey, {})
  const [adding, setAdding] = useState(false)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, start] = useTransition()

  return (
    <section className="card" aria-label="Secret keys">
      <div className="card-head">
        <div>
          <h2>Secret keys</h2>
          <p>For your servers. Anyone with one can charge for your shop, so never put one in an app or web page.</p>
        </div>
      </div>
      <ul className="keylist">
        {keys.map((k) => (
          <li key={k.id}>
            <span className="key-icon">
              <Icon name="key" size={16} />
            </span>
            <span className="key-text">
              <strong>
                {k.name}
                {k.current ? <span className="tag">This session</span> : null}
              </strong>
              <code>{k.prefix}…</code>
              <span>{k.last_used_at ? `Used ${ago(k.last_used_at)}` : 'Never used'}</span>
            </span>
            {k.current ? null : revoking === k.id ? (
              <span className="inline-confirm">
                <span>{error ?? 'Anything using it stops working.'}</span>
                <button type="button" className="mini" onClick={() => setRevoking(null)} disabled={busy}>
                  Keep
                </button>
                <button
                  type="button"
                  className="mini mini-danger"
                  disabled={busy}
                  onClick={() =>
                    start(async () => {
                      const r = await revokeKey(k.id)
                      if (r.error) setError(r.error)
                      else setRevoking(null)
                    })
                  }
                >
                  Revoke
                </button>
              </span>
            ) : (
              <button type="button" className="mini" onClick={() => (setRevoking(k.id), setError(null))}>
                Revoke
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="card-body">
        {state.secret ? <SecretReveal label={`${state.name} key`} value={state.secret} /> : null}
        {adding && !state.secret ? (
          <form action={action} className="inline-form">
            <input name="name" placeholder="What it’s for, e.g. Online store" maxLength={40} aria-label="Key name" autoFocus />
            <button type="submit" className="mini mini-ink" disabled={pending}>
              {pending ? 'Creating' : 'Create key'}
            </button>
            <button type="button" className="mini" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <button type="button" className="mini mini-ink" onClick={() => setAdding(true)}>
            <Icon name="plus" size={14} /> New secret key
          </button>
        )}
        {state.error ? <p className="form-error">{state.error}</p> : null}
      </div>
    </section>
  )
}

// --- Webhooks -----------------------------------------------------------------------------

const EVENT_CHOICES = [
  { value: 'payment_intent.paid', label: 'A charge is paid' },
  { value: 'payment_intent.held', label: 'A payment is held' },
  { value: 'payment_intent.failed', label: 'A payment fails' },
]

export function WebhooksCard({ endpoints }: { endpoints: WebhookEndpoint[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createWebhook, {})
  const [adding, setAdding] = useState(false)
  const [note, setNote] = useState<Record<string, string>>({})
  const [busy, start] = useTransition()

  const run = (id: string, fn: () => Promise<FormState>, done: string) =>
    start(async () => {
      const r = await fn()
      setNote((n) => ({ ...n, [id]: r.error ?? done }))
    })

  return (
    <section className="card" aria-label="Webhooks">
      <div className="card-head">
        <div>
          <h2>Webhooks</h2>
          <p>Kova posts each event to your URL, signed, and retries for up to a day if your server is down.</p>
        </div>
      </div>
      {endpoints.length > 0 ? (
        <ul className="keylist">
          {endpoints.map((e) => (
            <li key={e.id}>
              <span className="key-icon">
                <Icon name="bolt" size={16} />
              </span>
              <span className="key-text">
                <strong className="url">{e.url}</strong>
                <span className="evchips">
                  {e.events.map((ev) => (
                    <span key={ev} className="tag">
                      {ev === '*' ? 'All events' : ev.replace('payment_intent.', '')}
                    </span>
                  ))}
                </span>
                {note[e.id] ? <span>{note[e.id]}</span> : null}
              </span>
              <span className="key-actions">
                <button type="button" className="mini" disabled={busy} onClick={() => run(e.id, () => testWebhook(e.id), 'Test sent. Watch it arrive below.')}>
                  Send test
                </button>
                <button type="button" className="mini" disabled={busy} onClick={() => run(e.id, () => deleteWebhook(e.id), 'Removed')} aria-label={`Remove ${e.url}`}>
                  <Icon name="close" size={14} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty dev-empty">
          <Art name="plane" size={84} />
          <p>No endpoints yet. Add one to hear about payments in your own systems the moment they settle.</p>
        </div>
      )}
      <div className="card-body">
        {state.secret ? <SecretReveal label="Signing secret" value={state.secret} note="Use it to check each delivery’s Kova-Signature header. It’s shown only now." /> : null}
        {adding && !state.secret ? (
          <form action={action} className="stack-form">
            <label className="field-label" htmlFor="wh-url">
              Endpoint URL
            </label>
            <input id="wh-url" name="url" type="url" required placeholder="https://example.com/kova/webhooks" />
            <fieldset>
              <legend className="field-label">Send me</legend>
              {EVENT_CHOICES.map((c) => (
                <label key={c.value} className="checkline">
                  <input type="checkbox" name="events" value={c.value} defaultChecked={c.value === 'payment_intent.paid'} />
                  {c.label}
                </label>
              ))}
            </fieldset>
            <div className="row-actions">
              <button type="submit" className="mini mini-ink" disabled={pending}>
                {pending ? 'Adding' : 'Add endpoint'}
              </button>
              <button type="button" className="mini" onClick={() => setAdding(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="mini mini-ink" onClick={() => setAdding(true)}>
            <Icon name="plus" size={14} /> Add an endpoint
          </button>
        )}
        {state.error ? <p className="form-error">{state.error}</p> : null}
      </div>
    </section>
  )
}

// --- Events -------------------------------------------------------------------------------

export function EventsCard({ initial }: { initial: KovaEvent[] }) {
  const [events, setEvents] = useState(initial)
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => {
    const id = setInterval(async () => {
      const r = await fetch('/api/events').catch(() => null)
      if (r?.ok) setEvents((await r.json()) as KovaEvent[])
    }, 4000)
    return () => clearInterval(id)
  }, [])

  return (
    <section className="card" aria-label="Recent events">
      <div className="card-head">
        <div>
          <h2>Recent events</h2>
          <p>What happened, and whether your endpoints heard about it.</p>
        </div>
      </div>
      {events.length === 0 ? (
        <p className="code-meta events-empty">
          Nothing yet. Events appear when a charge is paid, or when you send a test.
        </p>
      ) : (
        <ul className="events">
          {events.map((e) => {
            const d = e.deliveries
            const state = d.length === 0 ? 'none' : d.every((x) => x.status === 'delivered') ? 'delivered' : d.some((x) => x.status === 'failed') ? 'failed' : 'pending'
            return (
              <li key={e.id}>
                <button type="button" className="event" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>
                  <code>{e.type}</code>
                  <span className="event-state" data-state={state}>
                    {state === 'none' ? 'No endpoints' : state === 'delivered' ? 'Delivered' : state === 'failed' ? 'Failed' : `Retrying${d[0]?.attempts ? ` (${d[0].attempts})` : ''}`}
                  </span>
                  <span className="event-time">{ago(e.created_at)}</span>
                </button>
                {open === e.id ? (
                  <pre className="event-body">
                    <code>{JSON.stringify({ id: e.id, type: e.type, data: e.data }, null, 2)}</code>
                    {d.map((x) => `\n\n→ ${x.status}${x.response_status ? `, HTTP ${x.response_status}` : ''}${x.last_error ? `, ${x.last_error}` : ''}`).join('')}
                  </pre>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
