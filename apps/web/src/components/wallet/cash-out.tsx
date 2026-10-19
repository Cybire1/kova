'use client'

import { useEffect, useState } from 'react'
import { Art, Icon } from '@/components/brand'
import { formatUsd } from '@/lib/wallet/money'
import { ScreenHead } from './activity'
import { NairaRow } from './naira'
import { useWallet } from './provider'

type Settings = { live: boolean; config: Record<string, unknown> | null }

type Stage =
  | { at: 'ready' }
  | { at: 'open' }
  | { at: 'sending'; amount: bigint }
  | { at: 'sent'; amount: bigint; hash: string }
  | { at: 'problem'; message: string }

/**
 * Cashing out to a bank or card with Ramp Network. Ramp sells AUSD on Monad for money in the
 * person's account; when it asks the wallet for the dollars, Kova sends them to Ramp the way it
 * sends to anyone, gas-free and approved with the passkey. Kova never holds the money. The iOS app
 * opens this page, where the same passkey opens the same wallet.
 */
export function CashOut() {
  const { profile, balance, send, refresh } = useWallet()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [stage, setStage] = useState<Stage>({ at: 'ready' })
  const address = profile?.address
  const currency = profile?.currency

  useEffect(() => {
    if (!address) return
    void fetch(`/api/wallet/${address}/cash-out?currency=${currency}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setSettings)
      .catch(() => setSettings(null))
  }, [address, currency])

  const open = async () => {
    if (!settings?.live || !settings.config) return
    setStage({ at: 'open' })
    const { RampInstantSDK } = await import('@ramp-network/ramp-instant-sdk')
    new RampInstantSDK({
      ...(settings.config as unknown as ConstructorParameters<typeof RampInstantSDK>[0]),
      variant: 'auto',
      useSendCryptoCallback: true,
    })
      // Ramp asks for the dollars: Kova sends them like any send, gas-free, approved with the passkey.
      .onSendCrypto(async (_asset, amount, to) => {
        const value = BigInt(amount)
        setStage({ at: 'sending', amount: value })
        const moved = await send({ address: to, name: 'Ramp Network' }, value, 'Cash out')
        setStage({ at: 'sent', amount: value, hash: moved.hash })
        return { txHash: moved.hash }
      })
      .on('*', (event) => {
        if (event.type !== 'WIDGET_CLOSE') return
        setStage((s) => (s.at === 'open' ? { at: 'ready' } : s))
        void refresh()
      })
      .show()
  }

  return (
    <div className="w-screen">
      <ScreenHead title="Cash out" />
      <div className="w-add">
        <Art name="kovi-catch" size={104} className="w-add-art" />
        <h1 className="w-title">
          {stage.at === 'sent' ? 'On its way to your bank' : 'Cash out to your bank or card'}
        </h1>
        <p className="w-lead">
          {stage.at === 'sent'
            ? `${formatUsd(stage.amount)} went to Ramp Network on Monad. They pay it out to you; banks usually take minutes to a day.`
            : 'Sell dollars for money in your account, with Ramp Network. Kova sends the dollars for you, gas-free, and your passkey approves it.'}
        </p>
        <NairaRow
          href="/wallet/cash-out/naira"
          title="To a Nigerian bank, in naira"
          detail="Any bank, at today’s rate, with Paystack"
        />
        <dl className="w-review-card">
          <div className="w-review-row">
            <dt>Available</dt>
            <dd>{balance === null ? '…' : formatUsd(balance)}</dd>
          </div>
          <div className="w-review-row">
            <dt>Paid out in</dt>
            <dd>{settings?.config ? String(settings.config.fiatCurrency) : (currency ?? 'USD')}</dd>
          </div>
          <div className="w-review-row">
            <dt>Kova’s fee</dt>
            <dd>$0.00 (Ramp shows theirs)</dd>
          </div>
        </dl>
        {stage.at === 'problem' ? <p className="form-error">{stage.message}</p> : null}
        {settings && !settings.live ? (
          <p className="w-fine w-center">
            Opens on Monad mainnet, where Ramp buys AUSD on Monad. On testnet there’s nothing real
            to cash out.
          </p>
        ) : null}
        {stage.at === 'sent' ? (
          <a className="pill pill-block" data-tone="ink" href={`/wallet/activity/${stage.hash}`}>
            <span className="pill-label">See the receipt</span>
            <span className="pill-cap">
              <Icon name="arrow" size={18} />
            </span>
          </a>
        ) : (
          <button
            type="button"
            className="pill pill-block"
            data-tone="coral"
            disabled={!settings?.live || stage.at !== 'ready'}
            onClick={() =>
              void open().catch((e) =>
                setStage({
                  at: 'problem',
                  message: e instanceof Error ? e.message : 'Ramp didn’t open.',
                }),
              )
            }
          >
            <span className="pill-label">
              {stage.at === 'sending' ? `Sending ${formatUsd(stage.amount)}…` : 'Cash out'}
            </span>
            <span className="pill-cap">
              <Icon name="out" size={18} />
            </span>
          </button>
        )}
      </div>
    </div>
  )
}
