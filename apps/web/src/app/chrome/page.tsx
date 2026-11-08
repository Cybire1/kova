import { tokens } from '@kova/monad'
import type { Metadata } from 'next'
import type { CSSProperties } from 'react'
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

/** Kova for Chrome against the usual wallet, row by row: what happens, and who carries the risk. */
const VERSUS = [
  [
    'A site wants your money',
    'You approve a token allowance, often with no limit at all.',
    'It gets a budget you choose: $5, $20 or $50, a day or a week.',
  ],
  [
    'The site turns bad',
    'It can take everything you approved.',
    'It can spend its budget. Monad refuses the rest.',
  ],
  [
    'You want it stopped',
    'Revoke each approval on-chain, token by token, paying gas each time.',
    'One switch. Or Freeze all.',
  ],
  [
    'A page costs a cent',
    'There’s no way to pay it without a checkout.',
    'Paid from the site’s budget by itself, and the page opens.',
  ],
  [
    'Getting in',
    'A seed phrase to write down and guard.',
    'Your passkey or Google: the same wallet as the Kova app.',
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
            <div
              className="s-visual ch-visual"
              data-par
              role="img"
              aria-label="orbit.trade asks for $4.99. Kova asks for its budget, $20 a day, and pays. Then orbit.trade asks for $40, and Kova refuses: it’s over the budget, and nothing moves."
            >
              <div className="ch-browser" aria-hidden="true">
                <div className="ch-bar">
                  <span className="ch-dots">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="ch-url">
                    <svg aria-hidden="true" className="i">
                      <use href="#i-lock" />
                    </svg>
                    orbit.trade
                  </span>
                  <span className="ch-ext">
                    <svg aria-hidden="true" viewBox="0 0 200 200" className="ch-ext-mark">
                      <path d="M62 46 V154" />
                      <path d="M92.6 74.3 A40 40 0 0 1 92.6 125.7" />
                      <path d="M115.6 55 A70 70 0 0 1 115.6 145" />
                      <path d="M138.6 35.7 A100 100 0 0 1 138.6 164.3" />
                    </svg>
                  </span>
                </div>
                <div className="ch-site">
                  <div className="ch-site-top">
                    <b>orbit</b>
                    <span />
                    <span />
                  </div>
                  <div className="ch-art">
                    <span className="ch-orb" />
                  </div>
                  <span className="ch-l w70" />
                  <span className="ch-l w45" />
                  <div className="ch-buys">
                    <span className="ch-buy b1">Buy for $4.99</span>
                    <span className="ch-buy b2">Buy for $40</span>
                  </div>
                </div>
                <div className="ch-pop">
                  <img className="lt" src="/site/chrome-budget-light.webp" alt="" />
                  <img className="dk" src="/site/chrome-budget-dark.webp" alt="" />
                </div>
                <div className="ch-meter">
                  <span className="ch-meter-top">
                    <b>orbit.trade</b>
                    <small className="m-a">$20 a day</small>
                    <small className="m-b">$15.01 left today</small>
                  </span>
                  <span className="ch-meter-bar">
                    <i />
                  </span>
                </div>
                <div className="ch-toast t-ok">
                  <span className="ch-tdot">
                    <svg aria-hidden="true" className="i">
                      <use href="#i-check" />
                    </svg>
                  </span>
                  <span>
                    <b>Paid $4.99</b>
                    <small>From orbit.trade’s budget</small>
                  </span>
                </div>
                <div className="ch-toast t-no">
                  <span className="ch-tdot">
                    <svg aria-hidden="true" className="i">
                      <use href="#i-x" />
                    </svg>
                  </span>
                  <span>
                    <b>Not paid</b>
                    <small>$40 is over its budget. Nothing moved.</small>
                  </span>
                </div>
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

        <section className="sec ch-vs" aria-labelledby="ch-vs">
          <div className="wrap">
            <span className="ktag">Why it’s different</span>
            <h2 id="ch-vs">Most wallets hand a site the keys. Kova hands it a budget.</h2>
            <table className="ch-vs-table rv">
              <caption className="ch-vs-cap">The usual wallet against Kova for Chrome</caption>
              <thead>
                <tr className="ch-vs-head">
                  <th scope="col" className="ch-vs-when">
                    When
                  </th>
                  <th scope="col">The usual wallet</th>
                  <th scope="col" className="ch-vs-kova">
                    Kova for Chrome
                  </th>
                </tr>
              </thead>
              <tbody>
                {VERSUS.map(([when, usual, kova], i) => (
                  <tr className="ch-vs-row" key={when} style={{ '--i': i } as CSSProperties}>
                    <th scope="row" className="ch-vs-when">
                      {when}
                    </th>
                    <td className="ch-vs-usual">
                      <svg aria-hidden="true" className="i">
                        <use href="#i-x" />
                      </svg>
                      {usual}
                    </td>
                    <td className="ch-vs-kova">
                      <svg aria-hidden="true" className="i">
                        <use href="#i-check" />
                      </svg>
                      {kova}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
