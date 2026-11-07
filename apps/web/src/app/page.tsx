import type { Metadata } from 'next'
import type { CSSProperties } from 'react'
import { HomeMotion } from '@/components/home-motion'
import { chainLogoXml } from '@/lib/chain-logos'
import { network } from '@/lib/network'
import { getSession } from '@/lib/session'
import { signInDemo } from './actions'
import '../styles/home.css'

export const metadata: Metadata = {
  title: { absolute: 'Kova · Dollars for every phone' },
  description:
    'Hold, spend and send dollars from your phone. A dollar card, sends to 20 networks and cash out to banks in 35+ countries. Opens with Face ID. On Monad.',
}

/** Where Kova cashes out in local money (apps/api/src/services/payout-corridors.ts), then SWIFT. */
const PLACES = [
  ['US', 'United States', 'Bank'],
  ['GB', 'United Kingdom', 'Bank'],
  ['EU', 'Euro area', 'SEPA bank'],
  ['CA', 'Canada', 'Bank, Interac'],
  ['NG', 'Nigeria', 'Bank, in seconds'],
  ['GH', 'Ghana', 'Bank, mobile money'],
  ['KE', 'Kenya', 'Bank, mobile money'],
  ['ZA', 'South Africa', 'Bank'],
  ['AE', 'UAE', 'Bank'],
  ['AU', 'Australia', 'Bank'],
  ['SG', 'Singapore', 'Bank'],
  ['PH', 'Philippines', 'Bank'],
  ['MX', 'Mexico', 'Bank'],
  ['HK', 'Hong Kong', 'Bank'],
  ['TZ', 'Tanzania', 'Bank, mobile money'],
  ['UG', 'Uganda', 'Bank, mobile money'],
  ['CN', 'China', 'Bank'],
  ['WW', 'Other countries', 'SWIFT, in dollars'],
] as const

/** The networks Send to any network reaches (the app's NETWORKS, gas-free ones only). */
const NETWORKS = [
  ['base', 'Base'],
  ['solana', 'Solana'],
  ['ethereum', 'Ethereum'],
  ['arbitrum', 'Arbitrum'],
  ['optimism', 'OP Mainnet'],
  ['polygon', 'Polygon'],
  ['avalanche', 'Avalanche'],
  ['unichain', 'Unichain'],
  ['linea', 'Linea'],
  ['world', 'World Chain'],
  ['sonic', 'Sonic'],
  ['sei', 'Sei'],
  ['hyperevm', 'HyperEVM'],
  ['ink', 'Ink'],
  ['codex', 'Codex'],
  ['plume', 'Plume'],
  ['xdc', 'XDC'],
  ['arc', 'Arc'],
  ['edge', 'Edge'],
] as const

/** Flags circling the naira coin on the cash-out card: [code, size, x, y] on a 160px ring. */
const ORBIT = ['US', 'GB', 'EU', 'GH', 'KE', 'ZA', 'CA', 'PH', 'AE', 'AU'].map((code, i, list) => {
  const t = (i / list.length) * Math.PI * 2
  return [
    code,
    [58, 48, 52][i % 3],
    Math.round(Math.cos(t) * 160),
    Math.round(Math.sin(t) * 160),
  ] as const
})

/** The page's line icons, drawn once and used by id. */
const SPRITE =
  '<defs>\n  <symbol id="i-arrow" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></symbol>\n  <symbol id="i-left" viewBox="0 0 24 24"><path d="M19 12H5M11 6l-6 6 6 6"/></symbol>\n  <symbol id="i-chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></symbol>\n  <symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>\n  <symbol id="i-check" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></symbol>\n  <symbol id="i-wallet" viewBox="0 0 24 24"><path d="M3.5 8A2.5 2.5 0 0 1 6 5.5h11.5V8"/><rect x="3.5" y="8" width="17" height="11" rx="2.5"/><path d="M16 13.5h.01"/></symbol>\n  <symbol id="i-card" viewBox="0 0 24 24"><rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h3"/></symbol>\n  <symbol id="i-send" viewBox="0 0 24 24"><path d="M20.5 3.5 10 14"/><path d="m20.5 3.5-6 17-4.5-6.5-6.5-4.5z"/></symbol>\n  <symbol id="i-bank" viewBox="0 0 24 24"><path d="M3.5 9.5 12 4l8.5 5.5M5.5 10v7.5M10 10v7.5M14 10v7.5M18.5 10v7.5M3.5 20h17"/></symbol>\n  <symbol id="i-chart" viewBox="0 0 24 24"><path d="M4 4v16h16"/><path d="m8 14 3.5-3.5 3 3L19 9"/></symbol>\n  <symbol id="i-eye" viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A9.8 9.8 0 0 1 12 5c5 0 8.5 4.5 9.5 7a13 13 0 0 1-2.4 3.6M6.6 6.6C4.5 8 3.1 10.1 2.5 12c1 2.5 4.5 7 9.5 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></symbol>\n  <symbol id="i-nosig" viewBox="0 0 24 24"><path d="M3 20h.01M7.5 20v-4M12 20v-8M16.5 20V8M21 4v16"/><path d="M3 3l18 18"/></symbol>\n  <symbol id="i-key" viewBox="0 0 24 24"><circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8.7-8.7M17 6l2.5 2.5M14.5 8.5l2 2"/></symbol>\n  <symbol id="i-bolt" viewBox="0 0 24 24"><path d="M13 2.5 4.5 14H11l-1 7.5L18.5 10H12z"/></symbol>\n  <symbol id="i-spark" viewBox="0 0 24 24"><path d="M12 3.5l1.7 5 5 1.7-5 1.7-1.7 5-1.7-5-5-1.7 5-1.7z"/></symbol>\n  <symbol id="i-users" viewBox="0 0 24 24"><circle cx="9" cy="8.5" r="3.5"/><path d="M3 19.5a6 6 0 0 1 12 0M16 5a3.5 3.5 0 0 1 0 7M18.5 14.5a6 6 0 0 1 2.5 5"/></symbol>\n  <symbol id="i-phone" viewBox="0 0 24 24"><rect x="6.5" y="3" width="11" height="18" rx="3"/><path d="M11 18h2"/></symbol>\n  <symbol id="i-store" viewBox="0 0 24 24"><path d="M4.5 10v9.5h15V10M3.5 4.5h17L19 9.5a2.3 2.3 0 0 1-4.4.4 2.3 2.3 0 0 1-4.2 0A2.3 2.3 0 0 1 6 9.5z"/></symbol>\n  <symbol id="i-lock" viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></symbol>\n  <symbol id="i-code" viewBox="0 0 24 24"><path d="m8 7-5 5 5 5M16 7l5 5-5 5"/></symbol>\n  <symbol id="i-hook" viewBox="0 0 24 24"><path d="M4 12h3l2.5-6 5 12 2.5-6h3"/></symbol>\n  <symbol id="i-gh" viewBox="0 0 24 24"><path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/></symbol>\n  <symbol id="i-x" viewBox="0 0 24 24"><path d="M4.5 4.5l15 15M19.5 4.5l-15 15"/></symbol>\n  <symbol id="i-apple" viewBox="0 0 24 24"><path d="M15.5 3.5c-.9.1-2 .7-2.6 1.5-.6.7-1 1.7-.9 2.6 1 .1 2-.5 2.6-1.3.6-.8 1-1.8.9-2.8zM12 8.3c-1 0-2.2-.8-3.4-.8-1.8 0-3.6 1.5-3.6 4.4 0 3.6 2.5 8.1 4.4 8.1.9 0 1.5-.6 2.6-.6s1.6.6 2.6.6c1.6 0 3.1-3 3.6-4.6-1.6-.7-2.5-2.1-2.5-3.7 0-1.4.8-2.6 2-3.3-.8-1.1-2-1.6-3.1-1.6-1.2 0-2 .8-2.6.8z"/></symbol>\n  <symbol id="i-android" viewBox="0 0 24 24"><path d="M5.5 10.5a6.5 6.5 0 0 1 13 0v6.5h-13z"/><path d="M8 5 6.5 3M16 5l1.5-2M9.5 8.5h.01M14.5 8.5h.01M8.5 17v3.5M15.5 17v3.5"/></symbol>\n  <symbol id="i-globe" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5a13 13 0 0 1 0 17M12 3.5a13 13 0 0 0 0 17"/></symbol>\n  <symbol id="i-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></symbol>\n  <symbol id="i-moon" viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></symbol>\n  <symbol id="i-auto" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor"/></symbol>\n  <symbol id="i-monad" viewBox="0 0 24 24"><path fill="#836EF9" d="M24 0H0v24h24z"/><path fill="#fff" d="M12 4c-2.31 0-8 5.69-8 8s5.69 8 8 8 8-5.69 8-8-5.69-8-8-8m-1.247 12.575c-.974-.266-3.593-4.847-3.328-5.822s4.848-3.593 5.822-3.328 3.593 4.847 3.328 5.822-4.847 3.593-5.822 3.328"/></symbol>\n  <symbol id="i-logo" viewBox="0 0 200 200"><path d="M62 46 V154" stroke="var(--ink)" stroke-width="19" stroke-linecap="round" fill="none"/><path d="M92.6 74.3 A40 40 0 0 1 92.6 125.7 M115.6 55 A70 70 0 0 1 115.6 145 M138.6 35.7 A100 100 0 0 1 138.6 164.3" stroke="var(--coral)" stroke-width="17" stroke-linecap="round" fill="none"/></symbol>\n  <symbol id="i-word" viewBox="0 0 252 100"><g stroke="var(--ink)" stroke-width="15.5" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M8 8 V92M12 70 L40 38M26 56 L44 92M130 40 L150 92 L170 40M238 40 V92"/><circle cx="212" cy="66" r="26"/></g><circle cx="86" cy="65" r="27" fill="#EBB3AA" stroke="var(--ink)" stroke-width="15.5"/></symbol>\n</defs>'

