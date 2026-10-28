import type { Metadata } from 'next'
import Link from 'next/link'
import { getAddress, isAddress } from 'viem'
import { Brand, Icon } from '@/components/brand'
import { Avatar } from '@/components/wallet/ui'
import { parseScanned } from '@/lib/wallet/links'

type Props = {
  params: Promise<{ address: string }>
  searchParams: Promise<Record<string, string | undefined>>
}

/** Who's asking, from the link itself: a Kova request carries its own name, amount and note. */
async function read(props: Props) {
  const { address } = await props.params
  const query = new URLSearchParams(
    Object.entries(await props.searchParams).filter(
      (e): e is [string, string] => typeof e[1] === 'string',
    ),
  )
  const person = parseScanned(`https://mykova.app/to/${address}${query.size ? `?${query}` : ''}`)
  return person?.kind === 'person' && isAddress(person.address)
    ? { ...person, address: getAddress(person.address), query }
    : null
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const person = await read(props)
  const who = person?.name ?? 'Someone'
  return { title: person?.amount ? `${who} asked you for $${person.amount}` : `Pay ${who}` }
}

/**
 * A request anyone can pay: the link a Kova wallet shares from Request or Get paid. It opens the
 * Kova app when it's installed; in a browser it pays from your Kova wallet on the web, which a
 * newcomer makes in a moment with a passkey.
 */
export default async function PayPersonPage(props: Props) {
  const person = await read(props)
  if (!person)
    return (
      <main className="to-page">
        <Brand />
        <div className="to-card">
          <h1 className="w-title">This link isn’t a Kova request</h1>
          <p className="w-lead">Ask them to share their Kova link again.</p>
        </div>
      </main>
    )
  const name = person.name ?? `${person.address.slice(0, 6)}…${person.address.slice(-4)}`
  const firstName = person.name?.split(' ')[0] ?? name
  const send = `/wallet/send/${person.address}${person.query.size ? `?${person.query}` : ''}`
  return (
    <main className="to-page">
      <Brand />
      <div className="to-card">
        <Avatar name={name} id={person.address} size={72} />
        <h1 className="to-name">{name}</h1>
        <p className="to-ask">
          {person.amount ? 'asked you for' : 'Pay them in dollars, from anywhere'}
        </p>
        {person.amount ? (
          <p className="w-code-amount">
            ${Number(person.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </p>
        ) : null}
        {person.note ? <p className="w-lead">for {person.note}</p> : null}
        <div className="to-ways">
          <Link href={send} className="pill pill-block" data-tone="coral">
            <span className="pill-label">
              {person.amount ? `Pay $${person.amount}` : `Pay ${firstName}`}
            </span>
            <span className="pill-cap">
              <Icon name="arrow" size={18} />
            </span>
          </Link>
          <a
            href={`kova://to/${person.address}${person.query.size ? `?${person.query}` : ''}`}
            className="pill pill-block"
            data-tone="light"
          >
            <span className="pill-label">Open in the Kova app</span>
            <span className="pill-cap">
              <Icon name="tap" size={18} />
            </span>
          </a>
        </div>
        <p className="w-fine">
          Pays from your Kova wallet, in dollars. {firstName} gets it in about a second, and Kova
          covers the fee. New to Kova? Your wallet takes a passkey and a moment.
        </p>
      </div>
    </main>
  )
}
