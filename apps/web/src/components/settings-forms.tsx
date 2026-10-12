'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { type FormState, updateAccount } from '@/app/actions'
import { Icon } from './brand'

export function NameForm({ name }: { name: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateAccount, {})
  const [value, setValue] = useState(name)
  return (
    <form action={action} className="setting-form">
      <label className="field-label" htmlFor="shop-name">
        Shop name
      </label>
      <p className="field-help">Customers see it on the pay page and in Kova Pay before they pay.</p>
      <div className="inline-form">
        <input id="shop-name" name="name" value={value} onChange={(e) => setValue(e.target.value)} minLength={2} maxLength={60} required />
        <button type="submit" className="mini mini-ink" disabled={pending || value.trim() === name}>
          {pending ? 'Saving' : 'Save'}
        </button>
      </div>
      <Result state={state} done="Saved. New charges show the new name." />
    </form>
  )
}

export function AddressForm({ address, explorer, privateTakings }: { address: string; explorer: string; privateTakings: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateAccount, {})
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(address)
  const [sure, setSure] = useState(false)
  const valid = /^0x[0-9a-fA-F]{40}$/.test(value.trim())
  return (
    <form action={action} className="setting-form">
      <span className="field-label">Where money lands</span>
      {privateTakings ? (
        <p className="field-help">
          Each sale goes to its own address; see <Link href="/dashboard/private">Private takings</Link>. Moving them home brings them to this
          address.
        </p>
      ) : (
        <p className="field-help">Every payment settles straight to this Monad address. Kova never holds your money.</p>
      )}
      {editing && !state.ok ? (
        <>
          <input name="address" value={value} onChange={(e) => setValue(e.target.value)} className="mono-input" spellCheck={false} aria-label="Settlement address" />
          <label className="checkline warn">
            <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />I control this address. Payments sent to a wrong address can’t be recovered.
          </label>
          <div className="row-actions">
            <button type="submit" className="mini mini-ink" disabled={pending || !valid || !sure || value.trim() === address}>
              {pending ? 'Saving' : 'Change address'}
            </button>
            <button type="button" className="mini" onClick={() => (setEditing(false), setValue(address), setSure(false))}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <div className="address">
          <code>{state.ok ? value : address}</code>
          <a className="mini" href={`${explorer}/address/${state.ok ? value : address}`} target="_blank" rel="noreferrer">
            <Icon name="external" size={14} /> Explorer
          </a>
          <button type="button" className="mini" onClick={() => setEditing(true)}>
            Change
          </button>
        </div>
      )}
      <Result state={state} done="Changed. New charges settle to the new address; this change is on record." />
    </form>
  )
}

function Result({ state, done }: { state: FormState; done: string }) {
  if (state.error) return <p className="form-error">{state.error}</p>
  if (state.ok)
    return (
      <p className="form-ok">
        <Icon name="check" size={14} /> {done}
      </p>
    )
  return null
}
