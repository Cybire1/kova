import type { Metadata } from 'next'
import { headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Brand, Icon, Pill } from '@/components/brand'
import { BetaForm, PhoneShot } from '@/components/iphone-beta'

const TITLE = 'Kova for iOS · Join the beta'
const DESCRIPTION =
  'A dollar account you open with Face ID. It pays with no signal, sends privately and puts a limit on every card. Join the iOS beta on TestFlight.'

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
}

/** One list: the test network's site sends people to mykova.app's. */
const HOME = 'https://mykova.app/waitlist'
const TESTNET_HOSTS = new Set(['web-monad.up.railway.app'])

const FEATURES = [
  {
    shot: 'offline',
    title: 'Pays with no signal',
    body: 'Face ID signs the payment on the phone. It travels as a code, and settles on Monad once either phone is back online.',
    alt: 'A payment code for $0.25, signed on the phone with no signal',
  },
  {
    shot: 'private',
    title: 'Private by choice',
    body: 'A private payment lands at a one-time address only you can open, with a sealed note. Monad shows who paid, not who got paid.',
    alt: 'Ada paid you privately: +$20.00, with the note “Train tickets”',
  },
  {
    shot: 'send',
    title: 'Sends anywhere',
    body: 'Send to anyone in one sheet, with the amount in their own currency. $20 arrives as about €18.40, in about a second.',
    alt: 'Send to Tomás: you send $20.00 and Tomás gets about €18.40',
  },
  {
    shot: 'card',
    title: 'A limit on every key',
    body: 'Your Kova Card has a daily limit kept on Monad, and freezes in one tap. Allowances and AI agents get keys of their own.',
    alt: 'The Kova Card: active, with a $50 daily limit',
  },
] as const

export default async function IphonePage() {
  const host = (await headers()).get('host') ?? ''
  if (TESTNET_HOSTS.has(host)) redirect(HOME)

  return (
    <div className="lp ip">
      <header className="lp-nav">
        <Brand />
        <div className="lp-nav-actions">
          <Link href="/try?ref=iphone" className="lp-signin">
            Try it on the web
          </Link>
          <Pill href="#join" icon="arrow">
            Join the beta
          </Pill>
        </div>
      </header>

      <section className="ip-hero">
        <div className="ip-copy">
          <p className="ip-kicker">
            <span className="ip-live" aria-hidden="true" /> Kova for iOS · Beta on TestFlight
          </p>
          <h1 className="ip-title">
            Your dollars,
            <br />
            <span>in your pocket</span>
            <span className="lp-coin" aria-hidden="true" />
          </h1>
          <p className="ip-lead">
            A dollar account you open with Face ID. It pays with no signal, sends privately, and
            puts a limit on every card, person or AI agent. Every payment settles on Monad in about
            a second, and Kova pays the gas.
          </p>
          <BetaForm source="iphone-page" />
          <p className="ip-keep">
            <Icon name="shield" size={16} /> We keep your email, and your name if you give it, only
            to send your TestFlight invite.
          </p>
        </div>

        <div className="ip-stage">
          <PhoneShot
            name="offline"
            alt="A payment code, signed with no signal"
            className="ip-stage-left"
          />
          <PhoneShot
            name="home"
            alt="Kova’s Home: $5.00 available and $20.00 in private dollars"
            className="ip-stage-center"
            priority
          />
          <PhoneShot
            name="private"
            alt="A private payment with a sealed note"
            className="ip-stage-right"
          />
        </div>
      </section>

      <section className="ip-features" aria-labelledby="ip-features-title">
        <h2 className="lp-h2" id="ip-features-title">
          What’s in the beta
        </h2>
        <div className="ip-grid">
          {FEATURES.map((f) => (
            <article className="ip-feature" key={f.shot}>
              <div className="ip-feature-shot">
                <PhoneShot name={f.shot} alt={f.alt} />
              </div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="ip-how" aria-labelledby="ip-how-title">
        <h2 className="lp-h2" id="ip-how-title">
          How the beta works
        </h2>
        <ol className="ip-steps">
          <li>
            <span className="ip-step-n">1</span>
            <h3>Join with your email</h3>
            <p>It takes ten seconds. No wallet or app needed yet.</p>
          </li>
          <li>
            <span className="ip-step-n">2</span>
            <h3>Get your TestFlight invite</h3>
            <p>
              Apple emails it to you from TestFlight, Apple’s own app for trying iOS apps early.
            </p>
          </li>
          <li>
            <span className="ip-step-n">3</span>
            <h3>Install, and open Kova</h3>
            <p>Make your account with Face ID. No seed phrase, and no gas token to buy.</p>
          </li>
        </ol>
        <p className="ip-web">
          Can’t wait? Kova works in your browser today.{' '}
          <Link href="/try?ref=iphone">Try it in a minute</Link>
        </p>
      </section>

      <section className="ip-close">
        <h2>Be one of the first with Kova on iOS</h2>
        <BetaForm source="iphone-page" id="join-again" />
      </section>

      <footer className="lp-foot">
        <Brand />
        <p>Kova for iOS is in beta on TestFlight. Built on Monad.</p>
        <nav aria-label="Footer">
          <Link href="/">Kova</Link>
          <Link href="/try?ref=iphone">Try Kova in a minute</Link>
          <Link href="/stats">Kova, live</Link>
        </nav>
      </footer>
    </div>
  )
}
