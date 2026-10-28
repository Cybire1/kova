'use client'

import { TEST_DOLLARS_A_DAY } from '@kova/monad'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import type { Checkout } from '@/lib/api'
import { usd } from '@/lib/format'
import { rememberPayer } from '@/lib/payer'
import { returningFromPrivy } from '@/lib/privy-return'
import { Icon } from './brand'
import type { EmbeddedWallet } from './privy-wallet'

// Privy is only downloaded when someone chooses email or Google.
const PrivyWallet = dynamic(() => import('./privy-wallet'), { ssr: false })

/**
 * Paying a Kova charge without the Kova app: with email or Google (Privy makes a wallet on the
 * spot), or from any Monad wallet in the browser (MetaMask, Rabby, Phantom, whatever announces
 * itself through EIP-6963). Every one signs the same EIP-3009 authorization Kova Pay signs, for
 * exactly this charge, and Kova's relayer submits it and pays the gas: the payer needs AUSD and
 * nothing else, not even MON.
 */

export interface Eip1193 {
  request(args: { method: string; params?: unknown }): Promise<unknown>
}
interface WalletInfo {
  uuid: string
  name: string
  icon: string
  rdns: string
}
interface Wallet {
  info: WalletInfo
  provider: Eip1193
}

type Stage =
  | { name: 'choose' }
  | { name: 'working'; wallet: string; step: 'connect' | 'network' | 'sign' | 'pay' }
  | { name: 'short'; wallet: Wallet; address: string; balance: bigint }
  /** An email or Google wallet shows no prompt of its own, so the page asks before it signs. */
  | { name: 'confirm'; wallet: Wallet; address: string; balance: bigint; who: string }
  | { name: 'paid' }
  | { name: 'problem'; message: string }

/** What a wallet needs to add Monad if it has never seen it. */
const chains: Record<
  number,
  { chainName: string; rpcUrls: string[]; blockExplorerUrls: string[] }
> = {
  10143: {
    chainName: 'Monad Testnet',
    rpcUrls: ['https://testnet-rpc.monad.xyz'],
    blockExplorerUrls: ['https://testnet.monadscan.com'],
  },
  143: {
    chainName: 'Monad',
    rpcUrls: ['https://rpc.monad.xyz'],
    blockExplorerUrls: ['https://monadscan.com'],
  },
}

const hex = (n: number) => `0x${n.toString(16)}`

function useWallets(): Wallet[] | null {
  const [wallets, setWallets] = useState<Wallet[] | null>(null)
  useEffect(() => {
    const found = new Map<string, Wallet>()
    const announce = (event: Event) => {
      const detail = (event as CustomEvent<Wallet>).detail
      if (!detail?.info?.uuid || found.has(detail.info.rdns)) return
      found.set(detail.info.rdns, detail)
      setWallets([...found.values()])
    }
    window.addEventListener('eip6963:announceProvider', announce)
    window.dispatchEvent(new Event('eip6963:requestProvider'))
    // Wallets that predate EIP-6963 only leave window.ethereum behind.
    const settle = setTimeout(() => {
      const legacy = (window as unknown as { ethereum?: Eip1193 }).ethereum
      if (found.size === 0 && legacy)
        found.set('legacy', {
          info: { uuid: 'legacy', name: 'Browser wallet', icon: '', rdns: 'legacy' },
          provider: legacy,
        })
      setWallets([...found.values()])
    }, 400)
    return () => {
      window.removeEventListener('eip6963:announceProvider', announce)
      clearTimeout(settle)
    }
  }, [])
  return wallets
}

async function switchToMonad(provider: Eip1193, chainId: number) {
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: hex(chainId) }],
    })
  } catch (error) {
    // 4902: the wallet has never heard of this chain.
    if (
      (error as { code?: number }).code !== 4902 &&
      !String((error as Error).message).includes('Unrecognized')
    )
      throw error
    const chain = chains[chainId]
    if (!chain) throw error
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: hex(chainId),
          nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
          ...chain,
        },
      ],
    })
  }
}

export async function balanceOf(provider: Eip1193, token: string, owner: string): Promise<bigint> {
  const data = `0x70a08231${owner.slice(2).toLowerCase().padStart(64, '0')}`
  const result = (await provider.request({
    method: 'eth_call',
    params: [{ to: token, data }, 'latest'],
  })) as string
  return BigInt(result && result !== '0x' ? result : '0x0')
}