/** The developer section's three examples, already coloured. */
const CODE = [
  '<span class="m">$</span> curl <span class="s">$KOVA_API/v1/payment_intents</span> \\\n    -H <span class="s">"Authorization: Bearer $KOVA_SECRET_KEY"</span> \\\n    -H <span class="s">"Idempotency-Key: order-1042"</span> \\\n    -d <span class="s">\'{"amount":"12.50","reference":"Order 1042"}\'</span>\n\n{\n  <span class="k">"id"</span>: <span class="s">"pi_06gd1ajtn5yr71g1tdwpvk9fqm"</span>,\n  <span class="k">"amount"</span>: <span class="s">"12.50"</span>,\n  <span class="k">"status"</span>: <span class="s">"requires_payment"</span>\n}',
  '<span class="m">// About a second later, to your endpoint</span>\n<span class="k">Kova-Signature</span>: t=1790208020,v1=9e56\u2026\n\n{\n  <span class="k">"type"</span>: <span class="g">"payment_intent.paid"</span>,\n  <span class="k">"data"</span>: {\n    <span class="k">"id"</span>: <span class="s">"pi_06gd1ajtn5yr71g1tdwpvk9fqm"</span>,\n    <span class="k">"amount"</span>: <span class="s">"12.50"</span>,\n    <span class="k">"reference"</span>: <span class="s">"Order 1042"</span>\n  }\n}',
  '<span class="m">// Give the agent a key with a daily limit,</span>\n<span class="m">// then add Kova\'s MCP server</span>\n{\n  <span class="k">"mcpServers"</span>: {\n    <span class="k">"kova"</span>: {\n      <span class="k">"url"</span>: <span class="s">"$KOVA_API/mcp"</span>,\n      <span class="k">"headers"</span>: { <span class="k">"Authorization"</span>: <span class="s">"Bearer $KOVA_AGENT_KEY"</span> }\n    }\n  }\n}\n<span class="m">// kova_status \u00b7 kova_pay \u00b7 kova_pay_charge \u00b7 kova_history</span>',
] as const

