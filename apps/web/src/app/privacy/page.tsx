import type { Metadata } from 'next'
import Link from 'next/link'
import { Brand, Icon, type IconName, Pill } from '@/components/brand'
import '@/styles/legal.css'

const TITLE = 'Privacy · Kova'
const DESCRIPTION =
  'What Kova keeps about you, why, who else sees it, and how to have it deleted. In plain words.'

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
}

const CONTACT = 'hello@mykova.app'
const UPDATED = '15 October 2026'

const SHORT: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'key',
    title: 'Only you approve your payments',
    body: 'Your passkey stays on your phone or in your password manager, and Face ID never leaves your phone. A payment needs your passkey, or a key you made with its own limit.',
  },
  {
    icon: 'globe',
    title: 'Payments are public on Monad',
    body: 'Anyone can see an address, an amount and a time. A private payment lands at an address made just for it, so nobody can tell who got paid.',
  },
  {
    icon: 'shield',
    title: 'No ads, no trackers',
    body: 'We don’t sell your data or show ads. Kova has no analytics and no tracking cookies.',
  },
  {
    icon: 'mail',
    title: 'Yours to see or delete',
    body: `Email ${CONTACT} and we’ll send you what we keep about you, or delete it.`,
  },
]

const KEEP: { what: string; body: string }[] = [
  {
    what: 'Your wallet',
    body: 'Its address, the name you choose and your passkey’s public key, so people can pay you by name and we can check it’s you. Your name, currency and contacts are also kept in a backup locked with your passkey; we can’t read it.',
  },
  {
    what: 'Your payments',
    body: 'The amount, the time, the addresses and the Monad transaction, to show your activity and receipts. A note on a payment is sealed so only the person you pay can read it. The note on a payment link travels with the link.',
  },
  {
    what: 'Your shop',
    body: 'Its name, items, photos, prices, orders and sales. An order can include a name, a table or a note your customer types.',
  },
  {
    what: 'Your Kova Card',
    body: 'The card’s address, its label, its last four digits and its limits. Your PIN is kept only as a one-way hash, never the PIN itself.',
  },
  {
    what: 'Keys you share',
    body: 'For an allowance, an AI agent or a teammate: the key’s name, who holds it, its limits and what it paid. The key itself is kept encrypted, so it can pay when its holder asks, and Monad stops it at its limit.',
  },
  {
    what: 'Kova for Business',
    body: 'The people and suppliers you pay: their names, wallet addresses and countries.',
  },
  {
    what: 'Naira in and out',
    body: 'To pay out to a bank: the bank, the account number and the account name. To pay in: an email address for the receipt.',
  },
  {
    what: 'Travel',
    body: 'A trip’s travellers and contact details, to book it. In the beta, fares are samples and nothing is booked with an airline or a hotel.',
  },
  {
    what: 'Kova on a basic phone',
    body: 'If you use Kova by USSD: your phone number. Your pocket’s key is kept encrypted, and its PIN only as a hash.',
  },
  {
    what: 'The iOS beta',
    body: 'Your email, and your name if you give it, only to send your TestFlight invite.',
  },
  {
    what: 'Keeping Kova safe',
    body: 'Your IP address on some requests, a log of changes to your account and shop, and which wallets claimed test dollars, to stop abuse and fix problems.',
  },
]

const OTHERS: { who: string; body: string }[] = [
  {
    who: 'Monad',
    body: 'Every payment settles on Monad, a public blockchain. Anyone can read it, and no one can delete it, including us.',
  },
  { who: 'Railway', body: 'Runs Kova’s servers and database.' },
  {
    who: 'DeepSeek',
    body: 'Reads a photo of a menu or an item when you choose to add your shop’s items from a photo. It gets only that photo.',
  },
  {
    who: 'Paystack',
    body: 'Moves naira in and out of Nigerian banks. It gets the bank details or the email for that payment.',
  },
  {
    who: 'Ramp Network',
    body: 'Adding or cashing out dollars with a card or a bank on the website. Ramp asks for what it needs, such as your ID and bank details, under its own privacy policy.',
  },
  {
    who: 'Privy',
    body: 'Signs you in with email on the website, if you choose that. It sees your email.',
  },
  {
    who: 'Open Food Facts and UPCitemdb',
    body: 'Look up a product when you scan its barcode. They get only the barcode number.',
  },
  {
    who: 'Apple',
    body: 'TestFlight, passkeys in iCloud Keychain and Face ID run on Apple’s systems, under Apple’s privacy policy.',
  },
]

