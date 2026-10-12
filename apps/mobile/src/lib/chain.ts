/**
 * Everything the phone does on Monad, with no React Native in it, so it can be exercised
 * from Node against testnet exactly as the app runs it.
 *
 * The phone never holds MON and never sends a transaction itself. It signs EIP-3009 transfer
 * authorizations, and Kova's relayer submits them and pays the gas, so a payer spends exactly
 * the price. Balances are read straight from the chain. What arrived comes from Kova's index,
 * because Monad's RPCs answer log queries only 100 blocks (about 30 seconds) at a time.
 */
import {
  eip3009Abi,
  randomNonce,
  toSignedAuthorization,
  tokenByAddress,
  transferAuthorizationTypedData,
  type SealedNote,
} from '@kova/monad'
import { type Address, createPublicClient, fallback, type Hash, type Hex, http, isAddressEqual, type LocalAccount } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { monad, monadTestnet } from 'viem/chains'
import { apiUrl, isTestnet, network, networkId, settlementToken } from './config'
import { sealNote } from './notes-core'

/** Monad's own RPC first, Ankr's public one if it stumbles. */
const rpcs = isTestnet
  ? ['https://testnet-rpc.monad.xyz', 'https://rpc.ankr.com/monad_testnet']
  : ['https://rpc.monad.xyz', 'https://rpc.ankr.com/monad']

// The app's own viem chain object: @kova/monad's copy is the same chain from another install.
export const publicClient = createPublicClient({
  chain: isTestnet ? monadTestnet : monad,
  transport: fallback(rpcs.map((url) => http(url, { timeout: 8_000 }))),
})

async function kova<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    `${apiUrl}${path}`,
    body === undefined
      ? undefined
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
  )
  const json = (await response.json().catch(() => ({}))) as { error?: { message?: string } }
  if (!response.ok) throw new Error(json.error?.message ?? `Kova is unreachable (${response.status})`)
  return json as T
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const seconds = (ms: number) => BigInt(Math.floor(ms / 1000))

export async function getBalance(address: Address): Promise<bigint> {
  return publicClient.readContract({
    address: settlementToken.address,
    abi: eip3009Abi,
    functionName: 'balanceOf',
    args: [address],
  })
}

/**
 * The dollars at many addresses, read in one call per hundred (Multicall3). An address whose read
 * failed is left out, so the caller can fall back on what it expected there.
 */
export async function balancesOf(addresses: Address[]): Promise<Map<string, bigint>> {
  const held = new Map<string, bigint>()
  for (let i = 0; i < addresses.length; i += 100) {
    const chunk = addresses.slice(i, i + 100)
    const results = await publicClient
      .multicall({
        contracts: chunk.map((account) => ({ address: settlementToken.address, abi: eip3009Abi, functionName: 'balanceOf' as const, args: [account] as const })),
        allowFailure: true,
      })
      .catch(() => null)
    results?.forEach((r, j) => {
      const account = chunk[j]
      if (account && r.status === 'success') held.set(account.toLowerCase(), r.result as bigint)
    })
  }
  return held
}

/** Testnet only: asks Kova for today's test dollars ($5 a day, gas paid by Kova), and waits until they land. */
export async function fundFromFaucet(address: Address): Promise<void> {
  if (!isTestnet) throw new Error('Adding money needs a card or bank on mainnet.')
  const before = await getBalance(address).catch(() => 0n)
  await kova('/v1/faucet', { address })
  for (let i = 0; i < 40; i++) {
    if ((await getBalance(address).catch(() => before)) > before) return
    await sleep(250)
  }
}

export interface Sent {
  hash: Hash
  ms: number
}

/** The parts of a Kova charge a payment is signed against. */
export interface Charge {
  id: string
  token: Address
  pay_to: Address
  amount_base: string
  memo: Hex
  expires_at: string
}

/**
 * Pays a Kova charge. The phone signs an authorization for exactly this charge (its memo as the
 * nonce, its amount and recipient, valid until the charge expires) and Kova's relayer submits
 * it. The token is checked against the app's own list, so a charge can never get the phone to
 * sign away anything but the dollars it shows.
 */