/** A network's mark, from the fixed SVGs in lib/chain-logos.ts. */
function Mark({
  id,
  as: Tag = 'span',
  className,
  style,
}: {
  id: string
  as?: 'span' | 'i'
  className?: string
  style?: CSSProperties
}) {
  const svg = (chainLogoXml as Record<string, string>)[id]
  // Arc and Edge have no mark yet: their first letter instead.
  if (!svg)
    return (
      <Tag className={className} style={style}>
        {id[0]?.toUpperCase()}
      </Tag>
    )
  return (
    <Tag
      className={className}
      style={style}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed SVG string from lib/chain-logos.ts
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

export default async function Home() {
  const signedIn = Boolean(await getSession())
  const mainnet = network === 'mainnet'
  // One waitlist: the test network's site sends people to mykova.app's.
  const iphone = mainnet ? '/waitlist' : 'https://mykova.app/waitlist'
  const login = signedIn ? 'Open Kova' : 'Log in'
  return (
    <div className="kl" id="kl">
      <svg
        width="0"
        height="0"
        style={{ position: 'absolute' }}
        aria-hidden="true"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: the page's own fixed icon set, no input in it
        dangerouslySetInnerHTML={{ __html: SPRITE }}
      />

      <header className="nav" id="nav">
        <div className="nav-in">
          <a className="kbrand" href="#top">
            <svg role="img" aria-label="Kova home" width="32" height="32">
              <use href="#i-logo" />
            </svg>
            <svg aria-hidden="true" width="52" height="21">
              <use href="#i-word" />
            </svg>
          </a>
          <nav className="kpill" aria-label="Main">
            <div>
              <button type="button" className="pl" aria-expanded="false" data-drop="dp">
                Personal{' '}
                <svg aria-hidden="true" className="i chev">
                  <use href="#i-chev" />
                </svg>
              </button>
              <div className="drop d-personal" id="dp">
                <a className="mi" href="#card">
                  <span className="ic">
                    <svg aria-hidden="true" className="i">
                      <use href="#i-card" />
                    </svg>
                  </span>
                  <span>
                    <b>
                      Dollar card<i className="new">New</i>
                    </b>
                    <span>Spend online, top up in a tap</span>
                  </span>
                </a>
                <a className="mi" href="#send">
                  <span className="ic">
                    <svg aria-hidden="true" className="i">
                      <use href="#i-send" />
                    </svg>
                  </span>
                  <span>
                    <b>Send anywhere</b>
                    <span>To anyone, on 20 networks</span>
                  </span>
                </a>
                <a className="feat" href="#card">
                  <small>New</small>
                  <b>The Kova dollar card</b>
                  <p>Verify once and spend online.</p>
                  <img src="/site/card-coral.webp" alt="" />
                </a>
                <a className="mi" href="#places">
                  <span className="ic">
                    <svg aria-hidden="true" className="i">
                      <use href="#i-bank" />
                    </svg>
                  </span>
                  <span>
                    <b>Cash out</b>
                    <span>To banks and mobile money</span>
                  </span>
                </a>
                <a className="mi" href="#more">
                  <span className="ic">
                    <svg aria-hidden="true" className="i">
                      <use href="#i-chart" />
                    </svg>
                  </span>
                  <span>
                    <b>Stocks</b>
                    <span>Tesla, Nvidia, the S&amp;P 500</span>
                  </span>
                </a>
                <a className="mi" href="#more">
                  <span className="ic">
                    <svg aria-hidden="true" className="i">
                      <use href="#i-eye" />
                    </svg>
                  </span>
                  <span>
                    <b>Private payments</b>
                    <span>Only the receiver can open it</span>
                  </span>
                </a>
                <a className="mi" href="#more">
                  <span className="ic">
                    <svg aria-hidden="true" className="i">
                      <use href="#i-nosig" />
                    </svg>
                  </span>
                  <span>
                    <b>Offline payments</b>
                    <span>No signal, still paid</span>
                  </span>
                </a>
                <a className="mi" href="#more">
                  <span className="ic">
                    <svg aria-hidden="true" className="i">
                      <use href="#i-key" />
                    </svg>
                  </span>
                  <span>
                    <b>Allowances</b>
                    <span>A limit on every key</span>
                  </span>
                </a>
                <a className="mi" href="#more">
                  <span className="ic">
                    <svg aria-hidden="true" className="i">
                      <use href="#i-bolt" />
                    </svg>
                  </span>
                  <span>
                    <b>AI agents</b>
                    <span>Pay within your budget</span>
                  </span>
                </a>
              </div>
            </div>
            <div>
              <button type="button" className="pl" aria-expanded="false" data-drop="db">
                Business{' '}
                <svg aria-hidden="true" className="i chev">
                  <use href="#i-chev" />
                </svg>
              </button>
              <div className="drop d-business" id="db">
                <a className="mi" href="#business">
                  <span className="ic">
                    <svg aria-hidden="true" className="i">
                      <use href="#i-phone" />
                    </svg>
                  </span>
                  <span>
                    <b>Any phone is a till</b>
                    <span>Paid in about a second</span>
                  </span>
                </a>
                <a className="feat dark" href="#business">
                  <small>Free to start</small>
                  <b>Open a shop in a minute</b>
                  <p>No card machine, no card fees.</p>
                  <img src="/site/badge-shop.webp" alt="" />
                </a>
                <a className="mi" href="#business">
                  <span className="ic">
                    <svg aria-hidden="true" className="i">
                      <use href="#i-store" />
                    </svg>
                  </span>
                  <span>
                    <b>Your shop online</b>
                    <span>Menu, table codes, stamp cards</span>
                  </span>
                </a>
                <a className="mi" href="#business">
                  <span className="ic">
                    <svg aria-hidden="true" className="i">
                      <use href="#i-users" />
                    </svg>
                  </span>
                  <span>
                    <b>Pay your team</b>
                    <span>Payroll and suppliers</span>
                  </span>
                </a>
                <a className="mi" href="#business">
                  <span className="ic">
                    <svg aria-hidden="true" className="i">
                      <use href="#i-lock" />
                    </svg>
                  </span>
                  <span>
                    <b>Private takings</b>
                    <span>Your sales stay yours</span>
                  </span>
                </a>
              </div>
            </div>
            <div>
              <button type="button" className="pl" aria-expanded="false" data-drop="dd">
                Developers{' '}
                <svg aria-hidden="true" className="i chev">
                  <use href="#i-chev" />
                </svg>
              </button>
              <div className="drop d-dev" id="dd">
                <a className="mi" href="#developers">
                  <span className="ic">
                    <svg aria-hidden="true" className="i">
                      <use href="#i-code" />
                    </svg>
                  </span>
                  <span>
                    <b>Payments API</b>
                    <span>One POST to charge</span>
                  </span>
                </a>
                <a className="mi" href="#developers">
                  <span className="ic">
                    <svg aria-hidden="true" className="i">
                      <use href="#i-hook" />
                    </svg>
                  </span>
                  <span>
                    <b>Webhooks</b>
                    <span>Signed, the moment it’s paid</span>
                  </span>
                </a>
                <a className="mi" href="#developers">
                  <span className="ic">
                    <svg aria-hidden="true" className="i">
                      <use href="#i-bolt" />
                    </svg>
                  </span>
                  <span>
                    <b>AI agents over MCP</b>
                    <span>Pay within a limit you set</span>
                  </span>
                </a>
                <a className="mi" href="https://github.com/Cybire1/kova">
                  <span className="ic">
                    <svg aria-hidden="true" className="i">
                      <use href="#i-gh" />
                    </svg>
                  </span>
                  <span>
                    <b>Open source</b>
                    <span>Read every line on GitHub</span>
                  </span>
                </a>
              </div>
            </div>
            <div>
              <a className="pl" href="#faq">
                Help
              </a>
            </div>
          </nav>
          <div className="nav-r">
            <a className="login" href="/wallet">
              {login}
            </a>
            <a className="btn b-ink b-sm" href="#get">
              Get the app{' '}
              <span className="o">
                <svg aria-hidden="true" className="i">
                  <use href="#i-arrow" />
                </svg>
              </span>
            </a>
            <button
              type="button"
              className="menu-btn"
              id="menuBtn"
              aria-label="Menu"
              aria-expanded="false"
            >
              <i></i>
              <i></i>
            </button>
          </div>
        </div>
      </header>

      <div className="ksheet" id="sheet">
        <nav>
          <a className="big" href="#card" data-close>
            Dollar card{' '}
            <svg aria-hidden="true" className="i">
              <use href="#i-arrow" />
            </svg>
          </a>
          <a className="big" href="#send" data-close>
            Send anywhere{' '}
            <svg aria-hidden="true" className="i">
              <use href="#i-arrow" />
            </svg>
          </a>
          <a className="big" href="#more" data-close>
            Everything else{' '}
            <svg aria-hidden="true" className="i">
              <use href="#i-arrow" />
            </svg>
          </a>
          <a className="big" href="#business" data-close>
            Business{' '}
            <svg aria-hidden="true" className="i">
              <use href="#i-arrow" />
            </svg>
          </a>
          <a className="big" href="#developers" data-close>
            Developers{' '}
            <svg aria-hidden="true" className="i">
              <use href="#i-arrow" />
            </svg>
          </a>
          <a className="big" href="#faq" data-close>
            Help{' '}
            <svg aria-hidden="true" className="i">
              <use href="#i-arrow" />
            </svg>
          </a>
        </nav>
        <div className="sheet-b">
          <a className="btn b-ink" href="#get" data-close>
            Get the app{' '}
            <span className="o">
              <svg aria-hidden="true" className="i">
                <use href="#i-arrow" />
              </svg>
            </span>
          </a>
          <a className="btn b-soft" href="/wallet">
            {login}
          </a>
        </div>
      </div>

      <main id="top">
        <section className="hero" id="hero">
          <div className="art art-desk" aria-hidden="true">
            <div
              className="a"
              style={
                {
                  width: '118px',
                  left: '5%',
                  top: '150px',
                  '--r': '-14deg',
                  transitionDelay: '.05s',
                } as CSSProperties
              }
            >
              <img src="/site/coin-usd.webp" alt="" style={{ '--t': '8s' } as CSSProperties} />
            </div>
            <div
              className="a"
              style={
                {
                  width: '250px',
                  left: '9%',
                  top: '270px',
                  '--r': '-6deg',
                  transitionDelay: '.15s',
                } as CSSProperties
              }
            >
              <img
                src="/site/kovi-wave.webp"
                alt=""
                style={{ '--t': '7s', '--dl': '-2s' } as CSSProperties}
              />
            </div>
            <div
              className="a"
              style={
                {
                  width: '130px',
                  left: '21%',
                  top: '140px',
                  '--r': '8deg',
                  transitionDelay: '.25s',
                } as CSSProperties
              }
            >
              <img
                src="/site/plane.webp"
                alt=""
                style={{ '--t': '10s', '--dl': '-4s' } as CSSProperties}
              />
            </div>
            <div
              className="a"
              style={
                {
                  width: '78px',
                  left: '2.5%',
                  top: '470px',
                  '--r': '10deg',
                  transitionDelay: '.3s',
                } as CSSProperties
              }
            >
              <img
                src="/site/avatar-1.webp"
                alt=""
                style={{ '--t': '9s', '--dl': '-1s' } as CSSProperties}
              />
            </div>
            <div
              className="a"
              style={
                {
                  width: '84px',
                  left: '23%',
                  top: '470px',
                  '--r': '-10deg',
                  transitionDelay: '.35s',
                } as CSSProperties
              }
            >
              <img
                src="/site/coin-gbp.webp"
                alt=""
                style={{ '--t': '8.5s', '--dl': '-3s' } as CSSProperties}
              />
            </div>
            <div
              className="a"
              style={
                {
                  width: '30px',
                  left: '17%',
                  top: '230px',
                  transitionDelay: '.4s',
                } as CSSProperties
              }
            >
              <img src="/site/sparkle-1.webp" alt="" />
            </div>
            <div
              className="a"
              style={
                {
                  width: '24px',
                  left: '3%',
                  top: '330px',
                  transitionDelay: '.45s',
                } as CSSProperties
              }
            >
              <img src="/site/sparkle-8.webp" alt="" />
            </div>
            <div
              className="a"
              style={
                {
                  width: '22px',
                  left: '27%',
                  top: '380px',
                  transitionDelay: '.5s',
                } as CSSProperties
              }
            >
              <img src="/site/sparkle-5.webp" alt="" />
            </div>

            <div
              className="a card-art"
              style={
                {
                  width: '290px',
                  right: '5%',
                  top: '205px',
                  '--r': '14deg',
                  transitionDelay: '.1s',
                } as CSSProperties
              }
            >
              <img
                src="/site/card-coral.webp"
                alt=""
                style={{ '--t': '9s', '--dl': '-1s' } as CSSProperties}
              />
            </div>
            <div
              className="a"
              style={
                {
                  width: '96px',
                  right: '24%',
                  top: '104px',
                  '--r': '12deg',
                  transitionDelay: '.2s',
                } as CSSProperties
              }
            >
              <img
                src="/site/coin-eur.webp"
                alt=""
                style={{ '--t': '8s', '--dl': '-3s' } as CSSProperties}
              />
            </div>
            <div
              className="a"
              style={
                {
                  width: '92px',
                  right: '3%',
                  top: '112px',
                  '--r': '-8deg',
                  transitionDelay: '.28s',
                } as CSSProperties
              }
            >
              <img
                src="/site/coin-ngn.webp"
                alt=""
                style={{ '--t': '9.5s', '--dl': '-5s' } as CSSProperties}
              />
            </div>
            <div
              className="a"
              style={
                {
                  width: '170px',
                  right: '19%',
                  top: '420px',
                  '--r': '-4deg',
                  transitionDelay: '.34s',
                } as CSSProperties
              }
            >
              <img
                src="/site/kovi-ride.webp"
                alt=""
                style={{ '--t': '7.5s', '--dl': '-2s' } as CSSProperties}
              />
            </div>
            <div
              className="a"
              style={
                {
                  width: '76px',
                  right: '4%',
                  top: '470px',
                  '--r': '-6deg',
                  transitionDelay: '.4s',
                } as CSSProperties
              }
            >
              <img
                src="/site/avatar-3.webp"
                alt=""
                style={{ '--t': '8s', '--dl': '-4s' } as CSSProperties}
              />
            </div>
            <div
              className="a"
              style={
                {
                  width: '28px',
                  right: '27%',
                  top: '330px',
                  transitionDelay: '.45s',
                } as CSSProperties
              }
            >
              <img src="/site/sparkle-3.webp" alt="" />
            </div>
            <div
              className="a"
              style={
                {
                  width: '24px',
                  right: '30%',
                  top: '200px',
                  transitionDelay: '.5s',
                } as CSSProperties
              }
            >
              <img src="/site/sparkle-11.webp" alt="" />
            </div>
            <div
              className="a"
              style={
                {
                  width: '22px',
                  right: '2%',
                  top: '390px',
                  transitionDelay: '.55s',
                } as CSSProperties
              }
            >
              <img src="/site/sparkle-8.webp" alt="" />
            </div>
          </div>

          <div className="hero-copy">
            <div
              className="art-mob"
              aria-hidden="true"
              style={
                {
                  position: 'relative',
                  height: '132px',
                  margin: '-6px auto 10px',
                  maxWidth: '360px',
                } as CSSProperties
              }
            >
              <div
                className="a"
                style={{ width: '60px', left: '2%', top: '46px', '--r': '-14deg' } as CSSProperties}
              >
                <img src="/site/coin-usd.webp" alt="" style={{ '--t': '8s' } as CSSProperties} />
              </div>
              <div
                className="a"
                style={{ width: '40px', left: '21%', top: '2px', '--r': '12deg' } as CSSProperties}
              >
                <img
                  src="/site/coin-eur.webp"
                  alt=""
                  style={{ '--t': '9s', '--dl': '-3s' } as CSSProperties}
                />
              </div>
              <div
                className="a"
                style={
                  { width: '124px', left: '50%', marginLeft: '-62px', top: '0' } as CSSProperties
                }
              >
                <img src="/site/kovi-wave.webp" alt="" style={{ '--t': '7s' } as CSSProperties} />
              </div>
              <div
                className="a card-art"
                style={
                  { width: '116px', right: '1%', top: '40px', '--r': '14deg' } as CSSProperties
                }
              >
                <img
                  src="/site/card-coral.webp"
                  alt=""
                  style={{ '--t': '9s', '--dl': '-2s' } as CSSProperties}
                />
              </div>
              <div
                className="a"
                style={{ width: '18px', right: '30%', top: '8px' } as CSSProperties}
              >
                <img src="/site/sparkle-1.webp" alt="" />
              </div>
              <div
                className="a"
                style={{ width: '14px', left: '30%', top: '104px' } as CSSProperties}
              >
                <img src="/site/sparkle-8.webp" alt="" />
              </div>
            </div>
            <a className="news" href="#send">
              <span className="n">New</span>Send dollars to 19 more networks
              <svg aria-hidden="true" className="i">
                <use href="#i-arrow" />
              </svg>
            </a>
            <h1>
              Dollars for
              <br />
              every phone.
            </h1>
            <p className="lede">
              Hold, spend and send dollars from your phone. Kova opens with Face ID, so there’s no
              seed phrase to lose.
            </p>
            <div className="ctas">
              <a className="btn b-ink" href="#get">
                Get the app{' '}
                <span className="o">
                  <svg aria-hidden="true" className="i">
                    <use href="#i-arrow" />
                  </svg>
                </span>
              </a>
              <a className="btn b-soft" href="/wallet">
                Open on the web
              </a>
            </div>
          </div>

          <div className="stage">
            <div className="stage-in" id="stageIn">
              <div className="kdev l">
                <img src="/site/card.webp" alt="The dollar card screen" />
              </div>
              <div className="kdev c">
                <img
                  src="/site/home.webp"
                  alt="Kova home screen: available balance, Pay, Send and Request"
                />
              </div>
              <div className="kdev r">
                <img src="/site/anywhere.webp" alt="Send to another network: paste their address" />
              </div>
              <div className="stage-tag t1">
                <img src="/site/avatar-5.webp" alt="" />
                <span>
                  +$20.00 from Ada<small>Private · just now</small>
                </span>
              </div>
              <div className="stage-tag t2">
                <Mark id="base" className="lg" style={{ overflow: 'hidden' }} />
                <span>
                  Sent to Base<small>Arrives in about 2 min</small>
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="sec" id="card">
          <div className="wrap split">
            <div className="s-copy">
              <span className="ktag rv">Dollar card</span>
              <h2 className="rv d1">Spend your dollars anywhere online.</h2>
              <p className="lede rv d2">
                Verify your ID once and get a virtual dollar card. Top it up from your Kova balance
                in a tap, and move what’s left back whenever you like.
              </p>
              <ul className="checks rv d3">
                <li>
                  <span className="ck">
                    <svg aria-hidden="true" className="i">
                      <use href="#i-check" />
                    </svg>
                  </span>
                  Ready in minutes after one ID check
                </li>
                <li>
                  <span className="ck">
                    <svg aria-hidden="true" className="i">
                      <use href="#i-check" />
                    </svg>
                  </span>
                  Top up from Kova in a tap
                </li>
                <li>
                  <span className="ck">
                    <svg aria-hidden="true" className="i">
                      <use href="#i-check" />
                    </svg>
                  </span>
                  Freeze it, or withdraw to Kova, any time
                </li>
              </ul>
            </div>
            <div className="s-visual rv d1" data-par>
              <div className="ph">
                <img
                  src="/site/card.webp"
                  alt="The Kova dollar card: $144.02 ready to spend, with Top up, Withdraw, Details and Freeze"
                  loading="lazy"
                />
              </div>
              <img className="card-float" src="/site/card-coral.webp" alt="" loading="lazy" />
            </div>
          </div>
        </section>

        <section className="sec teal" id="send" style={{ paddingTop: '0' } as CSSProperties}>
          <div className="wrap split rev">
            <div className="s-copy">
              <span className="ktag rv">Send anywhere</span>
              <h2 className="rv d1">Paste any address. Kova finds the network.</h2>
              <p className="lede rv d2">
                Send to someone on Kova in about a second, free. Or send to Base, Solana, Ethereum
                and 16 other networks, and it arrives as USDC.
              </p>
              <ul className="checks rv d3">
                <li>
                  <span className="ck">
                    <svg aria-hidden="true" className="i">
                      <use href="#i-check" />
                    </svg>
                  </span>
                  Arrives in about 2 minutes
                </li>
                <li>
                  <span className="ck">
                    <svg aria-hidden="true" className="i">
                      <use href="#i-check" />
                    </svg>
                  </span>
                  No gas for you, or for them
                </li>
                <li>
                  <span className="ck">
                    <svg aria-hidden="true" className="i">
                      <use href="#i-check" />
                    </svg>
                  </span>
                  The delivery fee is shown before you send
                </li>
              </ul>
            </div>
            <div className="s-visual rv d1" data-par>
              <div className="ph">
                <img
                  src="/site/anywhere.webp"
                  alt="Paste their address: Kova lists the 19 networks it can send to"
                  loading="lazy"
                />
              </div>
              <span className="orbit o1">
                <Mark id="base" as="i" />
              </span>
              <span className="orbit o2">
                <Mark id="ethereum" as="i" style={{ animationDelay: '-2s' }} />
              </span>
              <span className="orbit o3">
                <Mark id="arbitrum" as="i" style={{ animationDelay: '-4s' }} />
              </span>
              <span className="orbit o4">
                <Mark id="solana" as="i" style={{ animationDelay: '-1s' }} />
              </span>
              <span className="orbit o5">
                <Mark id="polygon" as="i" style={{ animationDelay: '-3s' }} />
              </span>
              <span className="orbit o6">
                <Mark id="optimism" as="i" style={{ animationDelay: '-5s' }} />
              </span>
            </div>
          </div>
        </section>

        <section className="sec" id="more" style={{ paddingTop: '0' } as CSSProperties}>
          <div className="wrap gal-head">
            <div>
              <span className="ktag rv">Get to know Kova</span>
              <h2 className="rv d1">Made for how money really moves.</h2>
            </div>
          </div>
          <div className="rail" id="rail">
            <article
              className="gc"
              data-g="private"
              style={
                {
                  '--c': 'linear-gradient(165deg,#4A8E93 0%,#2D6468 100%)',
                  '--c-solid': '#2D6468',
                } as CSSProperties
              }
            >
              <div className="gc-txt">
                <span className="eb">
                  <svg aria-hidden="true" className="i">
                    <use href="#i-eye" />
                  </svg>
                  Private payments
                </span>
                <h3>Pay privately. Only they can see it.</h3>
              </div>
              <div className="vis">
                <div className="ph">
                  <img
                    src="/site/private.webp"
                    alt="Ada paid you privately, +$20.00"
                    loading="lazy"
                  />
                </div>
                <span
                  className="chipx"
                  style={
                    { left: '26px', top: '120px', transform: 'rotate(-6deg)' } as CSSProperties
                  }
                >
                  <span className="ci">
                    <svg aria-hidden="true" className="i">
                      <use href="#i-lock" />
                    </svg>
                  </span>
                  Sealed note
                </span>
                <span
                  className="stk"
                  style={{ width: '30px', right: '52px', top: '40px' } as CSSProperties}
                >
                  <img src="/site/sparkle-1.webp" alt="" />
                </span>
              </div>
              <button type="button" className="plus" aria-label="More about private payments">
                <svg aria-hidden="true" className="i">
                  <use href="#i-plus" />
                </svg>
              </button>
            </article>
            <article
              className="gc"
              data-g="offline"
              style={
                {
                  '--c': 'linear-gradient(165deg,#E07A6C 0%,#C2554A 100%)',
                  '--c-solid': '#C2554A',
                } as CSSProperties
              }
            >
              <div className="gc-txt">
                <span className="eb">
                  <svg aria-hidden="true" className="i">
                    <use href="#i-nosig" />
                  </svg>
                  Offline payments
                </span>
                <h3>No signal? You still get paid.</h3>
              </div>
              <div className="vis">
                <div className="ph">
                  <img
                    src="/site/offline.webp"
                    alt="Show Kemi this code: $0.25, waiting to settle"
                    loading="lazy"
                  />
                </div>
                <span
                  className="stk"
                  style={
                    {
                      width: '130px',
                      right: '8px',
                      top: '6px',
                      animationDelay: '-3s',
                    } as CSSProperties
                  }
                >
                  <img src="/site/plane.webp" alt="" />
                </span>
                <span
                  className="chipx"
                  style={
                    {
                      left: '22px',
                      top: '160px',
                      transform: 'rotate(5deg)',
                      animationDelay: '-2s',
                    } as CSSProperties
                  }
                >
                  <span className="ci">
                    <svg aria-hidden="true" className="i">
                      <use href="#i-nosig" />
                    </svg>
                  </span>
                  No signal needed
                </span>
              </div>
              <button type="button" className="plus" aria-label="More about offline payments">
                <svg aria-hidden="true" className="i">
                  <use href="#i-plus" />
                </svg>
              </button>
            </article>
            <article
              className="gc ink"
              data-g="agents"
              style={
                {
                  '--c': 'linear-gradient(165deg,#1C3236 0%,#0B1A1D 100%)',
                  '--c-solid': '#0B1A1D',
                } as CSSProperties
              }
            >
              <div className="gc-txt">
                <span className="eb">
                  <svg aria-hidden="true" className="i">
                    <use href="#i-bolt" />
                  </svg>
                  Limits on every key
                </span>
                <h3>Give an AI agent a budget, not your wallet.</h3>
              </div>
              <div className="vis">
                <div className="kw k1">
                  <div className="ky-top">
                    <span className="ic">
                      <svg aria-hidden="true" className="i">
                        <use href="#i-bolt" />
                      </svg>
                    </span>
                    <span>
                      <b>Claude</b>
                      <small>$13.60 left of $20 today</small>
                    </span>
                    <button
                      type="button"
                      className="sw"
                      aria-pressed="true"
                      aria-label="Claude’s key"
                    ></button>
                  </div>
                  <div className="bar">
                    <i style={{ '--w': '32%' } as CSSProperties}></i>
                  </div>
                </div>
                <div className="kw k2">
                  <div className="ky-top">
                    <span className="ic">
                      <svg aria-hidden="true" className="i">
                        <use href="#i-spark" />
                      </svg>
                    </span>
                    <span>
                      <b>Tolu’s allowance</b>
                      <small>$38 left of $50 this week</small>
                    </span>
                    <button
                      type="button"
                      className="sw"
                      aria-pressed="true"
                      aria-label="Tolu’s allowance"
                    ></button>
                  </div>
                  <div className="bar">
                    <i style={{ '--w': '24%' } as CSSProperties}></i>
                  </div>
                </div>
                <div className="kw k3">
                  <div className="ky-top">
                    <span className="ic">
                      <svg aria-hidden="true" className="i">
                        <use href="#i-users" />
                      </svg>
                    </span>
                    <span>
                      <b>Sam at the bakery</b>
                      <small>$122 left of $200 today</small>
                    </span>
                    <button
                      type="button"
                      className="sw"
                      aria-pressed="true"
                      aria-label="Sam’s key"
                    ></button>
                  </div>
                  <div className="bar">
                    <i style={{ '--w': '39%' } as CSSProperties}></i>
                  </div>
                </div>
                <span
                  className="stk"
                  style={
                    {
                      width: '74px',
                      right: '24px',
                      top: '-42px',
                      animationDelay: '-1s',
                    } as CSSProperties
                  }
                >
                  <img src="/site/kovi-key.webp" alt="" />
                </span>
              </div>
              <button type="button" className="plus" aria-label="More about limits on every key">
                <svg aria-hidden="true" className="i">
                  <use href="#i-plus" />
                </svg>
              </button>
            </article>
            <article
              className="gc light"
              data-g="stocks"
              style={
                {
                  '--c': 'linear-gradient(165deg,#F5D27A 0%,#EDB948 100%)',
                  '--c-solid': '#EDB948',
                } as CSSProperties
              }
            >
              <div className="gc-txt">
                <span className="eb">
                  <svg aria-hidden="true" className="i">
                    <use href="#i-chart" />
                  </svg>
                  Stocks
                </span>
                <h3>Own a slice of Tesla.</h3>
              </div>
              <div className="vis">
                <div className="sr s1">
                  <span className="tk" style={{ background: '#C8102E' } as CSSProperties}>
                    TSLA
                  </span>
                  <span>
                    <b>Tesla</b>
                    <small>TSLAx</small>
                  </span>
                  <span className="v">
                    1/20<small>of a share</small>
                  </span>
                </div>
                <div className="sr s2">
                  <span className="tk" style={{ background: '#4D8A22' } as CSSProperties}>
                    NVDA
                  </span>
                  <span>
                    <b>Nvidia</b>
                    <small>NVDAx</small>
                  </span>
                  <span className="v">
                    0.37<small>of a share</small>
                  </span>
                </div>
                <div className="sr s3">
                  <span className="tk" style={{ background: '#0B1A1D' } as CSSProperties}>
                    SPY
                  </span>
                  <span>
                    <b>S&amp;P 500</b>
                    <small>SPYx</small>
                  </span>
                  <span className="v">
                    1<small>share</small>
                  </span>
                </div>
                <span
                  className="stk"
                  style={
                    {
                      width: '104px',
                      right: '14px',
                      top: '-26px',
                      animationDelay: '-2s',
                    } as CSSProperties
                  }
                >
                  <img src="/site/coin-usd.webp" alt="" />
                </span>
              </div>
              <button type="button" className="plus" aria-label="More about stocks">
                <svg aria-hidden="true" className="i">
                  <use href="#i-plus" />
                </svg>
              </button>
            </article>
            <article
              className="gc light"
              data-g="cashout"
              style={
                {
                  '--c': 'linear-gradient(165deg,#B5E6CB 0%,#8DD3AE 100%)',
                  '--c-solid': '#8DD3AE',
                } as CSSProperties
              }
            >
              <div className="gc-txt">
                <span className="eb">
                  <svg aria-hidden="true" className="i">
                    <use href="#i-bank" />
                  </svg>
                  Cash out
                </span>
                <h3>Cash out to your bank, in your currency.</h3>
              </div>
              <div className="vis">
                <div className="orb">
                  <div className="ring" id="ring">
                    {ORBIT.map(([code, size, x, y]) => (
                      <img
                        key={code}
                        src={`/flags/${code}.svg`}
                        alt=""
                        style={
                          { '--s': `${size}px`, '--x': `${x}px`, '--y': `${y}px` } as CSSProperties
                        }
                      />
                    ))}
                  </div>
                  <div className="core">
                    <img src="/site/coin-ngn.webp" alt="" />
                  </div>
                </div>
              </div>
              <button type="button" className="plus" aria-label="More about cashing out">
                <svg aria-hidden="true" className="i">
                  <use href="#i-plus" />
                </svg>
              </button>
            </article>
            <article
              className="gc light"
              data-g="send"
              style={
                {
                  '--c': 'linear-gradient(165deg,#D9CAF7 0%,#BDA6EE 100%)',
                  '--c-solid': '#BDA6EE',
                } as CSSProperties
              }
            >
              <div className="gc-txt">
                <span className="eb">
                  <svg aria-hidden="true" className="i">
                    <use href="#i-send" />
                  </svg>
                  Send
                </span>
                <h3>Send to a friend in a second.</h3>
              </div>
              <div className="vis">
                <div className="ph">
                  <img
                    src="/site/send.webp"
                    alt="Send $20.00 to Tomás, fee $0.00, Kova covers it"
                    loading="lazy"
                  />
                </div>
                <span
                  className="stk"
                  style={
                    {
                      width: '150px',
                      left: '4px',
                      top: '8px',
                      animationDelay: '-4s',
                    } as CSSProperties
                  }
                >
                  <img src="/site/kovi-ride.webp" alt="" />
                </span>
              </div>
              <button type="button" className="plus" aria-label="More about sending">
                <svg aria-hidden="true" className="i">
                  <use href="#i-plus" />
                </svg>
              </button>
            </article>
          </div>
          <div className="wrap gal-foot">
            <div className="prog" aria-hidden="true">
              <i id="progBar"></i>
            </div>
            <div className="arrows">
              <button type="button" className="arr" id="prev" aria-label="Back">
                <svg aria-hidden="true" className="i">
                  <use href="#i-left" />
                </svg>
              </button>
              <button type="button" className="arr" id="next" aria-label="More">
                <svg aria-hidden="true" className="i">
                  <use href="#i-arrow" />
                </svg>
              </button>
            </div>
          </div>
          <dialog className="gd" id="gd" aria-labelledby="gdTitle">
            <div className="gd-in">
              <button type="button" className="gd-x" id="gdX" aria-label="Close">
                <svg aria-hidden="true" className="i">
                  <use href="#i-x" />
                </svg>
              </button>
              <span className="eb" id="gdEb"></span>
              <h3 id="gdTitle">Details</h3>
              <ul className="gd-pts" id="gdPts"></ul>
              <p className="gd-note" id="gdNote"></p>
            </div>
          </dialog>
        </section>

        <section className="sec" id="places" style={{ paddingTop: '20px' } as CSSProperties}>
          <div className="wrap center">
            <span className="ktag rv">Nearly everywhere</span>
            <h2 className="rv d1">Your dollars go where you go.</h2>
            <p className="lede rv d2">
              Cash out to banks and mobile money in local currency, or send dollars to 19 other
              networks.
            </p>
            <div className="tabs rv d3" role="tablist">
              <button
                type="button"
                className="tab"
                role="tab"
                aria-selected="true"
                data-pane="countries"
              >
                Cash out
              </button>
              <button
                type="button"
                className="tab"
                role="tab"
                aria-selected="false"
                data-pane="networks"
              >
                Send to networks
              </button>
            </div>
            <div className="places" id="countries">
              {PLACES.map(([code, name, how]) => (
                <div className="pc" key={code}>
                  <img src={`/flags/${code}.svg`} alt="" loading="lazy" />
                  <span>
                    {name}
                    <small>{how}</small>
                  </span>
                </div>
              ))}
            </div>
            <div className="places" id="networks" hidden>
              {NETWORKS.map(([id, name]) => (
                <div className="pc" key={id}>
                  <Mark id={id} className="lg" />
                  <span>
                    {name}
                    <small>As USDC</small>
                  </span>
                </div>
              ))}
              <div className="pc">
                <span className="lg" style={{ background: '#836EF9' }}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <use href="#i-monad" />
                  </svg>
                </span>
                <span>
                  Monad<small>Kova’s home</small>
                </span>
              </div>
            </div>
            <button type="button" className="more-btn" id="placesMore">
              <span>Show all 18</span>{' '}
              <svg aria-hidden="true" className="i">
                <use href="#i-chev" />
              </svg>
            </button>
            <p className="places-note" id="placesNote">
              Rates and any fees are shown before you confirm.
            </p>
          </div>
        </section>

        <section className="sec" id="security" style={{ paddingTop: '40px' } as CSSProperties}>
          <div className="wrap secu">
            <div className="secu-art rv">
              <span
                className="ring"
                style={{ width: '440px', height: '440px' } as CSSProperties}
              ></span>
              <span
                className="ring"
                style={
                  {
                    width: '330px',
                    height: '330px',
                    animationDirection: 'reverse',
                    animationDuration: '80s',
                  } as CSSProperties
                }
              ></span>
              <img
                className="spk"
                src="/site/sparkle-1.webp"
                alt=""
                style={{ left: '18%', top: '20%' } as CSSProperties}
              />
              <img
                className="spk"
                src="/site/sparkle-3.webp"
                alt=""
                style={{ right: '20%', top: '26%', width: '28px' } as CSSProperties}
              />
              <img
                className="spk"
                src="/site/sparkle-8.webp"
                alt=""
                style={{ right: '24%', bottom: '20%', width: '24px' } as CSSProperties}
              />
              <div className="kovi">
                <img src="/site/kovi-key.webp" alt="Kovi holding a key" loading="lazy" />
              </div>
            </div>
            <div>
              <span className="ktag rv">Security</span>
              <h2 className="rv d1">Only you can move your dollars.</h2>
              <p className="lede rv d2">
                Kova is a self-custody wallet. The key lives on your phone, and Kova’s servers never
                see it.
              </p>
              <ul className="grid-checks rv d3">
                <li>
                  <b>
                    <span className="ck">
                      <svg aria-hidden="true" className="i">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    Face ID, no seed phrase
                  </b>
                  <span>Your wallet opens with a passkey.</span>
                </li>
                <li>
                  <b>
                    <span className="ck">
                      <svg aria-hidden="true" className="i">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    Your own backup
                  </b>
                  <span>Write down 24 recovery words if you want them.</span>
                </li>
                <li>
                  <b>
                    <span className="ck">
                      <svg aria-hidden="true" className="i">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    Checked on Monad
                  </b>
                  <span>Nothing says Paid until it’s on the chain.</span>
                </li>
                <li>
                  <b>
                    <span className="ck">
                      <svg aria-hidden="true" className="i">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    Open source
                  </b>
                  <span>The app, the API and the contracts are public.</span>
                </li>
              </ul>
            </div>
          </div>
        </section>

        <section className="dark" id="business">
          <div className="sec">
            <div className="wrap">
              <div className="biz-top">
                <div>
                  <span className="ktag rv">Kova for business</span>
                  <h2 className="rv d1">Your phone is the card machine.</h2>
                  <p className="lede rv d2">
                    Customers tap, scan or pay a link. The money lands in your own wallet in about a
                    second, with no card fees and no waiting days to get paid.
                  </p>
                </div>
                <div className="ctas rv d2">
                  <a className="btn b-light" href="/wallet/shop?go=open">
                    Open a shop, free{' '}
                    <span className="o">
                      <svg aria-hidden="true" className="i">
                        <use href="#i-arrow" />
                      </svg>
                    </span>
                  </a>
                  <form action={signInDemo}>
                    <button type="submit" className="btn b-ghost">
                      Try the demo shop
                    </button>
                  </form>
                </div>
              </div>
              <div className="flow">
                <div className="fl rv">
                  <span className="num">01</span>
                  <h3>Ring it up</h3>
                  <div className="crop">
                    <img
                      src="/site/till-code.webp"
                      alt="Pay Ada’s Bakery: $3.75, with a code to scan"
                      loading="lazy"
                    />
                  </div>
                </div>
                <div className="fl rv d1">
                  <span className="num">02</span>
                  <h3>Paid in about a second</h3>
                  <div className="crop">
                    <img
                      src="/site/till-paid.webp"
                      alt="Paid! $3.75 for a cinnamon bun, card fees $0.00"
                      loading="lazy"
                    />
                  </div>
                </div>
                <div className="fl rv d2">
                  <span className="num">03</span>
                  <h3>See your day at a glance</h3>
                  <div className="crop">
                    <img
                      src="/site/shop-today.webp"
                      alt="Today: $33.75 taken from 6 sales, $0.00 in card fees"
                      loading="lazy"
                    />
                  </div>
                </div>
              </div>
              <div className="kbiz-cols">
                <div className="rv">
                  <svg aria-hidden="true" className="i">
                    <use href="#i-phone" />
                  </svg>
                  <b>Staff phones</b>
                  <span>Pair any phone with a code. It can only take payments.</span>
                </div>
                <div className="rv d1">
                  <svg aria-hidden="true" className="i">
                    <use href="#i-store" />
                  </svg>
                  <b>Your shop online</b>
                  <span>A menu with photos, table codes and stamp cards.</span>
                </div>
                <div className="rv d2">
                  <svg aria-hidden="true" className="i">
                    <use href="#i-users" />
                  </svg>
                  <b>Pay your team</b>
                  <span>Payroll and suppliers, straight from your takings.</span>
                </div>
                <div className="rv d3">
                  <svg aria-hidden="true" className="i">
                    <use href="#i-lock" />
                  </svg>
                  <b>Private takings</b>
                  <span>Your sales stay private. Share a view with your accountant.</span>
                </div>
              </div>

              <div className="devx" id="developers">
                <div>
                  <span className="ktag rv">For developers</span>
                  <h2 className="rv d1">One POST to charge. A signed webhook when it’s paid.</h2>
                  <p className="lede rv d2">
                    Retries are safe with an Idempotency-Key, every payment is matched on Monad, and
                    AI agents can pay over MCP within a limit you set.
                  </p>
                  <div
                    className="ctas rv d3"
                    style={
                      {
                        display: 'flex',
                        gap: '10px',
                        marginTop: '30px',
                        flexWrap: 'wrap',
                      } as CSSProperties
                    }
                  >
                    <a className="btn b-light" href="/wallet/shop?go=open">
                      Get API keys{' '}
                      <span className="o">
                        <svg aria-hidden="true" className="i">
                          <use href="#i-arrow" />
                        </svg>
                      </span>
                    </a>
                    <a className="btn b-ghost" href="https://github.com/Cybire1/kova">
                      GitHub
                    </a>
                  </div>
                </div>
                <div className="kcode rv d2">
                  <div className="code-top" role="tablist">
                    <button
                      type="button"
                      className="ct"
                      role="tab"
                      aria-selected="true"
                      data-code="0"
                    >
                      Charge
                    </button>
                    <button
                      type="button"
                      className="ct"
                      role="tab"
                      aria-selected="false"
                      data-code="1"
                    >
                      Webhook
                    </button>
                    <button
                      type="button"
                      className="ct"
                      role="tab"
                      aria-selected="false"
                      data-code="2"
                    >
                      AI agent
                    </button>
                  </div>
                  {CODE.map((html, i) => (
                    <pre
                      key={html.slice(0, 24)}
                      data-c={i}
                      hidden={i > 0}
                      // biome-ignore lint/security/noDangerouslySetInnerHtml: fixed, pre-coloured example code written in this file
                      dangerouslySetInnerHTML={{ __html: html }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="sec" id="faq">
          <div className="wrap faq">
            <div>
              <span className="ktag rv">Help</span>
              <h2 className="rv d1">Questions, answered.</h2>
              <div className="help rv d2">
                <img src="/site/kovi-catch.webp" alt="" />
                <div>
                  <b>Still stuck?</b>
                  <span>
                    Message us on <a href="https://x.com/kovafinance">X</a>. A person reads every
                    message.
                  </span>
                </div>
              </div>
            </div>
            <div className="rv d1">
              <details className="qa" open>
                <summary>
                  What is Kova?
                  <span className="pm">
                    <svg aria-hidden="true" className="i">
                      <use href="#i-plus" />
                    </svg>
                  </span>
                </summary>
                <p>
                  A dollar wallet for your phone. Hold dollars, pay shops, send to anyone, spend
                  with a dollar card and cash out to your bank. It runs on Monad, so payments land
                  in about a second.
                </p>
              </details>
              <details className="qa">
                <summary>
                  Where are my dollars kept?
                  <span className="pm">
                    <svg aria-hidden="true" className="i">
                      <use href="#i-plus" />
                    </svg>
                  </span>
                </summary>
                <p>
                  In your own wallet, as AUSD, a dollar stablecoin issued by Agora. Only your phone
                  can move them. Money you put on the dollar card is held by our card partner until
                  you spend it or move it back.
                </p>
              </details>
              <details className="qa">
                <summary>
                  What does it cost?
                  <span className="pm">
                    <svg aria-hidden="true" className="i">
                      <use href="#i-plus" />
                    </svg>
                  </span>
                </summary>
                <p>
                  Sending to another Kova wallet is free: Kova pays the network fee. Sending to
                  another network has a delivery fee, and cashing out may include a rate or fee.
                  Every cost is shown before you confirm.
                </p>
              </details>
              <details className="qa">
                <summary>
                  Where can I cash out?
                  <span className="pm">
                    <svg aria-hidden="true" className="i">
                      <use href="#i-plus" />
                    </svg>
                  </span>
                </summary>
                <p>
                  Banks and mobile money in 17 currencies, including the US, Canada, the UK, the
                  euro area, Nigeria, Ghana, Kenya, South Africa, the UAE, Australia, Singapore and
                  the Philippines.
                </p>
              </details>
              <details className="qa">
                <summary>
                  What if I lose my phone?
                  <span className="pm">
                    <svg aria-hidden="true" className="i">
                      <use href="#i-plus" />
                    </svg>
                  </span>
                </summary>
                <p>
                  Your passkey syncs with your Apple or Google account, so a new phone opens the
                  same wallet. You can also restore it with your 24 recovery words.
                </p>
              </details>
              <details className="qa">
                <summary>
                  Is Kova a bank?
                  <span className="pm">
                    <svg aria-hidden="true" className="i">
                      <use href="#i-plus" />
                    </svg>
                  </span>
                </summary>
                <p>
                  No. Kova is a self-custody wallet: the dollars stay yours and in your control.
                  Kova never lends them out.
                </p>
              </details>
            </div>
          </div>
        </section>

        <section className="cta" id="get">
          <div className="wrap">
            <h2 className="rv">
              <span className="soft">Get started.</span>
              <br />
              Download <img src="/site/kovi-cheer.webp" alt="" /> Kova.
            </h2>
            <div className="stores rv d2">
              <a className="kstore" href={iphone}>
                <svg aria-hidden="true" className="i">
                  <use href="#i-apple" />
                </svg>
                <span>
                  <small>Beta on TestFlight</small>
                  <b>iPhone</b>
                </span>
              </a>
              <a className="kstore" href="/android">
                <svg aria-hidden="true" className="i">
                  <use href="#i-android" />
                </svg>
                <span>
                  <small>Download the app</small>
                  <b>Android</b>
                </span>
              </a>
              <a className="kstore soft" href="/wallet">
                <svg aria-hidden="true" className="i">
                  <use href="#i-globe" />
                </svg>
                <span>
                  <small>No download</small>
                  <b>Web</b>
                </span>
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="kfoot">
        <div className="wrap">
          <div className="foot-g">
            <div className="foot-b">
              <a className="kbrand" href="#top">
                <svg role="img" aria-label="Kova home" width="32" height="32">
                  <use href="#i-logo" />
                </svg>
                <svg aria-hidden="true" width="52" height="21">
                  <use href="#i-word" />
                </svg>
              </a>
              <p>
                Dollars for every phone. A wallet that opens with Face ID, with a card, a shop and
                the world’s banks inside it.
              </p>
              <div className="soc">
                <a href="https://x.com/kovafinance">
                  <svg role="img" aria-label="Kova on X" className="i">
                    <use href="#i-x" />
                  </svg>
                </a>
                <a href="https://github.com/Cybire1/kova">
                  <svg role="img" aria-label="Kova on GitHub" className="i">
                    <use href="#i-gh" />
                  </svg>
                </a>
              </div>
            </div>
            <div>
              <h5>Personal</h5>
              <ul>
                <li>
                  <a href="#card">Dollar card</a>
                </li>
                <li>
                  <a href="#send">Send anywhere</a>
                </li>
                <li>
                  <a href="#places">Cash out</a>
                </li>
                <li>
                  <a href="#more">Stocks</a>
                </li>
                <li>
                  <a href="#more">Private payments</a>
                </li>
              </ul>
            </div>
            <div>
              <h5>Business</h5>
              <ul>
                <li>
                  <a href="/wallet/shop?go=open">Open a shop</a>
                </li>
                <li>
                  <a href="/try?ref=site">Demo shop</a>
                </li>
                <li>
                  <a href="/signin">Shop sign-in</a>
                </li>
              </ul>
            </div>
            <div>
              <h5>Developers</h5>
              <ul>
                <li>
                  <a href="#developers">Payments API</a>
                </li>
                <li>
                  <a href="#developers">AI agents</a>
                </li>
                <li>
                  <a href="https://github.com/Cybire1/kova">GitHub</a>
                </li>
                <li>
                  <a href="/stats">Kova, live</a>
                </li>
              </ul>
            </div>
            <div>
              <h5>Company</h5>
              <ul>
                <li>
                  <a href="#security">Security</a>
                </li>
                <li>
                  <a href="#faq">Help</a>
                </li>
                <li>
                  <a href="/privacy">Privacy</a>
                </li>
                <li>
                  <a href="/terms">Terms</a>
                </li>
              </ul>
            </div>
          </div>
          <div className="foot-bot">
            <span>© 2026 Kova</span>
            <span className="mon">
              <svg aria-hidden="true">
                <use href="#i-monad" />
              </svg>
              Built on Monad
            </span>
            <fieldset className="theme" aria-label="Theme">
              <button type="button" data-t="light" aria-pressed="false">
                <svg aria-hidden="true" className="i">
                  <use href="#i-sun" />
                </svg>
                Light
              </button>
              <button type="button" data-t="system" aria-pressed="true">
                <svg aria-hidden="true" className="i">
                  <use href="#i-auto" />
                </svg>
                Auto
              </button>
              <button type="button" data-t="dark" aria-pressed="false">
                <svg aria-hidden="true" className="i">
                  <use href="#i-moon" />
                </svg>
                Dark
              </button>
            </fieldset>
          </div>
          {mainnet ? null : (
            <p className="fine">
              Kova’s test network: test dollars only, nothing here is real money.
            </p>
          )}
          <p className="fine">
            Kova is a self-custody wallet, not a bank. Balances are held as AUSD, a dollar
            stablecoin issued by Agora, on the Monad network. The dollar card is provided by our
            card partner, and money on it is held by them. Tokenized stocks track the price of the
            underlying share and can lose value. Kova doesn’t give investment advice.
          </p>
        </div>
      </footer>
      <HomeMotion />
    </div>
  )
}
