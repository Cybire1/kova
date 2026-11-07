import type { CSSProperties } from 'react'
import { chainLogoXml } from '@/lib/chain-logos'

/*
 * The public site's shared pieces (home, Android): the icon set, the floating nav with its menus
 * and phone sheet, and the footer. Styles in styles/home.css, under .kl; components/home-motion.tsx
 * wires up the menus, the phone sheet and the theme buttons.
 */

/** The page's line icons, drawn once and used by id. */
const SPRITE =
  '<defs>\n  <symbol id="i-arrow" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></symbol>\n  <symbol id="i-left" viewBox="0 0 24 24"><path d="M19 12H5M11 6l-6 6 6 6"/></symbol>\n  <symbol id="i-chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></symbol>\n  <symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>\n  <symbol id="i-check" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></symbol>\n  <symbol id="i-wallet" viewBox="0 0 24 24"><path d="M3.5 8A2.5 2.5 0 0 1 6 5.5h11.5V8"/><rect x="3.5" y="8" width="17" height="11" rx="2.5"/><path d="M16 13.5h.01"/></symbol>\n  <symbol id="i-card" viewBox="0 0 24 24"><rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h3"/></symbol>\n  <symbol id="i-send" viewBox="0 0 24 24"><path d="M20.5 3.5 10 14"/><path d="m20.5 3.5-6 17-4.5-6.5-6.5-4.5z"/></symbol>\n  <symbol id="i-bank" viewBox="0 0 24 24"><path d="M3.5 9.5 12 4l8.5 5.5M5.5 10v7.5M10 10v7.5M14 10v7.5M18.5 10v7.5M3.5 20h17"/></symbol>\n  <symbol id="i-chart" viewBox="0 0 24 24"><path d="M4 4v16h16"/><path d="m8 14 3.5-3.5 3 3L19 9"/></symbol>\n  <symbol id="i-eye" viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A9.8 9.8 0 0 1 12 5c5 0 8.5 4.5 9.5 7a13 13 0 0 1-2.4 3.6M6.6 6.6C4.5 8 3.1 10.1 2.5 12c1 2.5 4.5 7 9.5 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></symbol>\n  <symbol id="i-nosig" viewBox="0 0 24 24"><path d="M3 20h.01M7.5 20v-4M12 20v-8M16.5 20V8M21 4v16"/><path d="M3 3l18 18"/></symbol>\n  <symbol id="i-key" viewBox="0 0 24 24"><circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8.7-8.7M17 6l2.5 2.5M14.5 8.5l2 2"/></symbol>\n  <symbol id="i-bolt" viewBox="0 0 24 24"><path d="M13 2.5 4.5 14H11l-1 7.5L18.5 10H12z"/></symbol>\n  <symbol id="i-spark" viewBox="0 0 24 24"><path d="M12 3.5l1.7 5 5 1.7-5 1.7-1.7 5-1.7-5-5-1.7 5-1.7z"/></symbol>\n  <symbol id="i-users" viewBox="0 0 24 24"><circle cx="9" cy="8.5" r="3.5"/><path d="M3 19.5a6 6 0 0 1 12 0M16 5a3.5 3.5 0 0 1 0 7M18.5 14.5a6 6 0 0 1 2.5 5"/></symbol>\n  <symbol id="i-phone" viewBox="0 0 24 24"><rect x="6.5" y="3" width="11" height="18" rx="3"/><path d="M11 18h2"/></symbol>\n  <symbol id="i-store" viewBox="0 0 24 24"><path d="M4.5 10v9.5h15V10M3.5 4.5h17L19 9.5a2.3 2.3 0 0 1-4.4.4 2.3 2.3 0 0 1-4.2 0A2.3 2.3 0 0 1 6 9.5z"/></symbol>\n  <symbol id="i-lock" viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></symbol>\n  <symbol id="i-code" viewBox="0 0 24 24"><path d="m8 7-5 5 5 5M16 7l5 5-5 5"/></symbol>\n  <symbol id="i-hook" viewBox="0 0 24 24"><path d="M4 12h3l2.5-6 5 12 2.5-6h3"/></symbol>\n  <symbol id="i-gh" viewBox="0 0 24 24"><path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/></symbol>\n  <symbol id="i-x" viewBox="0 0 24 24"><path d="M4.5 4.5l15 15M19.5 4.5l-15 15"/></symbol>\n  <symbol id="i-apple" viewBox="0 0 24 24"><path d="M15.5 3.5c-.9.1-2 .7-2.6 1.5-.6.7-1 1.7-.9 2.6 1 .1 2-.5 2.6-1.3.6-.8 1-1.8.9-2.8zM12 8.3c-1 0-2.2-.8-3.4-.8-1.8 0-3.6 1.5-3.6 4.4 0 3.6 2.5 8.1 4.4 8.1.9 0 1.5-.6 2.6-.6s1.6.6 2.6.6c1.6 0 3.1-3 3.6-4.6-1.6-.7-2.5-2.1-2.5-3.7 0-1.4.8-2.6 2-3.3-.8-1.1-2-1.6-3.1-1.6-1.2 0-2 .8-2.6.8z"/></symbol>\n  <symbol id="i-android" viewBox="0 0 24 24"><path d="M5.5 10.5a6.5 6.5 0 0 1 13 0v6.5h-13z"/><path d="M8 5 6.5 3M16 5l1.5-2M9.5 8.5h.01M14.5 8.5h.01M8.5 17v3.5M15.5 17v3.5"/></symbol>\n  <symbol id="i-globe" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5a13 13 0 0 1 0 17M12 3.5a13 13 0 0 0 0 17"/></symbol>\n  <symbol id="i-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></symbol>\n  <symbol id="i-moon" viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></symbol>\n  <symbol id="i-auto" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor"/></symbol>\n  <symbol id="i-xlogo" viewBox="0 0 24 24"><path fill="currentColor" stroke="none" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></symbol>\n  <symbol id="i-monad" viewBox="0 0 24 24"><path fill="#836EF9" d="M24 0H0v24h24z"/><path fill="#fff" d="M12 4c-2.31 0-8 5.69-8 8s5.69 8 8 8 8-5.69 8-8-5.69-8-8-8m-1.247 12.575c-.974-.266-3.593-4.847-3.328-5.822s4.848-3.593 5.822-3.328 3.593 4.847 3.328 5.822-4.847 3.593-5.822 3.328"/></symbol>\n  <symbol id="i-logo" viewBox="0 0 200 200"><path d="M62 46 V154" stroke="var(--ink)" stroke-width="19" stroke-linecap="round" fill="none"/><path d="M92.6 74.3 A40 40 0 0 1 92.6 125.7 M115.6 55 A70 70 0 0 1 115.6 145 M138.6 35.7 A100 100 0 0 1 138.6 164.3" stroke="var(--coral)" stroke-width="17" stroke-linecap="round" fill="none"/></symbol>\n  <symbol id="i-word" viewBox="0 0 252 100"><g stroke="var(--ink)" stroke-width="15.5" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M8 8 V92M12 70 L40 38M26 56 L44 92M130 40 L150 92 L170 40M238 40 V92"/><circle cx="212" cy="66" r="26"/></g><circle cx="86" cy="65" r="27" fill="#EBB3AA" stroke="var(--ink)" stroke-width="15.5"/></symbol>\n</defs>'