const ASKS: { what: string; body: string }[] = [
  {
    what: 'Camera',
    body: 'To scan payment QR codes and product barcodes, and to photograph items for your shop. A photo leaves your phone only when you add it to your shop.',
  },
  {
    what: 'NFC',
    body: 'To read a Kova Card when you link it, and when your till takes a card payment.',
  },
  {
    what: 'Face ID',
    body: 'To approve payments with your passkey. Your phone checks your face; Kova never sees it.',
  },
]

export default function PrivacyPage() {
  return (
    <div className="lp pv">
      <header className="lp-nav">
        <Brand />
        <div className="lp-nav-actions">
          <Link href="/try?ref=privacy" className="lp-signin">
            Try Kova
          </Link>
          <Pill href="/wallet" icon="arrow">
            Open Kova
          </Pill>
        </div>
      </header>

      <main className="pv-main">
        <header className="pv-head">
          <p className="pv-kicker">
            <Icon name="shield" size={16} /> Privacy policy
          </p>
          <h1 className="pv-title">
            What Kova keeps, <span>and why</span>
            <span className="lp-coin" aria-hidden="true" />
          </h1>
          <p className="pv-lead">
            Kova is a dollar wallet and a shop till, built on Monad. This page says, in plain words,
            what we keep about you, who else sees it, and how to have it deleted.
          </p>
          <p className="pv-date">Last updated {UPDATED}</p>
        </header>

        <section className="pv-short" aria-labelledby="pv-short-title">
          <h2 className="pv-h2" id="pv-short-title">
            The short version
          </h2>
          <ul className="pv-cards">
            {SHORT.map((s, i) => (
              <li className="pv-card" key={s.title}>
                <span className={i === 1 || i === 2 ? 'pv-chip is-coral' : 'pv-chip'}>
                  <Icon name={s.icon} size={22} />
                </span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="pv-section" aria-labelledby="pv-keep-title">
          <h2 className="pv-h2" id="pv-keep-title">
            What we keep, and why
          </h2>
          <p className="pv-intro">
            Only what Kova needs to work. Most of it exists only if you use that part of Kova.
          </p>
          <dl className="pv-list">
            {KEEP.map((k) => (
              <div className="pv-row" key={k.what}>
                <dt>{k.what}</dt>
                <dd>{k.body}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="pv-section" aria-labelledby="pv-others-title">
          <h2 className="pv-h2" id="pv-others-title">
            Who else sees it
          </h2>
          <p className="pv-intro">
            We share only what each service needs to do its part. We don’t sell your data to anyone.
          </p>
          <dl className="pv-list">
            {OTHERS.map((o) => (
              <div className="pv-row" key={o.who}>
                <dt>{o.who}</dt>
                <dd>{o.body}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="pv-section" aria-labelledby="pv-asks-title">
          <h2 className="pv-h2" id="pv-asks-title">
            What the app asks for
          </h2>
          <dl className="pv-list">
            {ASKS.map((a) => (
              <div className="pv-row" key={a.what}>
                <dt>{a.what}</dt>
                <dd>{a.body}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="pv-section pv-prose" aria-labelledby="pv-rest-title">
          <h2 className="pv-h2" id="pv-rest-title">
            The rest
          </h2>
          <h3>How long we keep it</h3>
          <p>
            As long as your wallet or shop uses Kova. Ask us to delete it and we will within 30
            days, except records the law makes us keep. What’s on Monad stays there: no one can
            delete it, including us.
          </p>
          <h3>How we protect it</h3>
          <p>
            Everything travels over HTTPS. Keys we hold are encrypted, PINs are kept only as hashes,
            and your wallet’s backup is locked on your device before it reaches us.
          </p>
          <h3>Cookies</h3>
          <p>
            The website sets a cookie to keep you signed in and one to remember your time zone.
            Nothing else.
          </p>
          <h3>Children</h3>
          <p>
            Kova isn’t for children under 13, and we don’t knowingly keep their data. If you think a
            child has used Kova, tell us and we’ll delete it.
          </p>
          <h3>Changes</h3>
          <p>
            When this page changes, the date at the top changes too. If a change matters, we’ll say
            so in the app.
          </p>
        </section>

        <section className="pv-contact" aria-labelledby="pv-contact-title">
          <span className="pv-chip is-coral is-big">
            <Icon name="mail" size={22} />
          </span>
          <div>
            <h2 id="pv-contact-title">Questions, or want your data?</h2>
            <p>
              Email <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. A person reads every message.
            </p>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <Brand />
        <p>Tap. Paid. Anywhere. Built on Monad.</p>
        <nav aria-label="Footer">
          <Link href="/">Kova</Link>
          <Link href="/try?ref=privacy">Try Kova in a minute</Link>
          <Link href="/waitlist">Kova for iOS</Link>
          <Link href="/stats">Kova, live</Link>
        </nav>
      </footer>
    </div>
  )
}
