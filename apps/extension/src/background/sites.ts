import {
  claimTypedData,
  extensionConnectMessage,
  keySelfFreezeMessage,
  kovaCardAddress,
  networks,
  parseAmount,
  siteName,
  type X402Requirement,
  type X402Resource,
} from '@kova/monad'
import { type Address, formatUnits, getAddress, isAddress, recoverMessageAddress } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { NETWORK } from '../shared/config.js'
import { checkedPayment, type KeysConfig, keysOf, kova, type Prepared } from '../shared/kova.js'
import type { ApiKey, ApiPayment, LocalSite, Owner, SiteView } from '../shared/types.js'
import { askWallet } from './approvals.js'
import { dollarsOf } from './chain.js'
import { dropSite, load, putSite, setOwner, siteFor } from './store.js'

const chainId = networks[NETWORK].chainId
const nowS = () => Math.floor(Date.now() / 1000)
const dollars = (units: bigint) => formatUnits(units, 6)

// ── The wallet ──────────────────────────────────────────────────────────────────────────────

/**
 * Connects the wallet: mykova.app opens it with the passkey and signs the connect message, and
 * the signature is checked here, so a page can't tell the extension a wallet it doesn't hold.
 */
export async function connectWallet(): Promise<Owner> {
  const data = await askWallet({ action: 'connect' })
  const address =
    typeof data.address === 'string' && isAddress(data.address) ? getAddress(data.address) : null
  const at = typeof data.at === 'number' ? data.at : 0
  if (!address || typeof data.signature !== 'string' || Math.abs(at - nowS()) > 600)
    throw new Error('The wallet’s answer didn’t check out. Try again.')
  const signer = await recoverMessageAddress({
    message: extensionConnectMessage({ wallet: address, at }),
    signature: data.signature as `0x${string}`,
  }).catch(() => null)
  if (!signer || signer !== address)
    throw new Error('The wallet’s answer didn’t check out. Try again.')
  const owner: Owner = {
    address,
    name: typeof data.name === 'string' ? data.name.slice(0, 40) : '',
    currency: typeof data.currency === 'string' ? data.currency : 'USD',
    connectedAt: Date.now(),
  }
  await setOwner(owner)
  return owner
}

export async function disconnectWallet() {
  await setOwner(null)
}

export async function owner(): Promise<Owner | null> {
  return (await load()).owner
}

// ── A site's budget ─────────────────────────────────────────────────────────────────────────

export interface Terms {
  limit: string
  period: 'day' | 'week'
  askAbove: string
}

/**
 * Gives a site its budget: a fresh key made here signs KovaCard's Claim for the wallet, Kova keeps
 * the terms, and the wallet switches it on with its passkey on mykova.app. The key is saved before
 * the passkey step, so a cancelled switch-on can be finished later instead of losing the key.
 */
export async function connectSite(origin: string, terms: Terms): Promise<ApiKey> {
  const me = await owner()
  if (!me) throw new Error('Connect your Kova wallet first.')
  const name = siteName(origin)
  const contract = kovaCardAddress(NETWORK)
  if (!name || !contract) throw new Error('Kova can’t give this site a budget.')
  let site = await siteFor(origin)
  if (!site) {
    const privateKey = generatePrivateKey()
    const key = privateKeyToAccount(privateKey)
    const deadline = nowS() + 7 * 86_400
    const claim = await key.signTypedData(
      claimTypedData(chainId, contract, {
        card: key.address,
        holder: me.address,
        deadline: BigInt(deadline),
      }),
    )
    const made = await kova<ApiKey>(`wallets/${me.address}/sites`, {
      site: origin,
      limit: terms.limit,
      period: terms.period,
      ask_above: terms.askAbove,
      days: 366,
      key: key.address,
      claim_signature: claim,
      claim_deadline: deadline,
      owner_name: me.name || undefined,
    })
    site = {
      origin,
      keyId: made.id,
      privateKey,
      keyAddress: key.address,
      askAbove: parseAmount(terms.askAbove).toString(),
      createdAt: Date.now(),
    }
    await putSite(site)
  }
  return switchOn(site)
}

/** The wallet's yes on mykova.app: links the key on Monad with its limit. */
export async function switchOn(site: LocalSite): Promise<ApiKey> {
  const me = await owner()
  if (!me) throw new Error('Connect your Kova wallet first.')
  const data = await askWallet({ action: 'link', owner: me.address, key: site.keyId })
  return data.key as ApiKey
}

export async function siteKey(origin: string): Promise<ApiKey | null> {
  const me = await owner()
  const site = await siteFor(origin)
  if (!me || !site) return null
  const { data } = await keysOf(me.address)
  return data.find((k) => k.id === site.keyId) ?? null
}

