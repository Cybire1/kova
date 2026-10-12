'use client'

import { useState } from 'react'
import type { Terminal } from '@/lib/api'
import { ago } from '@/lib/format'
import { Art, Icon, Pill } from './brand'
import { PairSheet } from './pair-sheet'
import { PageHead } from './shell'

/** Every phone paired to the shop, as cards. Add one with a code; remove one and its key dies. */
export function TerminalsManager({ initial }: { initial: Terminal[] }) {
  const [terminals, setTerminals] = useState(initial)
  const [pairing, setPairing] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const remove = async (id: string) => {
    setBusy(true)
    setError(null)
    const response = await fetch(`/api/terminals/${id}`, { method: 'DELETE' })
    setBusy(false)
    if (!response.ok) return setError(((await response.json()) as { error?: string }).error ?? 'Could not remove it')
    setTerminals((list) => list.filter((t) => t.id !== id))
    setRemoving(null)
  }

  return (
    <>
      {/* The first phone is paired from the empty card below; after that, from here. */}
      <PageHead title="Terminals" sub={`${terminals.length} ${terminals.length === 1 ? 'phone takes' : 'phones take'} payments for your shop`}>
        {terminals.length ? (
          <Pill icon="plus" onClick={() => setPairing(true)}>
            Add a terminal
          </Pill>
        ) : null}
      </PageHead>

      {terminals.length === 0 ? (
        <section className="card empty big-empty">
          <Art name="kovi-wave" size={150} />
          <h3>No terminals yet</h3>
          <p>Any phone with Kova becomes a till. Pair one with a one-time code; it gets its own key, only for taking payments.</p>
          <Pill icon="plus" tone="coral" onClick={() => setPairing(true)}>
            Pair your first phone
          </Pill>
        </section>
      ) : (
        <div className="tgrid">
          {terminals.map((t) => (
            <article key={t.id} className="tcard" data-removing={removing === t.id ? 'true' : undefined}>
              <div className="tcard-top">
                <span className="tcard-phone">
                  <Icon name="terminal" size={22} />
                </span>
                <span className="chip chip-onink" data-state="live">
                  <span className="dot" />
                  Active
                </span>
              </div>
              <h3>{t.name}</h3>
              <p>
                {t.last_seen_at && t.last_seen_at !== t.created_at ? `Used ${ago(t.last_seen_at)}` : 'Not used yet'}
                <br />
                Paired {new Date(t.created_at).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}
              </p>
              {removing === t.id ? (
                <div className="tcard-confirm">
                  <p>{error ?? 'It stops taking payments at once.'}</p>
                  <div>
                    <button type="button" className="mini" onClick={() => setRemoving(null)} disabled={busy}>
                      Keep
                    </button>
                    <button type="button" className="mini mini-danger" onClick={() => remove(t.id)} disabled={busy}>
                      {busy ? 'Removing' : 'Remove'}
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="tcard-remove" onClick={() => setRemoving(t.id)}>
                  Remove
                </button>
              )}
            </article>
          ))}
          <button type="button" className="tcard tcard-add" onClick={() => setPairing(true)}>
            <Art name="badge-add" size={64} />
            <span>Pair another phone</span>
          </button>
        </div>
      )}

      <section className="howto" aria-label="How pairing works">
        <div>
          <Icon name="key" size={20} />
          <h3>Its own key</h3>
          <p>A paired phone can take payments and nothing else. It can’t pair phones, change settings or see keys.</p>
        </div>
        <div>
          <Icon name="bolt" size={20} />
          <h3>Instant removal</h3>
          <p>Lost a phone? Remove it here and its key stops working on the spot. The phone goes back to pairing.</p>
        </div>
        <div>
          <Icon name="shield" size={20} />
          <h3>Money never stops there</h3>
          <p>Payments settle to your shop on Monad, never to the phone. The phone only shows the code.</p>
        </div>
      </section>

      {pairing ? <PairSheet known={terminals.map((t) => t.id)} onPaired={(list) => setTerminals(list)} onClose={() => setPairing(false)} /> : null}
    </>
  )
}
