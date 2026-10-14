import {
  eip3009Abi,
  getNetwork,
  getToken,
  type NetworkId,
  randomNonce,
  type SealedNote,
  type TransferAuthorization,
  tokenByAddress,
  toSignedAuthorization,
  transferAuthorizationTypedData,
} from '@kova/monad'
import { type Address, createPublicClient, fallback, type Hex, http, type LocalAccount } from 'viem'
import { sealNote } from './notes'

/** A note to seal with a send: its text, and the note keys of the two people it's for. */
export interface NoteToSeal {
  text: string
  mine: string
  theirs: string | null
}

/**
 * A private send's announcement (ERC-5564 scheme 1): what its recipient's viewing key needs to
 * find the one-time address it went to. Kova publishes it with no recipient named.
 */
export interface StealthAnnouncement {
  ephemeral_public_key: Hex
  view_tag: Hex
  /** The sealed memo: who sent it, their name and note, that only the recipient's key opens. */
  sealed?: Hex | null
}

/**
 * Money on Monad, from the browser, as the app moves it (apps/mobile src/lib/chain.ts). Balances
 * are read straight from Monad's public RPCs, which answer browsers; everything that moves money is
 * an EIP-3009 authorization this wallet signs and Kova's relayer submits, through this site's
 * /api routes, since the API takes no browser calls. The payer never needs MON.
 */

const rpcs: Record<NetworkId, string[]> = {
  testnet: ['https://testnet-rpc.monad.xyz', 'https://rpc.ankr.com/monad_testnet'],
  mainnet: ['https://rpc.monad.xyz', 'https://rpc.ankr.com/monad'],
}

const clients = new Map<NetworkId, ReturnType<typeof createPublicClient>>()

function client(network: NetworkId) {
  let made = clients.get(network)
  if (!made) {
    made = createPublicClient({
      chain: getNetwork(network).chain,
      transport: fallback(rpcs[network].map((url) => http(url, { timeout: 8_000 }))),
    })
    clients.set(network, made)
  }
  return made
}

/** The wallet's dollars (AUSD), in base units. */
export async function balanceOf(network: NetworkId, address: Address): Promise<bigint> {
  const token = getToken(network, 'AUSD')
  return client(network).readContract({
    address: token.address,
    abi: eip3009Abi,
    functionName: 'balanceOf',
    args: [address],
  })
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok)
    throw new Error(json.error ?? `Kova didn’t answer (${response.status}). Nothing moved.`)
  return json as T
}

export interface Moved {
  hash: Hex
  /** How long it took, from signing to settled. */
  ms: number
  explorer: string
}

/**
 * Sends dollars to a person. The approval lasts ten minutes; a random nonce keeps it a plain send.
 * A private send goes to a one-time address made for them, with its announcement alongside.
 */
export async function sendMoney(
  network: NetworkId,
  account: LocalAccount,
  to: Address,
  amount: bigint,
  note?: NoteToSeal,
  stealth?: StealthAnnouncement,
): Promise<Moved> {
  const token = getToken(network, 'AUSD')
  const authorization: TransferAuthorization = {
    from: account.address,
    to,
    value: amount,
    validAfter: 0n,
    validBefore: BigInt(Math.floor(Date.now() / 1000) + 600),
    nonce: randomNonce(),
  }
  const started = performance.now()
  const signature = await account.signTypedData(
    transferAuthorizationTypedData(token, getNetwork(network).chainId, authorization),
  )
  const sealed = note ? sealNote(note.text, authorization, note) : undefined
  const sent = await post<{ tx_hash: Hex; explorer_url: string }>('/api/wallet/send', {
    ...toSignedAuthorization(token.address, authorization, signature),
    ...(sealed ? { note: sealed } : {}),
    ...(stealth ? { stealth } : {}),
  })
  return {
    hash: sent.tx_hash,
    ms: Math.round(performance.now() - started),
    explorer: sent.explorer_url,
  }
}

/** What a charge asks for: GET /v1/checkout/:id. */
export interface ChargeToPay {
  id: string
  merchant_name: string
  amount: string
  amount_base: string
  status: string
  token: string
  pay_to: string
  memo: string
  reference: string | null
  expires_at: string
  order?: { stall: { name: string } | null } | null
}

