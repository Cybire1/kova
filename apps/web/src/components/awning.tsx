/**
 * A market stall's awning: coral and paper stripes with a scalloped edge, outlined in ink like
 * everything else. It is the mark of a Kova Stall wherever one appears.
 *
 * Drawn in CSS pixels, not a viewBox, so the stripes keep their width and the scallops their
 * shape however wide the awning is: it simply repeats across its container. A printed page passes
 * `fit`, the width it is drawn for, and then the awning scales with the page instead, so a poster
 * previewed on a phone is the poster, smaller.
 */
const PAPER = 'var(--awning-paper, #f8f7f3)'
const LINE = 'var(--awning-line, #0b1a1d)'

export function Awning({
  height = 56,
  stripe = 24,
  className,
  tone = 'coral',
  fit,
}: {
  height?: number
  stripe?: number
  className?: string
  tone?: 'coral' | 'teal'
  fit?: number
}) {
  const fill = tone === 'coral' ? 'var(--awning-coral, #d46558)' : 'var(--awning-teal, #46878b)'
  const id = `awning-${tone}-${stripe}-${height}${fit ? `-${fit}` : ''}`
  const r = stripe / 2
  const edge = height - r
  const width = fit ?? '100%'
  return (
    <svg
      className={className}
      width="100%"
      height={fit ? undefined : height}
      viewBox={fit ? `0 0 ${fit} ${height}` : undefined}
      aria-hidden="true"
      style={{ display: 'block', ...(fit ? { height: 'auto' } : {}) }}
    >
      <defs>
        <pattern id={id} width={stripe * 2} height={height} patternUnits="userSpaceOnUse">
          <rect x="0" y="0" width={stripe} height={edge} style={{ fill }} />
          <rect x={stripe} y="0" width={stripe} height={edge} style={{ fill: PAPER }} />
          <path
            d={`M0 ${edge} A${r} ${r} 0 0 0 ${stripe} ${edge} Z`}
            style={{ fill, stroke: LINE }}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d={`M${stripe} ${edge} A${r} ${r} 0 0 0 ${stripe * 2} ${edge} Z`}
            style={{ fill: PAPER, stroke: LINE }}
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </pattern>
      </defs>
      <rect x="0" y="0" width={width} height={height} fill={`url(#${id})`} />
      <rect x="0" y="0" width={width} height="2" style={{ fill: LINE }} />
    </svg>
  )
}