export async function payCharge(account: LocalAccount, charge: Charge): Promise<Sent> {
  const started = Date.now()
  const token = tokenByAddress(networkId, charge.token)
  if (!token) throw new Error('This charge asks for a token Kova doesn’t use. Nothing was paid.')
  const authorization = {
    from: account.address,
    to: charge.pay_to,
    value: BigInt(charge.amount_base),
    validAfter: 0n,
    validBefore: seconds(Date.parse(charge.expires_at)),
    nonce: charge.memo,
  }
  const signature = await account.signTypedData(transferAuthorizationTypedData(token, network.chainId, authorization))
  const paid = await kova<{ status: string; payment?: { tx_hash: Hash } }>(
    `/v1/checkout/${charge.id}/authorize`,
    toSignedAuthorization(token.address, authorization, signature),
  )
  if (paid.status !== 'paid' || !paid.payment) throw new Error('The payment didn’t go through. No money moved.')
  return { hash: paid.payment.tx_hash, ms: Date.now() - started }
}

/** Sends dollars to a person. Kova submits it and pays the gas, so they get every cent sent. */
/** A note to seal with a send: its text, and the note keys of the two people it's for. */
export interface NoteToSeal {
  text: string
  mine: string
  theirs: string | null
}

/**
 * What a private send carries for its recipient (ERC-5564 scheme 1): the ephemeral public key and
 * view tag that let their viewing key, and only theirs, find the one-time address it went to.
 */
export interface StealthTag {
  ephemeralPublicKey: Hex
  viewTag: Hex
}

/**
 * `to` is their wallet, or for a private send the one-time address made for them, with `stealth`
 * saying how they find it: Kova announces it in its public feed with no recipient.
 */
export async function sendMoney(account: LocalAccount, to: Address, amount: bigint, note?: NoteToSeal, stealth?: StealthTag): Promise<Sent> {
  const started = Date.now()
  const authorization = {
    from: account.address,
    to,
    value: amount,
    validAfter: 0n,
    validBefore: seconds(Date.now() + 10 * 60_000),
    nonce: randomNonce(),
  }
  const signature = await account.signTypedData(transferAuthorizationTypedData(settlementToken, network.chainId, authorization))
  const sealed = note ? sealNote(note.text, authorization, { mine: note.mine, theirs: note.theirs }) : undefined
  const sent = await kova<{ tx_hash: Hash }>('/v1/transfers', {
    ...toSignedAuthorization(settlementToken.address, authorization, signature),
    ...(sealed ? { note: sealed } : {}),
    ...(stealth ? { stealth: { ephemeral_public_key: stealth.ephemeralPublicKey, view_tag: stealth.viewTag } } : {}),
  })
  return { hash: sent.tx_hash, ms: Date.now() - started }
}

export interface Incoming {
  from: Address
  amount: bigint
  hash: Hash
  block: bigint
  /** What a Kova memo says the money was: a refund, say. */
  kind: 'payment' | 'refund' | 'payout' | null
  /** Test dollars from the testnet faucet, not from a person. */
  faucet: boolean
  /** The sender's private note, still sealed, and the authorization nonce it is bound to. */
  note: { sealed: SealedNote; auth_nonce: Hex } | null
}

interface IndexedTransfer {
  token: Address
  from: Address
  amount_base: string
  tx_hash: Hash
  block: string
  kind: Incoming['kind']
  faucet: boolean
  note?: Incoming['note']
}

/** Dollars that arrived at `address` in blocks after `fromBlock`, from Kova's index of the chain. */
export async function incomingSince(
  address: Address,
  fromBlock: bigint,
): Promise<{ transfers: Incoming[]; head: bigint }> {
  const page = await kova<{ data: IndexedTransfer[]; indexed_through: string }>(
    `/v1/wallets/${address}/transfers?direction=in&after_block=${fromBlock}`,
  )
  return {
    head: BigInt(page.indexed_through),
    transfers: page.data
      .filter((t) => isAddressEqual(t.token, settlementToken.address))
      .map((t) => ({
        from: t.from,
        amount: BigInt(t.amount_base),
        hash: t.tx_hash,
        block: BigInt(t.block),
        kind: t.kind,
        faucet: t.faucet,
        note: t.note ?? null,
      })),
  }
}