/** Pays a Kova charge: the charge's memo is the nonce, so the approval pays exactly this charge. */
export async function payCharge(
  network: NetworkId,
  account: LocalAccount,
  charge: ChargeToPay,
): Promise<Moved> {
  const token = tokenByAddress(network, charge.token as Address)
  if (!token) throw new Error('This charge asks for a token Kova doesn’t pay with.')
  const authorization: TransferAuthorization = {
    from: account.address,
    to: charge.pay_to as Address,
    value: BigInt(charge.amount_base),
    validAfter: 0n,
    validBefore: BigInt(Math.floor(Date.parse(charge.expires_at) / 1000)),
    nonce: charge.memo as Hex,
  }
  const started = performance.now()
  const signature = await account.signTypedData(
    transferAuthorizationTypedData(token, getNetwork(network).chainId, authorization),
  )
  const paid = await post<{ status: string; payment?: { tx_hash: Hex; explorer_url: string } }>(
    `/api/checkout/${encodeURIComponent(charge.id)}/authorize`,
    toSignedAuthorization(token.address, authorization, signature),
  )
  if (paid.status !== 'paid' || !paid.payment)
    throw new Error('The shop didn’t confirm this payment. Nothing moved.')
  return {
    hash: paid.payment.tx_hash,
    ms: Math.round(performance.now() - started),
    explorer: paid.payment.explorer_url,
  }
}

/** Test dollars on testnet: asks Kova, then waits (up to ten seconds) to see them land. */
export async function addTestDollars(network: NetworkId, address: Address): Promise<bigint> {
  if (network !== 'testnet') throw new Error('Test dollars are for the test network only.')
  const before = await balanceOf(network, address)
  await post('/api/faucet', { address })
  for (let i = 0; i < 40; i++) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    const now = await balanceOf(network, address).catch(() => before)
    if (now > before) return now
  }
  return balanceOf(network, address)
}

/** One transfer from Kova's index of Monad (GET /v1/wallets/:address/transfers). */
export interface IndexedTransfer {
  id: string
  currency: string | null
  token: string
  from: string
  to: string
  amount: string
  amount_base: string
  tx_hash: string
  block: string
  kind: 'payment' | 'refund' | 'payout' | 'cashout' | null
  shop: { name: string; reference: string | null } | null
  faucet: boolean
  /** Dollars from Kova's treasury for naira: a top-up landing, or a cash-out's dollars coming back. */
  naira?: 'top_up' | 'cash_out_refund' | null
  explorer_url: string
  created_at: string
  /** The sender's private note, sealed for the two of them, and the authorization nonce it's bound to. */
  note?: { sealed: SealedNote; auth_nonce: Hex } | null
}

/** Everything that moved in or out of a wallet after `afterBlock`, a page at a time. */
export async function transfersAfter(
  address: Address,
  afterBlock: string,
): Promise<{ data: IndexedTransfer[]; indexed_through: string; has_more: boolean }> {
  const response = await fetch(
    `/api/wallet/${address}/transfers?direction=all&after_block=${afterBlock}`,
    { cache: 'no-store' },
  )
  if (!response.ok) throw new Error(`Kova couldn’t load your activity (${response.status}).`)
  return response.json()
}

/** A naira cash-out, as Kova quotes it (POST /v1/wallets/:address/cash-outs): what to sign, and how it went. */
export interface CashOutToPay {
  id: string
  amount: string
  naira: string
  rate: string
  fee: string
  bank_name: string
  account_name?: string
  account_last4: string
  status: 'quoted' | 'received' | 'paying' | 'paid' | 'failed' | 'expired'
  failure: string | null
  tx_hash: string | null
  tx_url: string | null
  refund_tx_url: string | null
  test_mode: boolean
  expires_at: string
  pay: { token: string; to: string | null; value: string; nonce: Hex; valid_before: number }
}

/**
 * Signs exactly the transfer a cash-out asks for (its dollars, to Kova's treasury, its own nonce)
 * and hands it to Kova, which relays it to Monad and pays the naira out. Kova pays the gas.
 */
export async function payCashOut(
  network: NetworkId,
  account: LocalAccount,
  cashOut: CashOutToPay,
): Promise<CashOutToPay & { ms: number }> {
  if (!cashOut.pay.to) throw new Error('Cashing out to naira isn’t switched on yet.')
  const token = getToken(network, 'AUSD')
  const authorization: TransferAuthorization = {
    from: account.address,
    to: cashOut.pay.to as Address,
    value: BigInt(cashOut.pay.value),
    validAfter: 0n,
    validBefore: BigInt(cashOut.pay.valid_before),
    nonce: cashOut.pay.nonce,
  }
  const started = performance.now()
  const signature = await account.signTypedData(
    transferAuthorizationTypedData(token, getNetwork(network).chainId, authorization),
  )
  const paid = await post<CashOutToPay>(
    `/api/naira/cash-outs/${cashOut.id}/pay`,
    toSignedAuthorization(token.address, authorization, signature),
  )
  return { ...paid, ms: Math.round(performance.now() - started) }
}
