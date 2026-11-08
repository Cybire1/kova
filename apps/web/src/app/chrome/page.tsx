import { tokens } from '@kova/monad'
import type { Metadata } from 'next'
import { HomeMotion } from '@/components/home-motion'
import { SiteFooter, SiteNav, SiteSprite } from '@/components/site'
import { TryChrome } from '@/components/try-chrome'
import { CHROME_ZIP } from '@/lib/extension'
import { network } from '@/lib/network'
import { TIP, tryPayTo } from '@/lib/try-chrome'
import '../../styles/home.css'
import '../../styles/chrome.css'

// KOVA_TRY_PAY_TO is read when the page is asked for, so it can be set without a rebuild.
export const dynamic = 'force-dynamic'

const TITLE = 'Kova for Chrome · Give every site a budget'
const DESCRIPTION =
  'A wallet for websites. Connecting shows a site your address and nothing else. When it wants to be paid, it gets its own limit, enforced on Monad, and one switch freezes it.'

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
}

const WHY = [
  [
    'A budget per site, not your wallet',
    'Every site that wants to be paid gets its own key with a daily or weekly limit. Monad enforces it, so even a hacked site can only spend what you gave it.',
  ],
  [
    'Pages that cost a cent',
    'When a page answers “402 Payment Required”, Kova pays it from that site’s budget and the page opens. Small amounts under your line never ask.',
  ],
  [
    'One switch stops it',
    'Freeze a site, or every site at once, from the toolbar. Only your passkey or Google sign-in turns it back on.',
  ],
  [
    'No approvals that never end',
    'Kova refuses the open-ended token approvals and blind signatures most wallet drains start with. A site can only spend its budget.',
  ],
] as const

const INSTALL = [
  ['Download', 'Download the zip below and unzip it. You get a folder called kova-chrome-0.1.0.'],
  [
    'Switch on developer mode',
    'Open chrome://extensions in Chrome and turn on Developer mode, top right.',
  ],
  [
    'Load it',
    'Click Load unpacked and choose the folder. Pin Kova to the toolbar, then connect your wallet with your passkey or Google.',
  ],
] as const

/**
 * mykova.app/chrome: Kova for Chrome, and a place to try it with a few cents. Built like the home
 * page (styles/home.css); the live demo is components/try-chrome.tsx, the 1¢ article
 * app/chrome/article.
 */
export default function ChromePage() {
  const mainnet = network === 'mainnet'
  const ausd = tokens[network].AUSD
  return (
    <div className="kl" id="kl">
      <SiteSprite />
      <SiteNav login="Log in" />
      <main>
        <section className="ad-hero">
          <div className="wrap ad-grid">
            <div className="ad-copy">
              <span className="ktag">Kova for Chrome · Beta</span>
              <h1>
                Give every site
                <br />a budget, not
                <br />
                your wallet.
              </h1>
              <p className="lede">
                A wallet for websites. Connecting shows a site your address and nothing else. When
                it wants to be paid, it gets its own limit, enforced on Monad, and one switch
                freezes it.
              </p>
              <div className="ctas">
                <a className="btn b-ink" href="#try">
                  Try it on this page
                  <span className="o">
                    <svg aria-hidden="true" className="i" style={{ rotate: '90deg' }}>
                      <use href="#i-arrow" />
                    </svg>
                  </span>
                </a>
                <a className="btn b-soft" href={CHROME_ZIP} download>
                  Download for Chrome
                </a>
              </div>
              <p className="ad-note">
                <svg aria-hidden="true" className="i">
                  <use href="#i-lock" />
                </svg>
                Coming to the Chrome Web Store. Until then it installs in developer mode, in about a
                minute.
              </p>
            </div>
            <div className="s-visual ch-visual" data-par>
              <div className="ch-win">
                <img
                  className="lt"
                  src="/site/chrome-budget-light.webp"
                  alt="Kova for Chrome asking for a budget: orbit.trade asks $4.99, with $5, $20 and $50 limits, a day or a week"
                />
                <img
                  className="dk"
                  src="/site/chrome-budget-dark.webp"
                  alt="Kova for Chrome asking for a budget, in dark mode"
                />
              </div>
              <div className="ch-list">
                <img
                  className="lt"
                  src="/site/chrome-sites-light.webp"
                  alt="Four sites with budgets: northline.air, railgo.example (frozen), atlas.market and pixel.news"
                />
                <img className="dk" src="/site/chrome-sites-dark.webp" alt="" />
              </div>
            </div>
          </div>
        </section>

        <section className="sec ch-try" id="try" aria-labelledby="ch-try">
          <div className="wrap">
            <span className="ktag">Try it here</span>
            <h2 id="ch-try">Three steps. Eleven cents.</h2>
            <p className="lede">
              This page is a site like any other. Connect Kova for Chrome to it, let it ask for a
              tip, then open an article that costs a cent.
            </p>
            {ausd ? (
              <TryChrome
                network={network}
                ausd={ausd.address}
                payTo={tryPayTo()}
                tip={TIP.toString()}
              />
            ) : null}
          </div>
        </section>

        <section className="sec ch-why" aria-labelledby="ch-why">
          <div className="wrap ch-why-grid">
            <div>
              <span className="ktag">Why it’s different</span>
              <h2 id="ch-why">Most wallets hand every site the keys. Kova hands it a budget.</h2>
            </div>
            <ul className="ch-why-list">
              {WHY.map(([title, body]) => (
                <li key={title} className="rv">
                  <h3>{title}</h3>
                  <p>{body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="sec ad-how" id="get" aria-labelledby="ch-get">
          <div className="wrap">
            <span className="ktag">Install it</span>
            <h2 id="ch-get">Three steps, about a minute.</h2>
            <ol className="ad-steps">
              {INSTALL.map(([title, body], i) => (
                <li key={title}>
                  <span className="num">0{i + 1}</span>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </li>
              ))}
            </ol>
            <div className="ch-get">
              <a className="btn b-ink" href={CHROME_ZIP} download>
                Download Kova for Chrome
                <span className="o">
                  <svg aria-hidden="true" className="i" style={{ rotate: '90deg' }}>
                    <use href="#i-arrow" />
                  </svg>
                </span>
              </a>
              <span>
                Version 0.1.0 · for Chrome and other Chromium browsers ·{' '}
                {mainnet ? 'Monad' : 'Monad testnet'}
              </span>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter mainnet={mainnet} />
      <HomeMotion />
    </div>
  )
}
