import type { Metadata } from 'next'
import { Art } from '@/components/brand'
import { PrivateTakingsPanel } from '@/components/private-takings'
import { PageHead } from '@/components/shell'
import { ApiError, kova, type Merchant, type PrivateTakings } from '@/lib/api'
import { getSession } from '@/lib/session'

export const metadata: Metadata = { title: 'Private takings' }

/**
 * Private takings: each sale paid to its own one-time address that only the shop's passkey can
 * open, so nobody on Monad can add the shop's sales up. Turned on, moved home and shared with an
 * accountant from here, with the owner's Kova passkey.
 */
export default async function PrivateTakingsPage() {
  const [merchant, session, takings] = await Promise.all([
    kova<Merchant>('/v1/account'),
    getSession(),
    kova<PrivateTakings>('/v1/private_takings').catch((error) => {
      if (error instanceof ApiError) return null
      throw error
    }),
  ])

  if (!takings)
    return (
      <>
        <PageHead title="Private takings" />
        <section className="card notice" role="alert">
          <Art name="kovi-oops" size={120} />
          <h2>Private takings didn’t load</h2>
          <p>Kova didn’t answer just now. Your sales are safe; try this page again in a moment.</p>
        </section>
      </>
    )

  return (
    <PrivateTakingsPanel
      shop={{
        id: merchant.id,
        name: merchant.name,
        owner: merchant.owner_address,
        settlement: merchant.settlement_address,
        network: merchant.network === 'mainnet' ? 'mainnet' : 'testnet',
        explorer: merchant.explorer_url,
      }}
      initial={takings}
      demo={session?.demo ?? false}
    />
  )
}
