import type { Metadata } from 'next'
import type { CSSProperties } from 'react'
import { HomeMotion } from '@/components/home-motion'
import { Mark, SiteFooter, SiteNav, SiteSprite } from '@/components/site'
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

/** The pinned sentence after the hero: each word lights as you scroll; *starred* phrases in coral. */
const STATEMENT =
  'Kova is a dollar wallet that opens with *Face ID.* Spend with a *dollar card,* send to *20 networks* and cash out in *35+ countries.* Kova pays the gas.'
    .split(/(\*[^*]+\*)/)
    .filter(Boolean)
    .flatMap((part) =>
      // A starred phrase stays whole, so it lights at once and never breaks across lines.
      part.startsWith('*')
        ? [{ word: part.replace(/\*/g, ''), lit: true }]
        : part
            .split(' ')
            .filter(Boolean)
            .map((word) => ({ word, lit: false })),
    )

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

/** The developer section's three examples, already coloured. */
const CODE = [
  '<span class="m">$</span> curl <span class="s">$KOVA_API/v1/payment_intents</span> \\\n    -H <span class="s">"Authorization: Bearer $KOVA_SECRET_KEY"</span> \\\n    -H <span class="s">"Idempotency-Key: order-1042"</span> \\\n    -d <span class="s">\'{"amount":"12.50","reference":"Order 1042"}\'</span>\n\n{\n  <span class="k">"id"</span>: <span class="s">"pi_06gd1ajtn5yr71g1tdwpvk9fqm"</span>,\n  <span class="k">"amount"</span>: <span class="s">"12.50"</span>,\n  <span class="k">"status"</span>: <span class="s">"requires_payment"</span>\n}',
  '<span class="m">// About a second later, to your endpoint</span>\n<span class="k">Kova-Signature</span>: t=1790208020,v1=9e56\u2026\n\n{\n  <span class="k">"type"</span>: <span class="g">"payment_intent.paid"</span>,\n  <span class="k">"data"</span>: {\n    <span class="k">"id"</span>: <span class="s">"pi_06gd1ajtn5yr71g1tdwpvk9fqm"</span>,\n    <span class="k">"amount"</span>: <span class="s">"12.50"</span>,\n    <span class="k">"reference"</span>: <span class="s">"Order 1042"</span>\n  }\n}',
  '<span class="m">// Give the agent a key with a daily limit,</span>\n<span class="m">// then add Kova\'s MCP server</span>\n{\n  <span class="k">"mcpServers"</span>: {\n    <span class="k">"kova"</span>: {\n      <span class="k">"url"</span>: <span class="s">"$KOVA_API/mcp"</span>,\n      <span class="k">"headers"</span>: { <span class="k">"Authorization"</span>: <span class="s">"Bearer $KOVA_AGENT_KEY"</span> }\n    }\n  }\n}\n<span class="m">// kova_status \u00b7 kova_pay \u00b7 kova_pay_charge \u00b7 kova_history</span>',
] as const

export default async function Home() {
  const signedIn = Boolean(await getSession())
  const mainnet = network === 'mainnet'
  // One waitlist: the test network's site sends people to mykova.app's.
  const iphone = mainnet ? '/waitlist' : 'https://mykova.app/waitlist'
  const login = signedIn ? 'Open Kova' : 'Log in'
  return (
    <div className="kl" id="kl">
      <SiteSprite />

      <SiteNav login={login} />

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
                <img className="lt" src="/site/card.webp" alt="The dollar card screen" />
                <img
                  className="dk"
                  src="/site/receive-dark.webp"
                  alt="Get paid: Kova's code to scan"
                />
              </div>
              <div className="kdev c">
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
              <div className="kdev r">
                <img
                  className="lt"
                  src="/site/anywhere.webp"
                  alt="Send to another network: paste their address"
                />
                <img
                  className="dk"
                  src="/site/private.webp"
                  alt="Ada paid you privately, +$20.00"
                />
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

        <section className="stmt" id="stmt" aria-label="Kova in one sentence">
          <div className="stmt-in">
            <p className="stmt-text" style={{ '--n': STATEMENT.length } as CSSProperties}>
              {STATEMENT.map(({ word, lit }, i) => (
                <span
                  key={`${i}-${word}`}
                  className={lit ? 'stw lit' : 'stw'}
                  style={{ '--i': i } as CSSProperties}
                >
                  {word}{' '}
                </span>
              ))}
            </p>
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
                  className="lt"
                  src="/site/card.webp"
                  alt="The Kova dollar card: $144.02 ready to spend, with Top up, Withdraw, Details and Freeze"
                  loading="lazy"
                />
                <img
                  className="dk"
                  src="/site/card-dark.webp"
                  alt="The Kova dollar card in dark mode: $144.02 ready to spend"
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
            <div className="stats">
              <div>
                <b data-count="35" data-suffix="+">
                  35+
                </b>
                <span>countries to cash out to</span>
              </div>
              <div>
                <b data-count="17">17</b>
                <span>local currencies</span>
              </div>
              <div>
                <b data-count="20">20</b>
                <span>networks to send to</span>
              </div>
            </div>
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
              {PLACES.map(([code, name, how], i) => (
                <div className="pc" key={code} style={{ '--i': i } as CSSProperties}>
                  <img src={`/flags/${code}.svg`} alt="" loading="lazy" />
                  <span>
                    {name}
                    <small>{how}</small>
                  </span>
                </div>
              ))}
            </div>
            <div className="places" id="networks" hidden>
              {NETWORKS.map(([id, name], i) => (
                <div className="pc" key={id} style={{ '--i': i } as CSSProperties}>
                  <Mark id={id} className="lg" />
                  <span>
                    {name}
                    <small>As USDC</small>
                  </span>
                </div>
              ))}
              <div className="pc" style={{ '--i': NETWORKS.length } as CSSProperties}>
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
          <div className="spot" aria-hidden="true" />
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

      <SiteFooter mainnet={mainnet} />
      <HomeMotion />
    </div>
  )
}
