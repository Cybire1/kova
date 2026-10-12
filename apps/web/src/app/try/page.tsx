import type { Metadata } from 'next'
import { Brand } from '@/components/brand'
import { type Bakery, TryChecklist, TryMainnet } from '@/components/try-checklist'
import { ApiError, kovaPublic, type PublicStall } from '@/lib/api'
import { cleanRef, TESTNET_SITE, TRY_STALL } from '@/lib/growth'
import '@/styles/growth.css'

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

/**
 * One step of the way in from a source, for Kova's public numbers: the visit, or a new wallet.
 * Counts only; the API keeps no address, and limits each visitor (passed on with the proxy
 * secret) to a few an hour. True when there's nothing left to send: counted, or refused for good.
 */
async function countStep(ref: string, step: 'visit' | 'wallet'): Promise<boolean> {
  'use server'
  const source = cleanRef(ref)
  if (!source || (step !== 'visit' && step !== 'wallet')) return true
  try {
    await kovaPublic('/v1/public/visits', {
      method: 'POST',
      body: JSON.stringify({ ref: source, step }),
    })
    return true
  } catch (error) {
    return error instanceof ApiError && (error.status === 400 || error.status === 429)
  }
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
  const api = process.env.KOVA_API_URL ?? 'http://localhost:4000'
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
  const mainnet = process.env.KOVA_NETWORK === 'mainnet'

  return (
    <main className="gr-page gr-try">
      <header className="gr-top">
        <Brand />
      </header>
      {mainnet ? (
        <TryMainnet
          initialRef={ref}
          count={countStep}
          testnet={`${TESTNET_SITE}/try?ref=mainnet`}
        />
      ) : (
        <TryChecklist
          initialRef={ref}
          count={countStep}
          bakery={await bakery(bakerySlug(params.stall))}
        />
      )}
    </main>
  )
}
