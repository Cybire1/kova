'use client'

import { explorerTxUrl, type NetworkId, networks } from '@kova/monad'
import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react'
import { type Address, encodeFunctionData, erc20Abi, type Hex } from 'viem'

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>
  on?(event: string, listener: (...args: unknown[]) => void): void
  removeListener?(event: string, listener: (...args: unknown[]) => void): void
}

type Phase = { state: 'idle' } | { state: 'busy' } | { state: 'error'; message: string }

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

/** What a wallet's refusal means, in words. 4001 is the person saying no. */
function why(error: unknown): string {
  const e = error as { code?: number; message?: string }
  if (e?.code === 4001) return 'You said no. Nothing moved.'
  return e?.message || 'That didn’t go through. Nothing moved.'
}

/**
 * The live part of mykova.app/chrome: it finds Kova for Chrome the way any site would (EIP-6963,
 * rdns app.mykova), then connects (the site sees the address, nothing more), asks for a 10¢ tip
 * (the first payment, so Kova asks for a budget), and links to a 1¢ article paid by x402.
 */
export function TryChrome({
  network,
  ausd,
  payTo,
  tip,
}: {
  network: NetworkId
  ausd: Address
  payTo: Address | null
  /** Base units. */
  tip: string
}) {
  const [kova, setKova] = useState<Eip1193 | null | undefined>(undefined)
  const [account, setAccount] = useState<Address | null>(null)
  const [connect, setConnect] = useState<Phase>({ state: 'idle' })
  const [pay, setPay] = useState<Phase>({ state: 'idle' })
  const [paid, setPaid] = useState<Hex | null>(null)
  // Back from the paid article (it links here with ?read=1): the third step is done.
  const [read, setRead] = useState(false)
  const found = useRef<Eip1193 | null>(null)

  useEffect(() => {
    setRead(new URLSearchParams(window.location.search).has('read'))
  }, [])

  useEffect(() => {
    const announce = (event: Event) => {
      const detail = (event as CustomEvent<{ info?: { rdns?: string }; provider?: Eip1193 }>).detail
      if (detail?.info?.rdns === 'app.mykova' && detail.provider) {
        found.current = detail.provider
        setKova(detail.provider)
      }
    }
    window.addEventListener('eip6963:announceProvider', announce)
    window.dispatchEvent(new Event('eip6963:requestProvider'))
    const settle = window.setTimeout(() => {
      if (!found.current) setKova(null)
    }, 700)
    return () => {
      window.removeEventListener('eip6963:announceProvider', announce)
      window.clearTimeout(settle)
    }
  }, [])

  // Already connected from an earlier visit, and any change Kova for Chrome reports.
  useEffect(() => {
    if (!kova) return
    const changed = (...args: unknown[]) => {
      const list = args[0] as string[] | undefined
      setAccount((list?.[0] as Address | undefined) ?? null)
    }
    kova
      .request({ method: 'eth_accounts' })
      .then((list) => changed(list))
      .catch(() => {})
    kova.on?.('accountsChanged', changed)
    return () => kova.removeListener?.('accountsChanged', changed)
  }, [kova])

  const doConnect = useCallback(async () => {
    if (!kova) return
    setConnect({ state: 'busy' })
    try {
      const list = (await kova.request({ method: 'eth_requestAccounts' })) as string[]
      setAccount((list[0] as Address | undefined) ?? null)
      setConnect({ state: 'idle' })
    } catch (error) {
      setConnect({ state: 'error', message: why(error) })
    }
  }, [kova])

  const doTip = useCallback(async () => {
    if (!kova || !account || !payTo) return
    setPay({ state: 'busy' })
    try {
      const hash = (await kova.request({
        method: 'eth_sendTransaction',
        params: [
          {
            from: account,
            to: ausd,
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: 'transfer',
              args: [payTo, BigInt(tip)],
            }),
          },
        ],
      })) as Hex
      setPaid(hash)
      setPay({ state: 'idle' })
    } catch (error) {
      setPay({ state: 'error', message: why(error) })
    }
  }, [kova, account, payTo, ausd, tip])

  const off = !payTo
  const done = [account, paid, read].filter(Boolean).length
  return (
    <div className="ch-live">
      <div className={`ch-status ${kova ? 'on' : kova === null ? 'off' : ''}`} aria-live="polite">
        <span className="dot" />
        {kova === undefined
          ? 'Looking for Kova for Chrome…'
          : kova
            ? account
              ? `Kova for Chrome is connected · ${short(account)}`
              : 'Kova for Chrome is on in this browser'
            : 'Kova for Chrome isn’t in this browser yet.'}
        {kova === null ? (
          <a href="#get" className="ch-status-link">
            Get it
          </a>
        ) : null}
      </div>

      <div className="ch-progress" aria-live="polite">
        <span className="ch-rail" style={{ '--p': done / 3 } as CSSProperties}>
          <i />
        </span>
        <small>
          {done === 3 ? 'All three done. That’s Kova for Chrome.' : `${done} of 3 done`}
        </small>
      </div>

      <ol className="ch-steps">
        <li className={account ? 'done' : ''}>
          <span className="num">01</span>
          <h3>Connect</h3>
          <p>This site sees your address and balance, like any site you connect. It can’t spend.</p>
          <div className="ch-act">
            {account ? (
              <span className="ch-ok">Connected</span>
            ) : (
              <button
                type="button"
                className="btn b-ink ch-btn"
                disabled={!kova || connect.state === 'busy'}
                onClick={() => void doConnect()}
              >
                {connect.state === 'busy' ? 'Waiting for Kova…' : 'Connect Kova'}
              </button>
            )}
          </div>
          {connect.state === 'error' ? <p className="ch-err">{connect.message}</p> : null}
        </li>

        <li className={paid ? 'done' : ''}>
          <span className="num">02</span>
          <h3>Send a 10¢ tip</h3>
          <p>
            The first time a site asks to be paid, Kova asks you for its budget. Pick one, approve
            it once, and the tip goes.
          </p>
          <div className="ch-act">
            {paid ? (
              <a
                className="ch-ok"
                href={explorerTxUrl(networks[network], paid)}
                target="_blank"
                rel="noopener"
              >
                Paid 10¢ · See it on Monad
              </a>
            ) : (
              <button
                type="button"
                className="btn b-ink ch-btn"
                disabled={!account || off || pay.state === 'busy'}
                onClick={() => void doTip()}
              >
                {pay.state === 'busy' ? 'Waiting for Kova…' : 'Send 10¢'}
              </button>
            )}
          </div>
          {pay.state === 'error' ? <p className="ch-err">{pay.message}</p> : null}
        </li>

        <li className={read ? 'done' : ''}>
          <span className="num">03</span>
          <h3>Read a 1¢ article</h3>
          <p>
            The page answers “402 Payment Required”. Kova pays the cent from this site’s budget and
            the article opens. No checkout.
          </p>
          <div className="ch-act">
            {read ? (
              <a className="ch-ok" href="/chrome/article">
                Paid 1¢ · Read it again
              </a>
            ) : off ? (
              <button type="button" className="btn b-ink ch-btn" disabled>
                Open the article
              </button>
            ) : (
              <a className="btn b-ink ch-btn" href="/chrome/article">
                Open the article
              </a>
            )}
          </div>
        </li>
      </ol>
      {off ? (
        <p className="ch-fine">The demo’s payments aren’t switched on on this server yet.</p>
      ) : (
        <p className="ch-fine">
          Both go to Kova, from your Kova dollars on Monad. Nothing moves until you say yes.
        </p>
      )}
    </div>
  )
}
