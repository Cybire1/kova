'use client'

import { createPocketClient, getNetwork, type Pocket, type PocketInfo } from '@kova/monad'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { parseUnits } from 'viem'
import { ScreenHead } from './activity'
import { useWallet } from './provider'
import { CopyButton } from './ui'

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/ussd${path}`, {
    method,
    cache: 'no-store',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await response.json().catch(() => ({}))
  if (!response.ok)
    throw new Error(typeof json.error === 'string' ? json.error : 'Kova is unreachable.')
  return json as T
}

export function UssdScreen() {
  const { profile, network } = useWallet()
  return (
    <div className="w-screen">
      <ScreenHead title="Pay by USSD" back="/wallet/profile" />
      {profile ? (
        <PocketSettings key={`${network}:${profile.address}`} />
      ) : (
        <p>Open your Kova wallet to continue.</p>
      )}
    </div>
  )
}

function PocketSettings() {
  const { profile, network, signMessage, send, balance, refresh } = useWallet()
  const client = useMemo(() => createPocketClient(getNetwork(network).chainId, request), [network])
  const [info, setInfo] = useState<PocketInfo | null>(null)
  const [pocket, setPocket] = useState<Pocket | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [phone, setPhone] = useState('')
  const [pin, setPin] = useState('')
  const [cap, setCap] = useState('10')
  const [code, setCode] = useState('')
  const [amount, setAmount] = useState('2')
  const [review, setReview] = useState<string | null>(null)
  const working = useRef(false)
  const editingSetup = useRef(false)
  const alive = useRef(true)
  const wallet = profile!.address
  const load = useCallback(async () => {
    const status = await client.info()
    if (status.network !== network)
      throw new Error('This service is on a different network. Reopen Kova.')
    if (!alive.current) return
    setInfo(status)
    if (status.enabled || status.recovery) {
      const latest = await client.getPocket(wallet)
      if (alive.current && !editingSetup.current) setPocket(latest)
    }
  }, [client, network, wallet])
  useEffect(() => {
    alive.current = true
    const tick = () => {
      if (document.visibilityState === 'visible' && !working.current)
        void load().catch((e) => {
          if (alive.current)
            setError(e instanceof Error ? e.message : 'Couldn’t load USSD settings.')
        })
    }
    tick()
    const timer = setInterval(tick, 8000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      alive.current = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [load])
  const active = pocket?.status === 'active' ? pocket : null
  const pending = pocket?.status === 'pending' ? pocket : null
  const confirming = active?.spends.some((spend) => spend.status === 'pending') ?? false
  const pocketCap = active?.cap
  useEffect(() => {
    if (pocketCap) setCap(pocketCap)
  }, [pocketCap])

  const act = async (name: string, run: () => Promise<Pocket>) => {
    if (working.current) return
    working.current = true
    setBusy(name)
    setError(null)
    setNotice(null)
    try {
      const result = await run()
      editingSetup.current = false
      if (alive.current) setPocket(result)
      await refresh()
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : 'Couldn’t complete that request.')
    } finally {
      working.current = false
      if (alive.current) setBusy(null)
    }
  }

  return (
    <div className="w-ussd-body">
      <p className="w-lead">
        Set aside a small balance to pay by dialling a code. Your PIN approves USSD payments; your
        wallet approves setup and changes.
      </p>
      {network === 'testnet' ? (
        <aside className="w-ussd-test">
          <strong>Simulator test · test dollars only</strong>
          <p>
            Use the number registered in Africa’s Talking’s simulator. Verification messages arrive
            in its SMS inbox.
          </p>
        </aside>
      ) : null}
      {error ? (
        <p role="alert" className="w-keys-problem">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="w-ussd-notice">
          {notice}
        </p>
      ) : null}
      {!info ? <p>Checking USSD availability…</p> : null}
      {info && !info.enabled ? (
        <section className="w-keys">
          <h2 className="w-section">USSD payments are paused</h2>
          <p>Setup is not available on this network yet.</p>
        </section>
      ) : null}

      {info?.enabled && pocket?.status === 'none' ? (
        <form
          className="w-keyform"
          onSubmit={(e) => {
            e.preventDefault()
            void act('setup', async () => {
              const result = await client.setUpPocket(signMessage, wallet, { phone, pin, cap })
              setPin('')
              setNotice('Verification code requested. Check the simulator’s SMS inbox.')
              return result
            })
          }}
        >
          <h2 className="w-section">Link your number</h2>
          <label>
            <span>Phone number with country code</span>
            <input
              autoComplete="tel"
              type="tel"
              value={phone}
              placeholder="+2348012345678"
              onChange={(e) => setPhone(e.target.value)}
              required
            />
          </label>
          <label>
            <span>Choose a USSD PIN</span>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              minLength={4}
              maxLength={6}
              pattern="[0-9]{4,6}"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              required
            />
          </label>
          <label>
            <span>Daily spending limit in dollars</span>
            <input
              type="number"
              inputMode="decimal"
              min="0.01"
              max="200"
              step="0.01"
              value={cap}
              onChange={(e) => setCap(e.target.value)}
              required
            />
          </label>
          <button className="mini mini-ink" disabled={!!busy}>
            {busy === 'setup' ? 'Requesting code…' : 'Verify my number'}
          </button>
        </form>
      ) : null}

      {pending ? (
        <form
          className="w-keyform"
          onSubmit={(e) => {
            e.preventDefault()
            void act('verify', async () => {
              const result = await client.confirmCode(wallet, code)
              setCode('')
              setNotice('Number verified. Your USSD pocket is ready to fund.')
              return result
            })
          }}
        >
          <h2 className="w-section">Check the simulator’s SMS inbox</h2>
          <p>Enter the 6-digit code for {pending.phone}. It expires after 10 minutes.</p>
          <label>
            <span>Verification code</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </label>
          <button className="mini mini-ink" disabled={!!busy}>
            {busy === 'verify' ? 'Verifying…' : 'Confirm number'}
          </button>
          <button
            type="button"
            className="textlink"
            disabled={!!busy}
            onClick={() => {
              editingSetup.current = true
              setPocket({ status: 'none', dial: pending.dial })
            }}
          >
            Request a new code or change number
          </button>
          {pending.balance && parseUnits(pending.balance, 6) > 0n ? (
            <button
              type="button"
              className="mini"
              disabled={!!busy}
              onClick={() =>
                void act('recover', () => client.takeBack(signMessage, wallet, pending.balance!))
              }
            >
              Return existing pocket dollars
            </button>
          ) : null}
        </form>
      ) : null}

      {active ? (
        <>
          <section className="w-keys">
            <h2 className="w-section">Your USSD pocket</h2>
            <strong className="w-ussd-amount">${active.balance ?? '—'}</strong>
            <p>
              {active.phone} · ${active.left_today} left today · ${active.cap} daily limit
            </p>
            {active.locked_until ? (
              <p role="status">
                PIN locked until {new Date(active.locked_until).toLocaleTimeString()}. You can
                change your PIN or return your dollars below.
              </p>
            ) : null}
            <div className="w-ussd-dial">
              <code>{active.dial}</code>
              <CopyButton text={active.dial} />
            </div>
            {network === 'testnet' ? (
              <a
                href="https://simulator.africastalking.com:1517/"
                target="_blank"
                rel="noreferrer"
                className="textlink"
              >
                Open Africa’s Talking simulator ↗
              </a>
            ) : (
              <a href={`tel:${active.dial.replace('#', '%23')}`} className="textlink">
                Dial Kova
              </a>
            )}
          </section>

          <form
            className="w-keyform"
            onSubmit={(e) => {
              e.preventDefault()
              setReview(amount)
            }}
          >
            <h2 className="w-section">Add {network === 'testnet' ? 'test ' : ''}dollars</h2>
            <p>
              Wallet balance: {balance === null ? '—' : `$${(Number(balance) / 1e6).toFixed(2)}`}.
              Pocket dollars are held separately and controlled by Kova for USSD payments.
            </p>
            <label>
              <span>Amount in dollars</span>
              <input
                type="number"
                inputMode="decimal"
                min="0.01"
                max={active.cap}
                step="0.01"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value)
                  setReview(null)
                }}
                required
              />
            </label>
            <button className="mini mini-ink" disabled={!!busy || !info?.enabled}>
              Review transfer
            </button>
            {review ? (
              <div className="w-ussd-review" role="group" aria-label="Confirm pocket funding">
                <p>
                  Move <strong>${review}</strong> from your {network} wallet to your USSD pocket?
                </p>
                <button
                  type="button"
                  className="mini mini-ink"
                  disabled={!!busy}
                  onClick={() =>
                    void act('fund', async () => {
                      const value = parseUnits(review, 6)
                      if (value <= 0n || balance === null || value > balance)
                        throw new Error('Choose an amount covered by your wallet balance.')
                      if (active.balance === null)
                        throw new Error('Wait for your pocket balance to load.')
                      if (value + parseUnits(active.balance, 6) > parseUnits(active.cap, 6))
                        throw new Error(
                          'Keep your pocket balance within the daily limit you chose.',
                        )
                      try {
                        await send({ address: active.address, name: 'Your USSD pocket' }, value)
                      } finally {
                        setReview(null)
                      }
                      setNotice('Transfer confirmed. Your pocket balance updates automatically.')
                      return client.getPocket(wallet)
                    })
                  }
                >
                  {busy === 'fund' ? 'Moving dollars…' : 'Confirm transfer'}
                </button>
                <button
                  type="button"
                  className="textlink"
                  disabled={!!busy}
                  onClick={() => setReview(null)}
                >
                  Cancel
                </button>
              </div>
            ) : null}
            {network === 'testnet' ? <Link href="/wallet/add">Get free test dollars</Link> : null}
          </form>

          <section className="w-keys">
            <h2 className="w-section">Recent payments</h2>
            {active.spends.length ? (
              active.spends.map((spend) => (
                <div className="w-ussd-payment" key={spend.reference}>
                  <span>
                    <strong>
                      ${spend.amount} · {spend.to}
                    </strong>
                    <small>
                      {spend.reference} · {spend.status}
                    </small>
                  </span>
                  {spend.tx_hash ? (
                    <a
                      href={`${getNetwork(network).explorerUrl}/tx/${spend.tx_hash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Receipt ↗
                    </a>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="w-quiet">No USSD payments yet.</p>
            )}
          </section>
          <form
            className="w-keyform"
            onSubmit={(e) => {
              e.preventDefault()
              void act('limit', () => client.changePocket(signMessage, wallet, { cap }))
            }}
          >
            <h2 className="w-section">Change daily limit</h2>
            <label>
              <span>Dollars per day</span>
              <input
                type="number"
                min="0.01"
                max="200"
                step="0.01"
                value={cap}
                onChange={(e) => setCap(e.target.value)}
                required
              />
            </label>
            <button className="mini" disabled={!!busy}>
              Save limit
            </button>
          </form>
          <form
            className="w-keyform"
            onSubmit={(e) => {
              e.preventDefault()
              void act('pin', async () => {
                const result = await client.changePocket(signMessage, wallet, { pin })
                setPin('')
                setNotice('PIN changed.')
                return result
              })
            }}
          >
            <h2 className="w-section">Change PIN</h2>
            <label>
              <span>New PIN</span>
              <input
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                pattern="[0-9]{4,6}"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                required
              />
            </label>
            <button className="mini" disabled={!!busy}>
              Save PIN
            </button>
          </form>
          <section className="w-keys">
            <h2 className="w-section">Return pocket dollars</h2>
            <p>Your wallet approves this. You don’t need the USSD PIN.</p>
            <button
              type="button"
              className="mini"
              disabled={
                !!busy || confirming || !active.balance || parseUnits(active.balance, 6) === 0n
              }
              onClick={() =>
                void act('return', () => client.takeBack(signMessage, wallet, active.balance!))
              }
            >
              Return all dollars to my wallet
            </button>
            <button
              type="button"
              className="textlink"
              disabled={!!busy || confirming}
              onClick={() => void act('close', () => client.turnOff(signMessage, wallet))}
            >
              Return dollars and turn off USSD
            </button>
            {confirming ? (
              <p>
                A payment is still confirming. Its dollars stay reserved until the result is known.
              </p>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  )
}
