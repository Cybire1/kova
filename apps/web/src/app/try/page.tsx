import type { Metadata } from 'next'
import { Brand } from '@/components/brand'
import { type Bakery, TryChecklist, TryMainnet } from '@/components/try-checklist'
import type { PublicStall } from '@/lib/api'
import { cleanRef, TESTNET_SITE, TRY_STALL } from '@/lib/growth'
import { apiUrl, network } from '@/lib/network'
import '@/styles/growth.css'
import { countTryStep } from './actions'

// The network is this server's (KOVA_NETWORK), read when someone asks, not when the site was built.
export const dynamic = 'force-dynamic'

const TITLE = 'Try Kova in a minute'
const DESCRIPTION =
  'Make a wallet with Face ID, get $5 of test dollars, buy a croissant and send a friend $1 by link. On Monad, free, each payment settled in about a second.'

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION },
  twitter: { title: TITLE, description: DESCRIPTION },
}

const SLUG = /^[a-z0-9-]{1,64}$/

/** The demo bakery: KOVA_TRY_STALL, or Ada's on testnet. Locally (development only), ?stall= picks one. */
function bakerySlug(param: string | string[] | undefined) {
  if (process.env.NODE_ENV === 'development' && typeof param === 'string' && SLUG.test(param))
    return param
  const set = process.env.KOVA_TRY_STALL
  return set && SLUG.test(set) ? set : TRY_STALL
}

/** The bakery as its menu says today, kept five minutes: its name, the croissant and its card. */
async function bakery(slug: string): Promise<Bakery> {
  const plain: Bakery = { slug, name: 'Ada’s Bakery', croissant: null, every: null }
  const api = apiUrl
  try {
    const response = await fetch(`${api}/v1/public/stalls/${encodeURIComponent(slug)}`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(4000),
    })
    if (!response.ok) return plain
    const stall = (await response.json()) as PublicStall
    const croissant = stall.items?.find((item) => /croissant/i.test(item.name) && !item.sold_out)
    return {
      slug,
      name: stall.name || plain.name,
      croissant: croissant?.price ?? null,
      every: stall.loyalty_every ?? null,
    }
  } catch {
    return plain
  }
}

export default async function TryPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await props.searchParams
  const ref = cleanRef(typeof params.ref === 'string' ? params.ref : null)
  const mainnet = network === 'mainnet'
  const iphone = mainnet ? '/waitlist' : 'https://mykova.app/waitlist'

  return (
    <main className="gr-page gr-try">
      <header className="gr-top">
        <Brand />
      </header>
      {mainnet ? (
        <TryMainnet
          initialRef={ref}
          count={countTryStep}
          testnet={`${TESTNET_SITE}/try?ref=mainnet`}
          iphone={iphone}
        />
      ) : (
        <TryChecklist
          initialRef={ref}
          count={countTryStep}
          bakery={await bakery(bakerySlug(params.stall))}
          iphone={iphone}
        />
      )}
    </main>
  )
}
