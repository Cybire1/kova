import type { Metadata } from 'next'
import Link from 'next/link'
import { Brand, Icon, Pill } from '@/components/brand'
import { PhoneShot } from '@/components/iphone-beta'
import { ANDROID } from '@/lib/android'

const TITLE = 'Kova for Android · Download'
const DESCRIPTION =
  'A dollar account you open with your fingerprint. Get paid, pay, run a shop and cash out to any Nigerian bank. Download Kova for Android.'

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
}

/**
 * Kova for Android, straight from Kova while it waits for Google Play: the APK, how to install it,
 * and its SHA-256 so anyone can check the file. Laid out like the iOS page (styles/iphone.css).
 */
export default function AndroidPage() {
  return (
    <div className="lp ip">
      <header className="lp-nav">
        <Brand />
        <div className="lp-nav-actions">
          <Link href="/try?ref=android" className="lp-signin">
            Try it on the web
          </Link>
          <Pill href="/android/download" icon="download">
            Download
          </Pill>
        </div>
      </header>

      <section className="ip-hero">
        <div className="ip-copy">
          <p className="ip-kicker">
            <span className="ip-live" aria-hidden="true" /> Kova for Android · Version{' '}
            {ANDROID.version}
          </p>
          <h1 className="ip-title">
            Your dollars,
            <br />
            <span>on Android</span>
            <span className="lp-coin" aria-hidden="true" />
          </h1>
          <p className="ip-lead">
            A dollar account you open with your fingerprint. Get paid by link, run a shop, pay
            anyone, and cash out to any Nigerian bank in seconds. Every payment settles on Monad,
            and Kova pays the gas.
          </p>
          <div className="ip-form">
            <Pill href="/android/download" icon="download">
              Download Kova for Android ({ANDROID.sizeMb} MB)
            </Pill>
          </div>
          <p className="ip-keep">
            <Icon name="shield" size={16} /> Signed by Kova. Google Play is coming; until then, it
            installs straight from here.
          </p>
        </div>

        <div className="ip-stage">
          <PhoneShot
            name="send"
            alt="Send to anyone, in their own currency"
            className="ip-stage-left"
          />
          <PhoneShot
            name="home"
            alt="Kova’s Home: your dollars, ready to spend"
            className="ip-stage-center"
            priority
          />
          <PhoneShot name="card" alt="A Kova Card with a daily limit" className="ip-stage-right" />
        </div>
      </section>

      <section className="ip-how" aria-labelledby="ad-how-title">
        <h2 className="lp-h2" id="ad-how-title">
          How to install it
        </h2>
        <ol className="ip-steps">
          <li>
            <span className="ip-step-n">1</span>
            <h3>Download on your phone</h3>
            <p>Open this page on your Android phone and tap Download. Android 9 or newer.</p>
          </li>
          <li>
            <span className="ip-step-n">2</span>
            <h3>Allow the install</h3>
            <p>
              Open the file. If Android asks, allow your browser to install apps, then tap Install.
              Play Protect may ask you to confirm: it’s a new app, not on Play yet.
            </p>
          </li>
          <li>
            <span className="ip-step-n">3</span>
            <h3>Open Kova</h3>
            <p>
              Make your wallet with your fingerprint. Your passkey is kept by Google Password
              Manager. No seed phrase, and no gas token to buy.
            </p>
          </li>
        </ol>
        <p className="ip-web">
          SHA-256 of the file: <code style={{ wordBreak: 'break-all' }}>{ANDROID.sha256}</code>
        </p>
      </section>

      <footer className="lp-foot">
        <Brand />
        <p>Kova for Android, straight from Kova. Built on Monad.</p>
        <nav aria-label="Footer">
          <Link href="/">Kova</Link>
          <Link href="/waitlist">Kova for iOS</Link>
          <Link href="/stats">Kova, live</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </nav>
      </footer>
    </div>
  )
}
