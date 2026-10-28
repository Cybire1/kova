import type { Metadata } from 'next'
import Link from 'next/link'
import { Brand, Icon, type IconName, Pill } from '@/components/brand'
import '@/styles/legal.css'

const TITLE = 'Terms · Kova'
const DESCRIPTION =
  'The terms for using Kova: your wallet and keys, payments, partners, fees and what isn’t allowed. In plain words.'

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
}

const CONTACT = 'hello@mykova.app'
const UPDATED = '28 October 2026'

const SHORT: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'key',
    title: 'Your wallet, your keys',
    body: 'Kova never holds your money. Your passkey approves every payment, and only you have it.',
  },
  {
    icon: 'globe',
    title: 'Payments are final',
    body: 'A payment settles on Monad in about a second, and nobody can reverse it, including us. Check who you’re paying.',
  },
  {
    icon: 'shield',
    title: 'Partners do some parts',
    body: 'Buying with a card, naira in and out, and deposits from other networks are run by partners, under their own terms.',
  },
  {
    icon: 'mail',
    title: 'Ask us anything',
    body: `Email ${CONTACT}. A person reads every message.`,
  },
]

const TERMS: { what: string; body: string }[] = [
  {
    what: 'Who we are',
    body: `Kova is made by Quill Labs. These terms are between you and Quill Labs when you use Kova’s app, website or API. Using Kova means you accept them.`,
  },
  {
    what: 'Who can use Kova',
    body: 'You must be 18 or older and allowed to use these services where you live. Businesses must be run by someone who can act for them.',
  },
  {
    what: 'Your wallet and keys',
    body: 'Your wallet is yours: its keys come from your passkey, which stays on your device or in your password manager. Kova can’t move your money without your approval, and can’t recover it if you lose every passkey and backup. Keep your devices and passkeys safe.',
  },
  {
    what: 'Your dollars',
    body: 'Your balance is AUSD, a dollar stablecoin issued by Agora, on the Monad blockchain. Kova doesn’t issue it and isn’t a bank: your balance isn’t a bank deposit and isn’t insured by any government scheme.',
  },
  {
    what: 'Payments',
    body: 'Every payment you approve settles on Monad and is final. Kova pays the network fee for you. If you pay the wrong person or address, we can’t undo it; ask them to send it back.',
  },
  {
    what: 'Fees',
    body: 'Kova shows any fee before you approve. Partners may charge their own, shown in their checkout before you pay. Exchange rates for naira are shown before you confirm.',
  },
  {
    what: 'Partners',
    body: 'Some parts of Kova are run by partners: MoonPay and Ramp Network for buying with a card or bank, PAJ and Paystack for naira in and out, and Relay for deposits from other networks. They may ask for your ID or other details, under their own terms and privacy policies. We aren’t responsible for their services, but tell us if something goes wrong and we’ll help.',
  },
  {
    what: 'Keys you share',
    body: 'An allowance, an AI agent or a teammate can pay from a key you make, up to the limits you set. You’re responsible for what those keys pay within their limits; Monad stops each key at its limit.',
  },
  {
    what: 'Shops',
    body: 'If you sell with Kova, you’re responsible for what you sell, your prices, refunds and your taxes. Payments reach your wallet directly.',
  },
  {
    what: 'Savings',
    body: 'Where Savings is open to you, it moves the dollars you choose into a partner’s vault, held in your name, and back when you ask. What it earns changes and isn’t a promise. A vault can lose money or pause withdrawals for a while, and the Savings screen says when a vault is new or hasn’t been audited. Moving in and out takes one signature, and Kova covers the fee.',
  },
  {
    what: 'Stocks',
    body: 'Kova can show prices of tokenized stocks and any you already hold. Buying them isn’t available yet. Nothing in Kova is investment, tax or legal advice.',
  },
  {
    what: 'Test dollars and betas',
    body: 'Test dollars on Kova’s test network have no value and can’t be cashed out. Beta features, like the iOS TestFlight app, may change or stop.',
  },
]

const NOT_ALLOWED = [
  'Anything illegal where you or the other person are, including fraud, scams and money laundering.',
  'Getting around sanctions, or paying people or places under sanctions.',
  'Pretending to be someone else, or using someone else’s wallet or card without permission.',
  'Abusing free test dollars, or trying to break, overload or get around Kova’s limits and security.',
]

export default function TermsPage() {
  return (
    <div className="lp pv">
      <header className="lp-nav">
        <Brand />
        <div className="lp-nav-actions">
          <Link href="/try?ref=terms" className="lp-signin">
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
            <Icon name="shield" size={16} /> Terms of service
          </p>
          <h1 className="pv-title">
            The terms, <span>in plain words</span>
            <span className="lp-coin" aria-hidden="true" />
          </h1>
          <p className="pv-lead">
            Kova is a dollar wallet and a shop till, built on Monad. This page says what you can
            expect from Kova, and what Kova expects from you.
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

        <section className="pv-section" aria-labelledby="pv-terms-title">
          <h2 className="pv-h2" id="pv-terms-title">
            Using Kova
          </h2>
          <dl className="pv-list">
            {TERMS.map((t) => (
              <div className="pv-row" key={t.what}>
                <dt>{t.what}</dt>
                <dd>{t.body}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="pv-section pv-prose" aria-labelledby="pv-not-title">
          <h2 className="pv-h2" id="pv-not-title">
            What isn’t allowed
          </h2>
          <ul>
            {NOT_ALLOWED.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <p>
            We may pause or close access to Kova’s services for anyone who breaks these terms, and
            tell the authorities when the law requires it. Your wallet and its money stay yours.
          </p>
        </section>

        <section className="pv-section pv-prose" aria-labelledby="pv-rest-title">
          <h2 className="pv-h2" id="pv-rest-title">
            The rest
          </h2>
          <h3>Things outside our control</h3>
          <p>
            Kova is provided as it is. To the extent the law allows, we aren’t responsible for
            losses from lost passkeys or devices, payments to the wrong person, a partner’s service,
            an outage of Monad or another network, or changes in the value of AUSD or any token.
          </p>
          <h3>Changes to Kova</h3>
          <p>
            We may add, change or pause features, including for safety. If a change matters to you,
            we’ll say so in the app first when we can.
          </p>
          <h3>Changes to these terms</h3>
          <p>
            When these terms change, the date at the top changes too. Using Kova after that means
            you accept the new terms.
          </p>
          <h3>Stopping</h3>
          <p>
            You can stop using Kova at any time. Your wallet stays yours on Monad. To have your data
            deleted, see our <Link href="/privacy">privacy policy</Link>.
          </p>
          <h3>Problems</h3>
          <p>
            Tell us first, at {CONTACT}. Most problems are fixed by email, and we’ll always try that
            before anything else.
          </p>
        </section>

        <section className="pv-contact" aria-labelledby="pv-contact-title">
          <span className="pv-chip is-coral is-big">
            <Icon name="mail" size={22} />
          </span>
          <div>
            <h2 id="pv-contact-title">Questions about these terms?</h2>
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
          <Link href="/privacy">Privacy</Link>
          <Link href="/try?ref=terms">Try Kova in a minute</Link>
          <Link href="/stats">Kova, live</Link>
        </nav>
      </footer>
    </div>
  )
}
