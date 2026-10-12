import type { Metadata } from 'next'
import { cache } from 'react'
import { Art, Brand } from '@/components/brand'
import { ClaimLink } from '@/components/claim-link'
import { WalletProvider } from '@/components/wallet/provider'
import { kovaPublic } from '@/lib/api'
import type { DollarLink } from '@/lib/wallet/dollar-links'
import type { LiveRates } from '@/lib/wallet/money'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

/** The link as Kova knows it: who sent it, how much, and whether it was claimed. Never its key. */
const load = cache(async (id: string) =>
  kovaPublic<DollarLink>(`/v1/public/links/${encodeURIComponent(id)}`).catch(() => null),
)

const dollars = (amount: string) =>
  `$${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** The preview a chat app shows for the link: the greeting, and the note if there is one. */
export async function generateMetadata(props: Props): Promise<Metadata> {
  const link = await load((await props.params).id)
  if (!link) return { title: 'A Kova link', robots: { index: false } }
  const who = link.sender_name?.trim().split(' ')[0] || 'Someone'
  const title = `${who} sent you ${dollars(link.amount)} on Kova`
  const description = link.note
    ? `“${link.note}” Open the link to claim it. It lands in about a second, free.`
    : 'Open the link to claim it. It lands in about a second, and Kova covers the fee.'
  return {
    title: { absolute: title },
    description,
    robots: { index: false },
    openGraph: { title, description },
    twitter: { title, description },
  }
}

/**
 * A link with dollars in it, opened by anyone. Public: the page shows what the link holds, and
 * only the key after the # (read in the browser, never sent here) can claim it. The wallet is
 * mounted so "Claim with Face ID" can open or make a Kova wallet in place.
 */
export default async function ClaimPage(props: Props) {
  const { id } = await props.params
  const [link, rates] = await Promise.all([
    load(id),
    kovaPublic<LiveRates>('/v1/rates').catch(() => null),
  ])

  if (!link)
    return (
      <main className="lk-page">
        <header className="lk-top">
          <Brand />
        </header>
        <div className="lk-panel lk-closed lk-missing" role="alert">
          <Art name="kovi-oops" size={96} className="lk-closed-art" priority />
          <h1 className="lk-h">This link doesn’t open</h1>
          <p className="w-lead">
            Kova has no link like this one. It may be cut short: open the whole link as it was sent,
            or ask for it again.
          </p>
        </div>
      </main>
    )

  return (
    <WalletProvider
      network={link.chain_id === 143 ? 'mainnet' : 'testnet'}
      shop={null}
      initialRates={rates}
    >
      <main className="lk-page">
        <header className="lk-top">
          <Brand />
        </header>
        <ClaimLink link={link} liveRates={rates} privyAppId={process.env.PRIVY_APP_ID ?? null} />
      </main>
    </WalletProvider>
  )
}