function typedData(c: Checkout, from: string) {
  if (!c.token_domain) throw new Error('This charge can’t be signed from a browser yet.')
  return {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    },
    domain: { ...c.token_domain, chainId: c.chain_id, verifyingContract: c.token },
    primaryType: 'TransferWithAuthorization',
    message: {
      from,
      to: c.pay_to,
      value: c.amount_base,
      validAfter: '0',
      // The approval dies with the charge.
      validBefore: String(Math.floor(Date.parse(c.expires_at) / 1000)),
      nonce: c.memo,
    },
  }
}

function explain(error: unknown): string {
  const e = error as { code?: number; message?: string }
  if (e.code === 4001 || /reject|denied|cancel/i.test(e.message ?? ''))
    return 'You cancelled in your wallet. Nothing was paid.'
  return e.message && e.message.length < 160
    ? e.message
    : 'Something went wrong. Nothing was paid; try again.'
}

/** A guest who just paid with an email or Google wallet: the page offers to keep what's left in Kova. */
export interface PaidGuest {
  provider: Eip1193
  address: string
  /** How they signed in: an email address, or "Google". */
  who: string
  logout: () => Promise<void>
}

export function WalletPay({
  checkout,
  testnet,
  privyAppId,
  onGuestPaid,
  onGuestPaying,
}: {
  checkout: Checkout
  testnet: boolean
  privyAppId?: string | null
  /** Called instead of refreshing to the receipt when an email or Google wallet paid. */
  onGuestPaid?: (guest: PaidGuest) => void
  /** Called as an email or Google wallet starts paying, so the page doesn't swap itself for the receipt mid-payment. */
  onGuestPaying?: (paying: boolean) => void
}) {
  const router = useRouter()
  const wallets = useWallets()
  const [stage, setStage] = useState<Stage>({ name: 'choose' })
  const [mobile, setMobile] = useState(false)
  const [funding, setFunding] = useState(false)
  const [privy, setPrivy] = useState<'off' | 'opening' | 'on'>('off')
  // Back from Google: load Privy at once so it can finish signing them in.
  useEffect(() => {
    if (returningFromPrivy()) setPrivy('opening')
  }, [])
  const [embedded, setEmbedded] = useState<EmbeddedWallet | null>(null)
  useEffect(() => setMobile(/iphone|ipad|android/i.test(navigator.userAgent)), [])

  // Development only, on localhost with ?guest=dev: a stand-in for Privy's embedded wallet (a
  // throwaway key in this tab), so the guest flow can be tested without a real email sign-in.
  const [devGuest, setDevGuest] = useState<EmbeddedWallet | null>(null)
  const [devGuestOffered, setDevGuestOffered] = useState(false)
  useEffect(() => {
    if (
      window.location.hostname === 'localhost' &&
      new URLSearchParams(window.location.search).get('guest') === 'dev'
    )
      setDevGuestOffered(true)
  }, [])

  /** Signs the authorization for exactly this charge and hands it to Kova. */
  const sign = async (wallet: Wallet, address: string) => {
    const name = wallet.info.name
    try {
      setStage({ name: 'working', wallet: name, step: 'sign' })
      const signature = (await wallet.provider.request({
        method: 'eth_signTypedData_v4',
        params: [address, JSON.stringify(typedData(checkout, address))],
      })) as string

      setStage({ name: 'working', wallet: name, step: 'pay' })
      if (wallet.info.rdns === 'privy') onGuestPaying?.(true)
      const message = typedData(checkout, address).message
      const response = await fetch(`/api/checkout/${checkout.id}/authorize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: checkout.token, ...message, signature }),
      })
      const body = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok)
        throw new Error(body.error ?? 'Kova couldn’t take that payment. Nothing was paid.')
      setStage({ name: 'paid' })
      // This wallet is now the buyer's stamp card at the shop.
      rememberPayer(address)
      const guest = wallet.info.rdns === 'privy' ? (embedded ?? devGuest) : null
      if (guest && onGuestPaid)
        onGuestPaid({
          provider: wallet.provider,
          address,
          who: guest.signedInAs,
          logout: guest.logout,
        })
      else router.refresh()
    } catch (error) {
      onGuestPaying?.(false)
      setStage({ name: 'problem', message: explain(error) })
    }
  }

  /**
   * Connects, moves the wallet to Monad and checks it can pay. A browser wallet then signs at once
   * (it asks its owner itself); an email or Google wallet waits for the owner's tap here first.
   */
  const prepare = async (wallet: Wallet, confirm?: { who: string }) => {
    const name = wallet.info.name
    try {
      setStage({ name: 'working', wallet: name, step: 'connect' })
      const [address] = (await wallet.provider.request({
        method: 'eth_requestAccounts',
      })) as string[]
      if (!address) throw new Error('Your wallet shared no account.')

      setStage({ name: 'working', wallet: name, step: 'network' })
      await switchToMonad(wallet.provider, checkout.chain_id)
      const balance = await balanceOf(wallet.provider, checkout.token, address)
      if (balance < BigInt(checkout.amount_base))
        return setStage({ name: 'short', wallet, address, balance })
      if (confirm) return setStage({ name: 'confirm', wallet, address, balance, who: confirm.who })
      await sign(wallet, address)
    } catch (error) {
      setStage({ name: 'problem', message: explain(error) })
    }
  }

  const topUp = async (wallet: Wallet, address: string) => {
    setFunding(true)
    try {
      const response = await fetch('/api/faucet', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address }),
      })
      const body = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) throw new Error(body.error ?? 'The test-dollar faucet didn’t answer.')
      // They asked for test dollars "and pay", so this pays without another tap.
      await prepare(wallet)
    } catch (error) {
      setStage({ name: 'problem', message: explain(error) })
    } finally {
      setFunding(false)
    }
  }

  const payWithEmbedded = (wallet: EmbeddedWallet) =>
    prepare(
      {
        info: { uuid: 'privy', name: 'your Kova wallet', icon: '', rdns: 'privy' },
        provider: wallet.provider,
      },
      { who: wallet.signedInAs },
    )

  const onPrivyWallet = useCallback(
    (wallet: EmbeddedWallet) => {
      setPrivy('on')
      setEmbedded(wallet)
      void payWithEmbedded(wallet)
    },
    // prepare reads the latest checkout on every call; it doesn't need to be a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [checkout.id],
  )
  const onPrivyCancel = useCallback(() => {
    setPrivy('off')
    setEmbedded(null)
    setStage({ name: 'choose' })
  }, [])

  const here = typeof window === 'undefined' ? '' : window.location.href

  return (
    <section className="manual wallet-pay" aria-live="polite">
      <h2>Or pay here, without the app</h2>
      <p>
        {privyAppId
          ? 'Use your email or Google, or a wallet you already have.'
          : 'Use a wallet you already have.'}{' '}
        Kova covers the fee, so you only need dollars.
      </p>
      {privyAppId && privy !== 'off' ? (
        <PrivyWallet
          appId={privyAppId}
          chainId={checkout.chain_id}
          onWallet={onPrivyWallet}
          onCancel={onPrivyCancel}
        />
      ) : null}

      {stage.name === 'working' ? (
        <div className="wallet-status">
          <span className="spinner" aria-hidden="true" />
          <span>
            {stage.step === 'connect'
              ? `Open ${stage.wallet} and connect`
              : stage.step === 'network'
                ? `Getting ${stage.wallet} ready`
                : stage.step === 'sign'
                  ? `Approve ${usd(checkout.amount)} to ${checkout.merchant_name} in ${stage.wallet}`
                  : 'Paying…'}
          </span>
        </div>
      ) : stage.name === 'confirm' ? (
        <div className="wallet-short">
          <p>
            Your wallet ({stage.who}) has {usd(Number(stage.balance) / 1e6)}. Pay{' '}
            {usd(checkout.amount)} to {checkout.merchant_name}?
          </p>
          <button
            type="button"
            className="pill pill-block"
            data-tone="coral"
            onClick={() => void sign(stage.wallet, stage.address)}
          >
            <span className="pill-label">Pay {usd(checkout.amount)}</span>
            <span className="pill-cap">
              <Icon name="arrow" size={18} />
            </span>
          </button>
          <button
            type="button"
            className="textlink wallet-again"
            onClick={() => setStage({ name: 'choose' })}
          >
            Not now
          </button>
        </div>
      ) : stage.name === 'paid' ? (
        <div className="wallet-status wallet-done">
          <Icon name="check" size={18} />
          <span>Paid</span>
        </div>
      ) : stage.name === 'short' ? (
        <div className="wallet-short">
          <p>
            This wallet has {usd(Number(stage.balance) / 1e6)} in {checkout.token_symbol ?? 'AUSD'},
            and this costs {usd(checkout.amount)}.
          </p>
          {testnet && stage.balance + TEST_DOLLARS_A_DAY >= BigInt(checkout.amount_base) ? (
            <button
              type="button"
              className="pill pill-block"
              data-tone="light"
              disabled={funding}
              onClick={() => void topUp(stage.wallet, stage.address)}
            >
              <span className="pill-label">
                {funding ? 'Getting test dollars…' : 'Get test dollars and pay'}
              </span>
              <span className="pill-cap">
                <Icon name="plus" size={18} />
              </span>
            </button>
          ) : testnet ? (
            <p>Kova’s test dollars come $5 a day, which won’t cover this.</p>
          ) : null}
          <button
            type="button"
            className="textlink wallet-again"
            onClick={() => setStage({ name: 'choose' })}
          >
            Use another wallet
          </button>
        </div>
      ) : (
        <>
          {stage.name === 'problem' ? <p className="wallet-problem">{stage.message}</p> : null}
          {privyAppId ? (
            <ul className="wallet-list">
              <li>
                <button
                  type="button"
                  disabled={privy === 'opening'}
                  onClick={() => {
                    // Signed in already: go straight to paying. Otherwise Privy opens its sign-in.
                    if (embedded) void payWithEmbedded(embedded)
                    else setPrivy('opening')
                  }}
                >
                  <span className="wallet-glyph wallet-glyph-coral">
                    <Icon name="mail" size={16} />
                  </span>
                  <span>
                    {privy === 'opening' ? 'Opening sign-in…' : 'Email or Google'}
                    <small className="wallet-sub">
                      A wallet is made for you. Nothing to install.
                    </small>
                  </span>
                  <Icon name="arrow" size={18} />
                </button>
              </li>
            </ul>
          ) : null}
          {devGuestOffered ? (
            <ul className="wallet-list">
              <li>
                <button
                  type="button"
                  onClick={async () => {
                    const { devGuestWallet } = await import('./dev-guest')
                    const wallet = devGuestWallet(checkout.chain_id)
                    setDevGuest(wallet)
                    void payWithEmbedded(wallet)
                  }}
                >
                  <span className="wallet-glyph wallet-glyph-coral">
                    <Icon name="code" size={16} />
                  </span>
                  <span>
                    Dev guest wallet
                    <small className="wallet-sub">
                      localhost only: stands in for an email wallet
                    </small>
                  </span>
                  <Icon name="arrow" size={18} />
                </button>
              </li>
            </ul>
          ) : null}
          {wallets === null ? (
            <div className="wallet-status">
              <span className="spinner" aria-hidden="true" />
              <span>Looking for wallets…</span>
            </div>
          ) : wallets.length > 0 ? (
            <ul className="wallet-list">
              {wallets.map((wallet) => (
                <li key={wallet.info.uuid}>
                  <button type="button" onClick={() => void prepare(wallet)}>
                    {wallet.info.icon ? (
                      <img src={wallet.info.icon} alt="" width={32} height={32} />
                    ) : (
                      <span className="wallet-glyph">
                        <Icon name="key" size={16} />
                      </span>
                    )}
                    <span>{wallet.info.name}</span>
                    <Icon name="arrow" size={18} />
                  </button>
                </li>
              ))}
            </ul>
          ) : mobile ? (
            <ul className="wallet-list">
              <li>
                <a href={`https://metamask.app.link/dapp/${here.replace(/^https?:\/\//, '')}`}>
                  <span className="wallet-glyph">
                    <Icon name="external" size={16} />
                  </span>
                  <span>Open in MetaMask</span>
                  <Icon name="arrow" size={18} />
                </a>
              </li>
              <li>
                <a
                  href={`https://phantom.app/ul/browse/${encodeURIComponent(here)}?ref=${encodeURIComponent(here)}`}
                >
                  <span className="wallet-glyph">
                    <Icon name="external" size={16} />
                  </span>
                  <span>Open in Phantom</span>
                  <Icon name="arrow" size={18} />
                </a>
              </li>
            </ul>
          ) : (
            <p className="wallet-none">
              No wallet in this browser. Pay with Kova on your phone, or open this page where
              MetaMask, Rabby or Phantom is installed.
            </p>
          )}
        </>
      )}
    </section>
  )
}
