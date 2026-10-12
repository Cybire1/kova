import { Art } from './brand'
import { Avatar } from './wallet/ui'

/**
 * A link with dollars in it, drawn as what it is: an envelope, teal like money at rest, with Kovi
 * peeking over its edge and the note tucked in front. The claim page opens on it, and the sender
 * sees the same envelope before making the link, so they know what the other person will see.
 */
export function LinkEnvelope({
  from,
  fromId,
  amount,
  note,
  stamp,
  headline = true,
  children,
}: {
  /** Who sent it: a name, or a short address. */
  from: string
  fromId: string
  /** "$20.00". */
  amount: string
  note?: string | null
  /** Across a closed link: "Claimed", "Taken back". */
  stamp?: string | null
  /** The greeting as the page's heading; off where the envelope is a preview. */
  headline?: boolean
  /** Under the amount: what it is in the reader's money. */
  children?: React.ReactNode
}) {
  const first = from.startsWith('0x') ? from : (from.split(' ')[0] ?? from)
  const Head = headline ? 'h1' : 'p'
  return (
    <div className={`lk-env${stamp ? ' lk-env-closed' : ''}`}>
      <Art name="kovi-peek" size={132} className="lk-env-peek" priority alt="" />
      <div className="lk-env-card">
        <svg
          className="lk-env-flap"
          viewBox="0 0 100 40"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d="M0 0 L50 36 L100 0" fill="none" vectorEffect="non-scaling-stroke" />
        </svg>
        <Head className="lk-env-head">
          <span className="lk-env-from">
            <Avatar name={from} id={fromId} size={34} />
            {first} sent you
          </span>
          <strong className="lk-env-amount">{amount}</strong>
        </Head>
        {children}
        {stamp ? (
          <span className="lk-env-stamp" aria-hidden="true">
            {stamp}
          </span>
        ) : null}
      </div>
      {note ? (
        <p className="lk-env-note">
          <span className="sr-only">Their note: </span>
          {note}
        </p>
      ) : null}
    </div>
  )
}