/** The icon set, once per page; everything else uses its symbols by id. */
export function SiteSprite() {
  return (
    <svg
      width="0"
      height="0"
      style={{ position: 'absolute' }}
      aria-hidden="true"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: the page's own fixed icon set, no input in it
      dangerouslySetInnerHTML={{ __html: SPRITE }}
    />
  )
}

/** The floating nav, its Personal, Business and Developers menus, and the phone sheet. */
export function SiteNav({ login }: { login: string }) {
  return (
    <>
      <div className="kprog" aria-hidden="true" />
      <header className="nav" id="nav">
        <div className="nav-in">
          <a className="kbrand" href="/">
            <svg role="img" aria-label="Kova home" width="32" height="32">
              <use href="#i-logo" />
            </svg>
            <svg aria-hidden="true" width="52" height="21">
              <use href="#i-word" />
            </svg>
          </a>
          <nav className="kpill" aria-label="Main">
            <span className="pl-ind" aria-hidden="true" />
            <div>
              <button type="button" className="pl" aria-expanded="false" data-drop="dp">
                Personal{' '}
                <svg aria-hidden="true" className="i chev">
                  <use href="#i-chev" />
                </svg>
              </button>
              <div className="drop d-personal" id="dp">
                <a className="mi" href="/#card">
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
                <a className="mi" href="/#send">
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
                <a className="feat" href="/#card">
                  <small>New</small>
                  <b>The Kova dollar card</b>
                  <p>Verify once and spend online.</p>
                  <img src="/site/card-coral.webp" alt="" />
                </a>
                <a className="mi" href="/#places">
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
                <a className="mi" href="/#more">
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
                <a className="mi" href="/#more">
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
                <a className="mi" href="/#more">
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
                <a className="mi" href="/#more">
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
                <a className="mi" href="/#more">
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
                <a className="mi" href="/#business">
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
                <a className="feat dark" href="/#business">
                  <small>Free to start</small>
                  <b>Open a shop in a minute</b>
                  <p>No card machine, no card fees.</p>
                  <img src="/site/badge-shop.webp" alt="" />
                </a>
                <a className="mi" href="/#business">
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
                <a className="mi" href="/#business">
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
                <a className="mi" href="/#business">
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
                <a className="mi" href="/#developers">
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
                <a className="mi" href="/#developers">
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
                <a className="mi" href="/#developers">
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
              <a className="pl" href="/#faq">
                Help
              </a>
            </div>
          </nav>
          <div className="nav-r">
            <a className="login" href="/wallet">
              {login}
            </a>
            <a className="btn b-ink b-sm" href="/#get">
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
          <a className="big" href="/#card" data-close>
            Dollar card{' '}
            <svg aria-hidden="true" className="i">
              <use href="#i-arrow" />
            </svg>
          </a>
          <a className="big" href="/#send" data-close>
            Send anywhere{' '}
            <svg aria-hidden="true" className="i">
              <use href="#i-arrow" />
            </svg>
          </a>
          <a className="big" href="/#more" data-close>
            Everything else{' '}
            <svg aria-hidden="true" className="i">
              <use href="#i-arrow" />
            </svg>
          </a>
          <a className="big" href="/#business" data-close>
            Business{' '}
            <svg aria-hidden="true" className="i">
              <use href="#i-arrow" />
            </svg>
          </a>
          <a className="big" href="/#developers" data-close>
            Developers{' '}
            <svg aria-hidden="true" className="i">
              <use href="#i-arrow" />
            </svg>
          </a>
          <a className="big" href="/#faq" data-close>
            Help{' '}
            <svg aria-hidden="true" className="i">
              <use href="#i-arrow" />
            </svg>
          </a>
        </nav>
        <div className="sheet-b">
          <a className="btn b-ink" href="/#get" data-close>
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
    </>
  )
}

