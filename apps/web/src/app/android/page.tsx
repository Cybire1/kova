import type { Metadata } from 'next'
import { HomeMotion } from '@/components/home-motion'
import { SiteFooter, SiteNav, SiteSprite } from '@/components/site'
import { ANDROID } from '@/lib/android'
import { network } from '@/lib/network'
import '../../styles/home.css'

const TITLE = 'Kova for Android · Download'
const DESCRIPTION =
  'A dollar wallet you open with your fingerprint. Spend with a dollar card, send to 20 networks and cash out to banks in 35+ countries. Download Kova for Android.'

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
}

const STEPS = [
  ['Download on your phone', 'Open this page on your Android phone and tap Download.'],
  [
    'Allow the install',
    'Open the file. If Android asks, let your browser install apps, then tap Install. Play Protect may ask you to confirm: Kova is new and isn’t on Play yet.',
  ],
  [
    'Open Kova',
    'Make your wallet with your fingerprint. Google Password Manager keeps your passkey. No seed phrase, and no gas to buy.',
  ],
] as const

/**
 * Kova for Android, straight from Kova while it waits for Google Play: the APK, how to install it,
 * and its SHA-256 so anyone can check the file. Built like the home page (styles/home.css).
 */
export default function AndroidPage() {
  const mainnet = network === 'mainnet'
  return (
    <div className="kl" id="kl">
      <SiteSprite />
      <SiteNav login="Log in" />
      <main>
        <section className="ad-hero">
          <div className="wrap ad-grid">
            <div className="ad-copy">
              <span className="ktag">Kova for Android · Version {ANDROID.version}</span>
              <h1>
                Kova for
                <br />
                Android.
              </h1>
              <p className="lede">
                A dollar wallet you open with your fingerprint. Spend with a dollar card, send to 20
                networks, and cash out to banks in 35+ countries.
              </p>
              <div className="ctas">
                <a className="btn b-ink" href="/android/download">
                  Download · {ANDROID.sizeMb} MB
                  <span className="o">
                    <svg aria-hidden="true" className="i" style={{ rotate: '90deg' }}>
                      <use href="#i-arrow" />
                    </svg>
                  </span>
                </a>
                <a className="btn b-soft" href="/wallet">
                  Open on the web
                </a>
              </div>
              <p className="ad-note">
                <svg aria-hidden="true" className="i">
                  <use href="#i-lock" />
                </svg>
                Signed by Kova. Google Play is coming; until then, it installs straight from here.
                Android 9 or newer.
              </p>
            </div>
            <div className="s-visual" data-par>
              <div className="ph">
                <img
                  className="lt"
                  src="/site/home.webp"
                  alt="Kova home screen: available balance, Pay, Send and Request"
                />
                <img
                  className="dk"
                  src="/site/card-dark.webp"
                  alt="The dollar card in dark mode: $144.02 ready to spend"
                />
              </div>
              <img className="card-float" src="/site/card-coral.webp" alt="" />
            </div>
          </div>
        </section>

        <section className="sec ad-how" aria-labelledby="ad-how">
          <div className="wrap">
            <span className="ktag">How to install it</span>
            <h2 id="ad-how">Three steps, about a minute.</h2>
            <ol className="ad-steps">
              {STEPS.map(([title, body], i) => (
                <li key={title}>
                  <span className="num">0{i + 1}</span>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </li>
              ))}
            </ol>
            <div className="ad-sum">
              <div className="ad-sum-top">
                <b>Check the file</b>
                <button type="button" className="ad-copybtn" data-copy={ANDROID.sha256}>
                  <svg aria-hidden="true" className="i">
                    <use href="#i-check" />
                  </svg>
                  <span>Copy</span>
                </button>
              </div>
              <span>SHA-256 of {ANDROID.url.split('/').pop()}</span>
              <code>{ANDROID.sha256}</code>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter mainnet={mainnet} />
      <HomeMotion />
    </div>
  )
}
