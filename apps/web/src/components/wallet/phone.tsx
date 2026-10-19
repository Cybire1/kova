'use client'

import { getNetwork, type PhonePayment, type PhoneResolution, phoneInput } from '@kova/monad'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { parseUnits } from 'viem'
import { newLinkKey, settleLinkKey } from '@/lib/wallet/dollar-links'
import { formatUsd } from '@/lib/wallet/money'
import { phoneClient } from '@/lib/wallet/phone'
import { ScreenHead } from './activity'
import { useWallet } from './provider'
import { SlideToSend } from './send'
import { CopyButton } from './ui'

export function PhoneSend() {
  const params = useSearchParams()
  const router = useRouter()
  const { profile, network, signMessage, send, fundLink, balance } = useWallet()
  const client = useMemo(() => phoneClient(getNetwork(network).chainId), [network])
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [phone, setPhone] = useState(params.get('phone') ?? '')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [target, setTarget] = useState<(PhoneResolution & { phone: string }) | null>(null)
  const [pending, setPending] = useState<PhonePayment | null>(null)
  const [busy, setBusy] = useState(false)
  const working = useRef(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void client
      .info()
      .then((i) => {
        if (live) setEnabled(i.enabled && i.network === network)
      })
      .catch(() => {
        if (live) setEnabled(false)
      })
    return () => {
      live = false
    }
  }, [client, network])
  const value = /^\d{1,3}(\.\d{1,2})?$/.test(amount) ? parseUnits(amount, 6) : 0n
  const valid = value >= 10_000n && value <= 200_000_000n && balance !== null && value <= balance
  async function review() {
    if (!profile || working.current) return
    const normalized = phoneInput(phone)
    if (!normalized) return setError('Include the country code, for example +2348012345678.')
    if (!valid)
      return setError('Choose an amount from $0.01 to $200 covered by your wallet balance.')
    working.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await client.resolve(signMessage, profile.address, normalized)
      if (result.address?.toLowerCase() === profile.address.toLowerCase())
        throw new Error('That number is linked to your own Kova wallet.')
      setTarget({ phone: normalized, ...result })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t check this number.')
    } finally {
      working.current = false
      setBusy(false)
    }
  }
  async function pay() {
    if (!profile || !target || working.current || !valid) return
    working.current = true
    setBusy(true)
    setError(null)
    try {
      if (target.address) {
        // Re-check the verified mapping immediately before signing the actual transfer.
        const fresh = await client.resolve(signMessage, profile.address, target.phone)
        if (
          fresh.address?.toLowerCase() !== target.address.toLowerCase() ||
          fresh.destination !== target.destination
        )
          throw new Error('The recipient changed. Go back and check the number again.')
        const done = await send({ address: target.address, name: target.phone }, value, note, {
          privately: false,
        })
        router.replace(`/wallet/activity/${done.hash}`)
        return
      }
      const kept = newLinkKey(value, note.trim() || null, network)
      const reserved = await client.reserve(
        signMessage,
        profile.address,
        {
          phone: target.phone,
          address: kept.address,
          amount,
          name: profile.name,
          note: note.trim(),
        },
        kept.key,
      )
      settleLinkKey(kept, reserved.id, network)
      setPending(reserved)
      try {
        await fundLink(kept)
      } catch {
        // Keep the recovery key and reserved payment, even when broadcast is uncertain.
        router.replace(`/wallet/phone/${reserved.id}`)
        return
      }
      await client.confirm(signMessage, profile.address, reserved.id).catch(() => null)
      router.replace(`/wallet/phone/${reserved.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t send this payment.')
    } finally {
      working.current = false
      setBusy(false)
    }
  }
  return (
    <div className="w-screen">
      <ScreenHead title="Send to a phone" back="/wallet/send" />
      <div className="w-ussd-body">
        {network === 'testnet' ? (
          <aside className="w-ussd-test">
            <strong>Test dollars · simulator SMS</strong>
            <p>Messages arrive in Africa’s Talking’s simulator.</p>
          </aside>
        ) : null}
        {enabled === null ? (
          <p>Checking availability…</p>
        ) : !enabled ? (
          <section className="w-keys">
            <h2>Phone payments are coming</h2>
            <p>Phone verification isn’t available on this network yet.</p>
          </section>
        ) : (
          <>
            {!target ? (
              <form
                className="w-keyform"
                onSubmit={(e) => {
                  e.preventDefault()
                  void review()
                }}
              >
                <p className="w-lead">
                  Send to their number. If they’re new, their dollars wait while they join Kova and
                  verify their phone.
                </p>
                <label>
                  Phone number with country code
                  <input
                    type="tel"
                    autoComplete="tel"
                    placeholder="+2348012345678"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                  />
                </label>
                <label>
                  Amount in dollars
                  <input
                    type="number"
                    min="0.01"
                    max="200"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                  />
                </label>
                <p>Available: {balance === null ? '…' : formatUsd(balance)}</p>
                <label>
                  Note (optional)
                  <input value={note} maxLength={140} onChange={(e) => setNote(e.target.value)} />
                </label>
                <button type="submit" className="mini mini-ink" disabled={busy || !valid}>
                  {busy ? 'Checking…' : 'Review transfer'}
                </button>
              </form>
            ) : (
              <section className="w-keys">
                <h2>
                  {formatUsd(value)} to {target.phone}
                </h2>
                <p>
                  {target.address
                    ? target.destination === 'ussd-pocket'
                      ? 'Goes directly to their USSD balance, ready to spend by dialling Kova.'
                      : 'This number is verified. The dollars go directly to their Kova wallet.'
                    : 'They’ll receive an invitation. They verify this number and open Kova to claim. You can take the payment back until it’s claimed.'}
                </p>
                {!target.address ? (
                  <p>Kova holds the waiting payment securely until it’s claimed or returned.</p>
                ) : null}
                {note ? <p>“{note}”</p> : null}
                <SlideToSend
                  label="Slide to send"
                  busy={busy}
                  disabled={!valid || Boolean(pending)}
                  onSend={() => void pay()}
                />
                <button
                  type="button"
                  className="textlink"
                  disabled={busy || Boolean(pending)}
                  onClick={() => setTarget(null)}
                >
                  Change details
                </button>
              </section>
            )}
          </>
        )}
        {error ? (
          <p role="alert" className="w-keys-problem">
            {error}
          </p>
        ) : null}
        {pending ? <Link href={`/wallet/phone/${pending.id}`}>Open waiting payment</Link> : null}
      </div>
    </div>
  )
}

export function PhonePaymentScreen({ id }: { id: string }) {
  const { profile, network, signMessage, refresh } = useWallet()
  const client = useMemo(() => phoneClient(getNetwork(network).chainId), [network])
  const [payment, setPayment] = useState<PhonePayment | null>(null)
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [verified, setVerified] = useState(false)
  const [busy, setBusy] = useState(false)
  const working = useRef(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setVerified(false)
    setCodeSent(false)
  }, [profile?.address, id])
  useEffect(() => {
    let live = true
    const load = () => {
      if (document.visibilityState !== 'visible') return
      void client
        .get(id)
        .then((p) => {
          if (live) setPayment(p)
        })
        .catch((e) => {
          if (live) setError(e.message)
        })
    }
    load()
    const timer = setInterval(load, 5000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [client, id])
  async function act(run: () => Promise<void>) {
    if (working.current || !profile) return
    working.current = true
    setBusy(true)
    setError(null)
    try {
      await run()
      setPayment(await client.get(id))
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t complete this request.')
    } finally {
      working.current = false
      setBusy(false)
    }
  }
  const mine = payment && profile?.address.toLowerCase() === payment.sender.toLowerCase()
  const waiting = payment && ['open', 'funding'].includes(payment.status)
  return (
    <div className="w-screen">
      <ScreenHead title="Phone payment" back="/wallet" />
      <div className="w-ussd-body">
        {payment ? (
          <>
            {payment.network !== network ? (
              <p role="alert">
                This payment belongs to another network. Open the original invitation.
              </p>
            ) : (
              <>
                {network === 'testnet' ? (
                  <aside className="w-ussd-test">
                    <strong>Test dollars · simulator SMS</strong>
                  </aside>
                ) : null}
                <section className="w-keys">
                  <h2>
                    ${payment.amount}{' '}
                    {mine ? `to ${payment.phone}` : `from ${payment.sender_name || 'a Kova user'}`}
                  </h2>
                  <p role="status">
                    {
                      {
                        funding: 'Waiting for the funding transfer to confirm.',
                        open: mine
                          ? 'Waiting for them to verify their number and claim.'
                          : 'Your payment is waiting. Verify your phone to claim.',
                        claiming: 'Claim confirming…',
                        returning: 'Return confirming…',
                        claimed: 'Payment claimed.',
                        returned: 'Payment returned to the sender.',
                      }[payment.status]
                    }
                  </p>
                  {payment.note ? <p>“{payment.note}”</p> : null}
                  {payment.tx_hash ? (
                    <a
                      href={`${getNetwork(network).explorerUrl}/tx/${payment.tx_hash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View receipt ↗
                    </a>
                  ) : null}
                </section>
                {mine && waiting ? (
                  <section className="w-keys">
                    <h2>Manage this payment</h2>
                    <p>
                      {payment.sms_sent
                        ? 'The message provider accepted the invitation.'
                        : 'The invitation hasn’t been accepted by the message provider yet. You can retry or share the invitation.'}
                    </p>
                    <CopyButton text={payment.url} />
                    {payment.status === 'open' ? (
                      <button
                        type="button"
                        className="mini"
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            const p = await client.resend(signMessage, profile!.address, id)
                            if (!p.sms_sent)
                              throw new Error(
                                'The message provider hasn’t accepted the invitation. Your funds are still recoverable.',
                              )
                          })
                        }
                      >
                        Send invitation again
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="mini"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          await client.takeBack(signMessage, profile!.address, id)
                        })
                      }
                    >
                      Return dollars to my wallet
                    </button>
                  </section>
                ) : null}
                {!mine && payment.status === 'open' ? (
                  <form
                    className="w-keyform"
                    onSubmit={(e) => {
                      e.preventDefault()
                      void act(async () => {
                        const normalized = phoneInput(phone)
                        if (!normalized)
                          throw new Error('Enter the full recipient number with its country code.')
                        if (!codeSent) {
                          try {
                            await client.claim(signMessage, profile!.address, id)
                            return
                          } catch (error) {
                            if (
                              !(error instanceof Error) ||
                              !error.message.includes(
                                'Verify the recipient phone number with this wallet first.',
                              )
                            )
                              throw error
                          }
                          await client.requestCode(signMessage, profile!.address, id, normalized)
                          setCodeSent(true)
                        } else if (!verified) {
                          await client.verify(signMessage, profile!.address, id, normalized, code)
                          setVerified(true)
                          await client.claim(signMessage, profile!.address, id)
                        } else await client.claim(signMessage, profile!.address, id)
                      })
                    }}
                  >
                    <h2>Verify {payment.phone}</h2>
                    <p>
                      {codeSent
                        ? 'Enter the code sent to this number. It expires in 10 minutes.'
                        : 'Only the owner of the recipient number can claim these dollars.'}
                    </p>
                    <label>
                      Your full phone number
                      <input
                        type="tel"
                        value={phone}
                        placeholder="+2348012345678"
                        required
                        disabled={codeSent}
                        onChange={(e) => setPhone(e.target.value)}
                      />
                    </label>
                    {codeSent && !verified ? (
                      <label>
                        Verification code
                        <input
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          pattern="[0-9]{6}"
                          maxLength={6}
                          required
                          value={code}
                          onChange={(e) => setCode(e.target.value)}
                        />
                      </label>
                    ) : null}
                    <button type="submit" className="mini mini-ink" disabled={busy}>
                      {busy
                        ? 'Please wait…'
                        : verified
                          ? 'Finish claiming'
                          : codeSent
                            ? 'Verify and claim'
                            : 'Continue to claim'}
                    </button>
                    {codeSent && !verified ? (
                      <button
                        type="button"
                        className="textlink"
                        disabled={busy}
                        onClick={() => {
                          setCodeSent(false)
                          setCode('')
                        }}
                      >
                        Request another code or change number
                      </button>
                    ) : null}
                  </form>
                ) : null}
                {['claiming', 'returning'].includes(payment.status) ? (
                  <button
                    type="button"
                    className="mini"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        if (mine) await client.takeBack(signMessage, profile!.address, id)
                        else await client.claim(signMessage, profile!.address, id)
                      })
                    }
                  >
                    Check payment
                  </button>
                ) : null}
                {['claimed', 'returned'].includes(payment.status) ? (
                  <Link href="/wallet">Open my Kova wallet</Link>
                ) : null}
              </>
            )}
          </>
        ) : (
          <p>Loading payment…</p>
        )}
        {error ? (
          <p role="alert" className="w-keys-problem">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  )
}