export const explorerTx = (hash: string) => `${network.explorerUrl}/tx/${hash}`

/** Deposits from other chains (Aurora Intents, on Monad mainnet): where they can come from. */
export interface DepositSources {
  live: boolean
  network: 'mainnet' | 'testnet'
  arrives_as: string
  sources: { id: string; name: string; chains: string[]; send: string[] }[]
}

export interface ChainDeposit {
  tx_hash: string
  status: 'seen' | 'arrived' | 'failed'
  chain: string | null
  amount: string
  asset: string | null
  at: string
}

export const depositSources = (address: Address) => kova<DepositSources>(`/v1/wallets/${address}/deposit-sources`)

/** This wallet's permanent deposit address for one kind of chain. */
export const depositAddressFor = (address: Address, source: string) =>
  kova<{ address: string; memo: string | null }>(`/v1/wallets/${address}/deposit-address`, { source })

export const depositsTo = (address: Address, depositAddress: string) =>
  kova<{ data: ChainDeposit[] }>(`/v1/wallets/${address}/deposits?address=${encodeURIComponent(depositAddress)}`).then((r) => r.data)

/** A card or bank top-up (Ramp Network, buying AUSD on Monad), or why it isn't open yet. */
export const topUpLink = (address: Address, currency: string, returnTo: string) =>
  kova<{ live: boolean; url: string | null; min_eur: number }>(
    `/v1/wallets/${address}/top-up?currency=${currency}&return_to=${encodeURIComponent(returnTo)}`,
  )

/**
 * A link: dollars waiting at a one-time address whose key travels only in the link (after the #,
 * so no server ever sees it). Whoever holds the link can move them, like cash in an envelope.
 */
export interface PaymentLink {
  id: string
  status: 'open' | 'claimed' | 'returned'
  /** Dollars, e.g. "20.00". */
  amount: string
  currency: string
  token: Address
  chain_id: number
  link_address: Address
  sender_address: Address
  sender_name: string | null
  note: string | null
  display_currency: string | null
  claimed_by: Address | null
  claim_tx: Hash | null
  claim_explorer_url: string | null
  claimed_at: string | null
  created_at: string
}

/** Records a link once its dollars are at its address: Kova reads the amount from the chain. */
export const recordLink = (body: {
  link_address: Address
  sender_address: Address
  sender_name?: string
  note?: string
  display_currency?: string
}) => kova<PaymentLink>('/v1/links', body)

export const getLink = (id: string) => kova<PaymentLink>(`/v1/public/links/${encodeURIComponent(id)}`)

export const linksFrom = (sender: Address) =>
  kova<{ data: PaymentLink[] }>(`/v1/links?sender=${sender}`).then((r) => r.data)

/**
 * Moves everything a link holds to `to`: the claimer's wallet, or the sender's own when they take
 * it back. Signed here with the link's key; Kova submits it and pays the gas.
 */
export async function claimLink(link: PaymentLink, key: Hex, to: Address): Promise<PaymentLink & { ms: number }> {
  const signer = privateKeyToAccount(key)
  if (!isAddressEqual(signer.address, link.link_address))
    throw new Error('This link is missing part of its code. Ask whoever sent it to share it again.')
  if (!isAddressEqual(link.token, settlementToken.address)) throw new Error('This link holds a token Kova doesn’t use.')
  const value = await getBalance(link.link_address)
  if (value === 0n) throw new Error('This link is empty. Someone has already claimed it.')
  const authorization = {
    from: signer.address,
    to,
    value,
    validAfter: 0n,
    validBefore: seconds(Date.now() + 30 * 60_000),
    nonce: randomNonce(),
  }
  const signature = await signer.signTypedData(transferAuthorizationTypedData(settlementToken, network.chainId, authorization))
  return kova<PaymentLink & { ms: number }>(
    `/v1/public/links/${encodeURIComponent(link.id)}/claim`,
    toSignedAuthorization(settlementToken.address, authorization, signature),
  )
}