/** The footer, with Light, Auto and Dark. */
export function SiteFooter({ mainnet }: { mainnet: boolean }) {
  return (
    <footer className="kfoot">
      <div className="wrap">
        <div className="foot-g">
          <div className="foot-b">
            <a className="kbrand" href="/">
              <svg role="img" aria-label="Kova home" width="32" height="32">
                <use href="#i-logo" />
              </svg>
              <svg aria-hidden="true" width="52" height="21">
                <use href="#i-word" />
              </svg>
            </a>
            <p>
              Dollars for every phone. A wallet that opens with Face ID, with a card, a shop and the
              world’s banks inside it.
            </p>
            <div className="soc">
              <a href="https://x.com/kovafinance">
                <svg role="img" aria-label="Kova on X" className="i">
                  <use href="#i-xlogo" />
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
                <a href="/#card">Dollar card</a>
              </li>
              <li>
                <a href="/#send">Send anywhere</a>
              </li>
              <li>
                <a href="/#places">Cash out</a>
              </li>
              <li>
                <a href="/#more">Stocks</a>
              </li>
              <li>
                <a href="/#more">Private payments</a>
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
                <a href="/#developers">Payments API</a>
              </li>
              <li>
                <a href="/#developers">AI agents</a>
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
                <a href="/#security">Security</a>
              </li>
              <li>
                <a href="/#faq">Help</a>
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
          Kova is a self-custody wallet, not a bank. Balances are held as AUSD, a dollar stablecoin
          issued by Agora, on the Monad network. The dollar card is provided by our card partner,
          and money on it is held by them. Tokenized stocks track the price of the underlying share
          and can lose value. Kova doesn’t give investment advice.
        </p>
      </div>
    </footer>
  )
}

/** A network's mark, from the fixed SVGs in lib/chain-logos.ts. */
export function Mark({
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
