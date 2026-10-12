import type { Metadata } from 'next'
import { signOut } from '@/app/actions'
import { Art, Icon } from '@/components/brand'
import { AddressForm, NameForm } from '@/components/settings-forms'
import { PasskeyOwner } from '@/components/passkey-owner'
import { PageHead } from '@/components/shell'
import { kova, type Merchant } from '@/lib/api'
import { getSession } from '@/lib/session'

export const metadata: Metadata = { title: 'Settings' }

export default async function SettingsPage() {
  const [merchant, session] = await Promise.all([kova<Merchant>('/v1/account'), getSession()])
  return (
    <>
      <PageHead title="Settings" sub={`${merchant.name}, open since ${new Date(merchant.created_at).toLocaleDateString([], { month: 'long', year: 'numeric' })}`} />
      <div className="settings">
        {session?.demo ? null : <PasskeyOwner shop={merchant.name} owner={merchant.owner_address} settlement={merchant.settlement_address} />}

        <section className="card card-pad" aria-label="Shop">
          <div className="setting-art">
            <Art name="badge-shop" size={72} />
          </div>
          {session?.demo ? (
            <p className="field-help">This is a shared demo shop, so its name and address are fixed. Open your own shop to change them.</p>
          ) : (
            <>
              <NameForm name={merchant.name} />
              <AddressForm address={merchant.settlement_address} explorer={merchant.explorer_url} privateTakings={merchant.private_takings} />
            </>
          )}
        </section>

        <section className="card card-pad" aria-label="Network">
          <h2 className="setting-title">Network</h2>
          <dl className="facts facts-flat">
            <div>
              <dt>Chain</dt>
              <dd>Monad {merchant.network === 'testnet' ? 'testnet' : 'mainnet'}</dd>
            </div>
            <div>
              <dt>Mode</dt>
              <dd>{merchant.livemode ? 'Live: dollars on Monad mainnet' : 'Test: test dollars, nothing real moves'}</dd>
            </div>
            <div>
              <dt>Settles in</dt>
              <dd>AUSD, final in about a second</dd>
            </div>
            <div>
              <dt>Fees</dt>
              <dd>Kova pays the network fee on every payment</dd>
            </div>
            <div>
              <dt>Shop ID</dt>
              <dd>
                <code>{merchant.id}</code>
              </dd>
            </div>
          </dl>
        </section>

        <section className="card card-pad" aria-label="Session">
          <h2 className="setting-title">This browser</h2>
          <p className="field-help">This browser is signed in to {merchant.name}, with a key kept encrypted in a cookie only this site can read. Sign out when you’re on a shared computer; your wallet stays yours.</p>
          <form action={signOut}>
            <button type="submit" className="mini">
              <Icon name="out" size={14} /> Sign out
            </button>
          </form>
        </section>
      </div>
    </>
  )
}