/** A website's key, ready to pay: on, not frozen, with Kova's own view of what's left. */
async function payingKey(origin: string) {
  const me = await owner()
  const site = await siteFor(origin)
  if (!me || !site) throw new Error('This site has no budget yet.')
  const key = await siteKey(origin)
  if (!key) throw new Error('Kova doesn’t know this site’s budget any more.')
  if (key.frozen || key.status === 'frozen') throw new Error('This site’s budget is frozen.')
  if (key.status !== 'active') throw new Error('This site’s budget isn’t switched on yet.')
  return { me, site, key, account: privateKeyToAccount(site.privateKey) }
}

/**
 * The site pays someone, from its budget: Kova checks the budget and prepares the KovaCard payment,
 * this browser checks Kova's version against what the person approved, the site's key signs, and
 * Kova cosigns and sends it. Returns the transaction's hash.
 */
export async function paySite(origin: string, to: Address, amount: bigint): Promise<ApiPayment> {
  const { me, site, account } = await payingKey(origin)
  const prepared = await kova<Prepared>(`keys/${site.keyId}/payments`, {
    holder: me.address,
    to,
    amount: dollars(amount),
    note: siteName(origin) ?? undefined,
  })
  const typed = checkedPayment(prepared, { card: site.keyAddress, to, amount }, nowS())
  const signature = await account.signTypedData(typed)
  return kova<ApiPayment>(`key-payments/${prepared.id}/complete`, { signature })
}

/**
 * Pays a site that asked over HTTP 402: the budget pays Kova's float in AUSD (checked here like any
 * payment, against the float's published address), and Kova returns the site's own payment, signed
 * from the float, as the PAYMENT-SIGNATURE header.
 */
export async function payX402(
  origin: string,
  requirement: X402Requirement,
  resource: X402Resource | undefined,
): Promise<{ header: string; payment: ApiPayment }> {
  const { me, site, account } = await payingKey(origin)
  const config = await kova<KeysConfig>('keys/config')
  if (!config.x402_ready || !config.x402_payer)
    throw new Error('Kova can’t pay websites per use right now.')
  const prepared = await kova<Prepared>(`keys/${site.keyId}/x402`, {
    holder: me.address,
    requirement,
    ...(resource ? { resource } : {}),
  })
  const typed = checkedPayment(
    prepared,
    { card: site.keyAddress, to: config.x402_payer, amount: BigInt(requirement.amount) },
    nowS(),
  )
  const signature = await account.signTypedData(typed)
  const payment = await kova<ApiPayment>(`key-payments/${prepared.id}/complete`, { signature })
  if (!payment.x402?.header)
    throw new Error(payment.reason ?? 'Kova was paid, but the site’s payment didn’t come back.')
  return { header: payment.x402.header, payment }
}

/** The site's switch: its own key freezes it, at once. Only the wallet can switch it back on. */
export async function freezeSite(origin: string): Promise<void> {
  const site = await siteFor(origin)
  if (!site) return
  const at = nowS()
  const signature = await privateKeyToAccount(site.privateKey).signMessage({
    message: keySelfFreezeMessage({ keyId: site.keyId, at }),
  })
  await kova(`keys/${site.keyId}/self-freeze`, { at, signature })
}

export async function freezeAll(): Promise<void> {
  const { sites } = await load()
  await Promise.all(Object.keys(sites).map((origin) => freezeSite(origin).catch(() => {})))
}

export async function unfreezeSite(origin: string): Promise<void> {
  const me = await owner()
  const site = await siteFor(origin)
  if (!me || !site) return
  await askWallet({ action: 'unfreeze', owner: me.address, key: site.keyId })
}

/** Ends a site's budget for good (unlinked on Monad), then forgets its key. */
export async function removeSite(origin: string): Promise<void> {
  const me = await owner()
  const site = await siteFor(origin)
  if (!me || !site) return
  await askWallet({ action: 'remove', owner: me.address, key: site.keyId })
  await dropSite(origin)
}

// ── What the popup shows ────────────────────────────────────────────────────────────────────

export async function view(): Promise<{
  owner: Owner | null
  balance: string | null
  sites: SiteView[]
}> {
  const { owner: me, sites } = await load()
  if (!me) return { owner: null, balance: null, sites: [] }
  const [balance, keys] = await Promise.all([
    dollarsOf(me.address),
    keysOf(me.address)
      .then((r) => r.data)
      .catch(() => null),
  ])
  const list: SiteView[] = Object.values(sites)
    .map((s) => {
      const key = keys?.find((k) => k.id === s.keyId)
      return {
        origin: s.origin,
        name: key?.name ?? siteName(s.origin) ?? s.origin,
        keyId: s.keyId,
        status: key ? (key.frozen ? 'frozen' : key.status) : keys ? 'removed' : 'unknown',
        limit: key?.limit ?? '0',
        period: key?.period ?? 'day',
        spent: key?.spent ?? '0',
        left: key?.left ?? '0',
        askAbove: dollars(BigInt(s.askAbove)),
      } satisfies SiteView
    })
    .sort((a, b) => Number(b.spent) - Number(a.spent))
  return { owner: me, balance, sites: list }
}
