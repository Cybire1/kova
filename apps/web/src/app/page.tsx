import type { Metadata } from 'next'
import Link from 'next/link'
import { Art, Brand, Icon, Pill } from '@/components/brand'
import { PaidCoin, ReceiptHero } from '@/components/receipt-hero'
import { getSession } from '@/lib/session'
import { signInDemo } from './actions'
import { PaidInASecond } from '@/components/paid-in-a-second'
import { IphoneCard } from '@/components/iphone-beta'

export const metadata: Metadata = {
  title: { absolute: 'Kova · Tap. Paid. Anywhere.' },
  description: 'Your dollars, anywhere, in seconds. A wallet that opens with a passkey, with your shop inside it. On Monad.',
}

/** A full stop drawn as the brand's coin, the same as the o in the wordmark. */
const Coin = () => <span className="lp-coin" aria-hidden="true" />

export default async function Landing() {
  const signedIn = Boolean(await getSession())
  const mainnet = process.env.KOVA_NETWORK === 'mainnet'
  // One waitlist: the test network's site sends people to mykova.app's.
  const iphone = mainnet ? '/waitlist' : 'https://mykova.app/waitlist'
  return (
    <div className="lp">
      <header className="lp-nav">
        <Brand />
        <nav aria-label="Sections">
          <a href="#how">How it works</a>
          <a href="#shops">For shops</a>
          <a href="#people">For people</a>
          <a href="#developers">Developers</a>
          <a href={iphone}>iOS</a>
        </nav>
        <div className="lp-nav-actions">
          {signedIn ? null : (
            <Link href="/wallet" className="lp-signin">
              Sign in
            </Link>
          )}
          <Pill href="/wallet" icon="arrow">
            Open Kova
          </Pill>
        </div>
      </header>

      {/* Hero ------------------------------------------------------------------------------ */}
      <section className="lp-hero">
        <div className="lp-hero-copy">
          <h1 className="lp-title" aria-label="Tap. Paid. Anywhere.">
            <span className="lp-word" style={{ '--i': 0 } as React.CSSProperties}>
              Tap
              <Coin />
            </span>
            <span className="lp-word" style={{ '--i': 1 } as React.CSSProperties}>
              Paid
              <PaidCoin />
            </span>
            <span className="lp-word" style={{ '--i': 2 } as React.CSSProperties}>
              Anywhere
              <Coin />
            </span>
          </h1>
          <p className="lp-lead">
            Kova turns any phone into a till for digital dollars. Your customer taps or scans, and the money settles on Monad in about a second, straight to your own
            wallet. No card machine, no card fees, no waiting days to get paid.
          </p>
          <div className="lp-ctas">
            <Pill href="/wallet/shop?go=open" icon="arrow" tone="coral">
              Open a shop, free
            </Pill>
            <form action={signInDemo}>
              <Pill type="submit" icon="tap" tone="light">
                Explore the demo shop
              </Pill>
            </form>
          </div>
          <p className="lp-fine">
            {mainnet ? 'Live on Monad mainnet. Dollars that settle in about a second.' : 'Live on Monad’s test network. Test dollars, real speed.'}{' '}
            <Link href="/try?ref=site">Try it in a minute</Link>
          </p>
        </div>

        <div className="lp-hero-stage">
          <ReceiptHero />
        </div>
      </section>

      {/* How it works: the payment, at the speed it happens ------------------------------ */}
      <PaidInASecond />

      {/* Two sides --------------------------------------------------------------------------- */}
      <section className="lp-duo">
        <article className="lp-panel lp-panel-teal" id="shops">
          <p className="lp-panel-kicker">Kova Terminal, for shops</p>
          <h2>Your phone is the card machine</h2>
          <ul>
            <li>
              <Icon name="terminal" size={18} /> Pair any phone with a one-time code. Staff phones get a key that can only take payments.
            </li>
            <li>
              <Icon name="list" size={18} /> Every payment lands live on your dashboard, with the on-chain proof one click away.
            </li>
            <li>
              <Icon name="shield" size={18} /> Money settles to your own address. Kova never holds it, so there’s nothing to withdraw.
            </li>
          </ul>
          <Art name="scene-paid-terminal" size={290} className="lp-panel-art" />
        </article>
        <article className="lp-panel lp-panel-coral" id="people">
          <p className="lp-panel-kicker">Kova Pay, for people</p>
          <h2>Pay a shop in Singapore with dollars from London</h2>
          <ul>
            <li>
              <Icon name="tap" size={18} /> Tap to pay at the counter, confirmed with Face ID. Your key never leaves your phone.
            </li>
            <li>
              <Icon name="send" size={18} /> Send money to anyone, anywhere, in seconds, for a fraction of a cent.
            </li>
            <li>
              <Icon name="globe" size={18} /> See every amount in your own currency: dollars, euros or pounds.
            </li>
          </ul>
          <div className="lp-flight">
            <Art name="scene-send" size={352} />
            <Art name="kovi-ride" size={104} className="lp-flight-kovi" />
          </div>
        </article>
      </section>

      {/* Kova for iOS, in beta ------------------------------------------------------------ */}
      <section className="lp-iphone" aria-label="Kova for iOS">
        <IphoneCard href={iphone} />
      </section>

      {/* Currencies -------------------------------------------------------------------------- */}
      <section className="lp-fx" aria-label="One price, every currency">
        <p>One price, read in everyone’s own money</p>
        <div className="lp-fx-row">
          <span>
            <Art name="coin-usd" size={44} /> $12.50
          </span>
          <span>
            <Art name="coin-eur" size={44} /> €11.50
          </span>
          <span>
            <Art name="coin-gbp" size={44} /> £9.88
          </span>
        </div>
        <small>At Kova’s published reference rates. Payments always settle in dollars (AUSD, Agora’s dollar).</small>
      </section>

      {/* Developers -------------------------------------------------------------------------- */}
      <section className="lp-dev" id="developers">
        <div className="lp-dev-copy">
          <p className="lp-panel-kicker">For developers</p>
          <h2>One POST to charge. A signed webhook when it’s paid.</h2>
          <p>
            Take Kova payments on your own site or till software. Create a charge, show its code, and hear about it the moment it settles. Retries are safe with an
            Idempotency-Key, and every payment is matched on-chain, so there’s nothing to reconcile by hand.
          </p>
          <Pill href="/wallet/shop?go=open" icon="code" tone="paper">
            Get API keys
          </Pill>
        </div>
        <pre className="lp-code" aria-label="Example: create a charge">
          <code>
            <span className="c-dim">$</span> curl <span className="c-str">https://api.kova…/v1/payment_intents</span> \{'\n'}
            {'    '}-H <span className="c-str">"Authorization: Bearer $KOVA_SECRET_KEY"</span> \{'\n'}
            {'    '}-d <span className="c-str">{`'{"amount":"12.50","reference":"Order 1042"}'`}</span>
            {'\n\n'}
            {'{'}
            {'\n'}
            {'  '}
            <span className="c-key">"id"</span>: <span className="c-str">"pi_06gd1ajtn5yr71g1tdwpvk9fqm"</span>,{'\n'}
            {'  '}
            <span className="c-key">"amount"</span>: <span className="c-str">"12.50"</span>,{'\n'}
            {'  '}
            <span className="c-key">"status"</span>: <span className="c-str">"requires_payment"</span>,{'\n'}
            {'  '}
            <span className="c-key">"pay_to"</span>: <span className="c-str">"0x44e3…7e41"</span>
            {'\n'}
            {'}'}
            {'\n\n'}
            <span className="c-dim">{'// ≈1s later, to your webhook:'}</span>
            {'\n'}
            <span className="c-key">Kova-Signature</span>: t=1790208020,v1=9e56…{'\n'}
            {'{ '}
            <span className="c-key">"type"</span>: <span className="c-ok">"payment_intent.paid"</span>
            {' }'}
          </code>
        </pre>
      </section>

      {/* Trust --------------------------------------------------------------------------------- */}
      <section className="lp-section">
        <h2 className="lp-h2">Kova never holds your money</h2>
        <div className="lp-trust">
          <div>
            <Icon name="shield" size={24} />
            <h3>Settles to you, directly</h3>
            <p>Payments move from your customer’s wallet to yours. There’s no Kova balance in between, and nothing to freeze.</p>
          </div>
          <div>
            <Icon name="key" size={24} />
            <h3>Keys stay on phones</h3>
            <p>A Kova Pay wallet key lives in the phone’s secure chip behind Face ID. It never touches a server.</p>
          </div>
          <div>
            <Icon name="check" size={24} />
            <h3>Checked on-chain</h3>
            <p>Every payment carries a memo tying it to its charge, and Kova verifies it on Monad before anything says Paid.</p>
          </div>
        </div>
      </section>

      {/* Closing ----------------------------------------------------------------------------- */}
      <section className="lp-close">
        <Art name="kovi-peek" size={220} className="lp-close-peek" />
        <h2>Your counter is ready when you are</h2>
        <p>Open a shop in a minute. Pair your phone. Take your first payment before your coffee goes cold.</p>
        <div className="lp-ctas lp-ctas-center">
          <Pill href="/wallet/shop?go=open" icon="arrow">
            Open a shop
          </Pill>
          <form action={signInDemo}>
            <Pill type="submit" icon="tap" tone="paper">
              Explore the demo shop
            </Pill>
          </form>
        </div>
      </section>

      <footer className="lp-foot">
        <Brand />
        <p>Tap. Paid. Anywhere. Built on Monad.{mainnet ? '' : ' A test network preview: test dollars only.'}</p>
        <nav aria-label="Footer">
          <Link href="/wallet">Open Kova</Link>
          <Link href="/try?ref=site">Try Kova in a minute</Link>
          <a href={iphone}>Kova for iOS</a>
          <Link href="/stats">Kova, live</Link>
          <Link href="/wallet/shop?go=open">Open a shop</Link>
          <Link href="/signin">Shop sign-in with email or a key</Link>
          <a href="#developers">Developers</a>
        </nav>
      </footer>
    </div>
  )
}
