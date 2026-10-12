import type { Metadata } from 'next'
import { toString as qrSvg } from 'qrcode'
import { Awning } from '@/components/awning'
import { Art, LogoMark, Wordmark } from '@/components/brand'
import { Notice } from '@/components/notice'
import { PrintButton } from '@/components/print-button'
import { kovaPublic, type PublicStall } from '@/lib/api'
import { publicUrl } from '@/lib/url'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Table poster' }

/**
 * An A4 poster for the stall's table: scan, order, pay. Prints edge to edge in colour. With
 * tables set up, ?tables=1 prints a card per table instead, four to a page: each one's code
 * opens the stall with its table number, so the order says where to bring it.
 *
 * On screen it is a preview of the printed page: everything is sized to the page's width, so on
 * a phone it is the same poster, smaller.
 */
export default async function PosterPage(props: { params: Promise<{ slug: string }>; searchParams: Promise<{ tables?: string }> }) {
  const [{ slug }, { tables }] = await Promise.all([props.params, props.searchParams])
  let stall: PublicStall
  try {
    stall = await kovaPublic<PublicStall>(`/v1/public/stalls/${encodeURIComponent(slug)}`)
  } catch {
    return (
      <Notice title="This stall isn’t here">
        <p>It may have closed for good.</p>
      </Notice>
    )
  }
  const url = `${await publicUrl()}/s/${stall.slug}`
  // High error correction, so the coin in the middle never stops the code scanning.
  const qr = await qrSvg(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'H', color: { dark: '#0b1a1d', light: '#ffffff' } })
  const count = stall.table_count ?? 0

  if (tables === '1' && count > 0) {
    const codes = await Promise.all(
      Array.from({ length: count }, (_, i) =>
        qrSvg(`${url}?table=${i + 1}`, { type: 'svg', margin: 0, errorCorrectionLevel: 'H', color: { dark: '#0b1a1d', light: '#ffffff' } }),
      ),
    )
    return (
      <div className="poster-page">
        <div className="poster-tools">
          <PrintButton>Print table cards</PrintButton>
          <span>
            {count} table {count === 1 ? 'card' : 'cards'}, four to an A4 page. Cut along the lines.
          </span>
          <a className="textlink" href={`/s/${stall.slug}/poster`}>
            The big poster
          </a>
        </div>
        <div className="table-sheets">
          {codes.map((code, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: one card per table number
            <article key={i} className="table-card">
              <Awning height={40} stripe={22} fit={397} />
              <div className="table-card-body">
                <p className="table-card-shop">{stall.name}</p>
                <p className="table-card-number">
                  <small>Table</small>
                  {i + 1}
                </p>
                <div className="table-card-qr">
                  {/* biome-ignore lint/security/noDangerouslySetInnerHtml: locally generated SVG */}
                  <div className="poster-code" dangerouslySetInnerHTML={{ __html: code }} />
                  <span className="poster-coin table-card-coin" aria-hidden="true">
                    <LogoMark size={24} />
                  </span>
                </div>
                <p className="table-card-ask">Scan to order and pay</p>
                <p className="table-card-small">We bring it to your table. Your phone tells you when it’s ready.</p>
                <div className="table-card-foot">
                  <Wordmark height={14} />
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="poster-page">
      <div className="poster-tools">
        <PrintButton />
        <span>A4, portrait. Tape it where people queue.</span>
        {count > 0 ? (
          <a className="textlink" href={`/s/${stall.slug}/poster?tables=1`}>
            Table cards ({count})
          </a>
        ) : null}
      </div>
      <article className="poster">
        <Awning height={110} stripe={44} fit={794} />
        <div className="poster-body">
          <h1>{stall.name}</h1>
          {stall.tagline ? <p className="poster-line">{stall.tagline}</p> : null}
          <p className="poster-ask">Scan to order and pay</p>
          <div className="poster-qr">
            {/* biome-ignore lint/security/noDangerouslySetInnerHtml: locally generated SVG */}
            <div className="poster-code" dangerouslySetInnerHTML={{ __html: qr }} />
            <span className="poster-coin" aria-hidden="true">
              <LogoMark size={46} />
            </span>
          </div>
          <p className="poster-small">No app needed. Pay in dollars with Kova Pay or any Monad wallet. No card fees.</p>
          <div className="poster-foot">
            <Art name="kovi-wave" size={104} />
            <div>
              <Wordmark height={26} />
              <p>{url.replace(/^https?:\/\//, '')}</p>
            </div>
          </div>
        </div>
      </article>
    </div>
  )
}
