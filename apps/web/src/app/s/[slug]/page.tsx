import type { Metadata } from 'next'
import { Notice } from '@/components/notice'
import { Storefront } from '@/components/storefront'
import { kovaPublic, type PublicStall } from '@/lib/api'

export const dynamic = 'force-dynamic'

async function load(slug: string) {
  try {
    return await kovaPublic<PublicStall>(`/v1/public/stalls/${encodeURIComponent(slug)}`)
  } catch {
    return null
  }
}

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const stall = await load((await props.params).slug)
  return stall
    ? {
        title: { absolute: `${stall.name} · order and pay with Kova` },
        description: stall.tagline ?? `Order from ${stall.name} and pay in dollars with Kova.`,
      }
    : { title: 'Stall' }
}

export default async function StallPage(props: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ preview?: string; table?: string }>
}) {
  const [{ slug }, { preview, table }] = await Promise.all([props.params, props.searchParams])
  const [stall, published] = await Promise.all([
    load(slug),
    kovaPublic<{ rates: Record<string, { per_usd: number }> }>('/v1/rates').catch(() => null),
  ])
  if (!stall)
    return (
      <Notice title="This stall isn’t here">
        <p>The link may be mistyped, or the stall has closed for good.</p>
      </Notice>
    )
  const rates = published
    ? Object.fromEntries(Object.entries(published.rates).map(([code, r]) => [code, r.per_usd]))
    : undefined
  // A table's QR code opens the stall with ?table=3: the order says where to bring it.
  const at = typeof table === 'string' && /^[\w -]{1,12}$/.test(table.trim()) ? table.trim() : null
  return <Storefront stall={stall} preview={preview === '1'} rates={rates} table={at} />
}
