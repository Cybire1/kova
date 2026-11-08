import { networks, parseAmount, tokens } from '@kova/monad'
import {
  type Address,
  decodeFunctionData,
  erc20Abi,
  formatUnits,
  getAddress,
  type Hex,
  hexToString,
  isAddress,
  isAddressEqual,
  isHex,
} from 'viem'
import { NETWORK } from '../shared/config.js'
import type { RpcResult } from '../shared/types.js'
import { ask, askWallet, Cancelled } from './approvals.js'
import { isRead, read } from './chain.js'
import { budgetTerms, connectSite, connectWallet, owner, paySite, siteKey } from './sites.js'
import { dropSite, forgetConnected, isConnected, markConnected, siteFor } from './store.js'

/**
 * Kova for Chrome as a wallet websites can use (EIP-1193, announced with EIP-6963). Connecting only
 * shows a site the wallet's address, like any wallet. Everything a site can make Kova do with money
 * is spend a budget, which Kova asks for the first time the site wants to be paid: a dollar
 * transfer (AUSD) is paid by the site's own key, within its limit. Reads go straight to Monad.
 * Sign-in messages are signed by the wallet on mykova.app. Permits and other typed data are
 * refused: no website gets an open-ended approval over the wallet.
 */

export const CHAIN_HEX = `0x${networks[NETWORK].chainId.toString(16)}`

export class RpcError extends Error {
  constructor(
    public code: number,
    message: string,
  ) {
    super(message)
  }
}

const refuse = (message: string) => new RpcError(4200, message)
const userRejected = () => new RpcError(4001, 'The person said no.')

/** A transaction a site sent, if it's a plain AUSD transfer Kova can pay from its budget. */
export function dollarTransfer(tx: unknown): { to: Address; amount: bigint } | null {
  if (!tx || typeof tx !== 'object') return null
  const t = tx as { to?: unknown; data?: unknown; input?: unknown; value?: unknown }
  const ausd = tokens[NETWORK].AUSD
  const data = (t.data ?? t.input) as unknown
  if (!ausd || typeof t.to !== 'string' || !isAddress(t.to) || !isAddressEqual(t.to, ausd.address))
    return null
  if (t.value !== undefined && t.value !== null && BigInt(t.value as string) !== 0n) return null
  if (typeof data !== 'string' || !isHex(data)) return null
  try {
    const call = decodeFunctionData({ abi: erc20Abi, data: data as Hex })
    if (call.functionName !== 'transfer') return null
    const [to, amount] = call.args as [Address, bigint]
    return amount > 0n ? { to: getAddress(to), amount } : null
  } catch {
    return null
  }
}

/** The address a connected site sees (eth_accounts); a site that hasn't connected sees none. */
async function accountsFor(origin: string): Promise<Address[]> {
  const me = await owner()
  return me && (await isConnected(origin)) ? [me.address] : []
}

/** Makes sure the wallet is connected and this site may see its address. No budget yet: that waits for a payment. */
async function connect(origin: string): Promise<Address[]> {
  let me = await owner()
  if (!me) me = await connectWallet()
  if (await isConnected(origin)) return [me.address]
  const answer = await ask({ kind: 'connect', origin })
  if (!answer.ok) throw userRejected()
  await markConnected(origin)
  return [me.address]
}

export async function handleRpc(
  origin: string,
  method: string,
  params: unknown,
): Promise<RpcResult> {
  try {
    return { result: await route(origin, method, params) }
  } catch (error) {
    if (error instanceof RpcError) return { error: { code: error.code, message: error.message } }
    if (error instanceof Cancelled) return { error: { code: 4001, message: 'The person said no.' } }
    return {
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : 'Kova couldn’t do that.',
      },
    }
  }
}

async function route(origin: string, method: string, params: unknown): Promise<unknown> {
  const list = Array.isArray(params) ? params : []
  switch (method) {
    case 'eth_chainId':
      return CHAIN_HEX
    case 'net_version':
      return String(networks[NETWORK].chainId)
    case 'eth_accounts':
      return accountsFor(origin)
    case 'eth_requestAccounts':
      return connect(origin)
    case 'wallet_requestPermissions':
      await connect(origin)
      return [{ parentCapability: 'eth_accounts', invoker: origin }]
    case 'wallet_getPermissions':
      return (await accountsFor(origin)).length
        ? [{ parentCapability: 'eth_accounts', invoker: origin }]
        : []
    case 'wallet_revokePermissions':
      await forgetConnected(origin)
      return null
    case 'wallet_switchEthereumChain': {
      const want = (list[0] as { chainId?: string } | undefined)?.chainId
      if (want?.toLowerCase() === CHAIN_HEX) return null
      throw new RpcError(4902, `Kova is on ${networks[NETWORK].name} only.`)
    }
    case 'wallet_addEthereumChain':
      throw refuse(`Kova is on ${networks[NETWORK].name} only.`)
    case 'eth_sendTransaction':
      return sendTransaction(origin, list[0])
    case 'personal_sign':
      return personalSign(origin, list)
    case 'eth_sign':
    case 'eth_signTypedData':
    case 'eth_signTypedData_v3':
    case 'eth_signTypedData_v4':
    case 'eth_signTransaction':
      throw refuse(
        'Kova doesn’t sign approvals or typed data for websites. A site gets a budget and pays from it instead.',
      )
    default:
      if (isRead(method)) return read(method, params)
      throw new RpcError(4200, `Kova doesn’t support ${method}.`)
  }
}

async function sendTransaction(origin: string, tx: unknown): Promise<Hex> {
  const me = await owner()
  if (!me || !(await isConnected(origin)))
    throw new RpcError(4100, 'Connect this site to Kova first.')
  const from = (tx as { from?: unknown } | undefined)?.from
  if (typeof from === 'string' && isAddress(from) && !isAddressEqual(from, me.address))
    throw new RpcError(4100, 'That isn’t this wallet.')
  const transfer = dollarTransfer(tx)
  if (!transfer)
    throw refuse(
      'Kova pays websites in dollars from their budget. This kind of transaction isn’t something a site can ask Kova for yet.',
    )
  const amount = formatUnits(transfer.amount, 6)
  let key = await siteKey(origin)
  if (!key) {
    // Its first payment (or its budget was removed elsewhere): the budget window shows what it
    // asks, and saying yes there is the yes to this payment too.
    if (await siteFor(origin)) await dropSite(origin)
    const answer = await ask({
      kind: 'budget',
      origin,
      reason: 'pay',
      ask: { amount, token: 'AUSD', description: null },
    })
    if (!answer.ok) throw userRejected()
    await connectSite(origin, budgetTerms(answer, 'pay'))
    key = await siteKey(origin)
    if (!key) throw new Error('Kova couldn’t read the new budget. Nothing moved.')
  } else {
    const answer = await ask({
      kind: 'pay',
      origin,
      to: transfer.to,
      amount,
      left: key.left,
      period: key.period,
    })
    if (!answer.ok) throw userRejected()
  }
  if (transfer.amount > parseAmount(key.left))
    throw new RpcError(4100, `That’s more than this site has left: $${key.left}.`)
  const paid = await paySite(origin, transfer.to, transfer.amount)
  if (paid.status !== 'paid' || !paid.tx_hash)
    throw new Error(paid.reason ?? 'It didn’t go through. No money moved.')
  return paid.tx_hash as Hex
}

/** A site's sign-in message: the wallet signs it on mykova.app, after showing exactly what it says. */
async function personalSign(origin: string, params: unknown[]): Promise<Hex> {
  const me = await owner()
  if (!me || !(await isConnected(origin)))
    throw new RpcError(4100, 'Connect this site to Kova first.')
  // Sites send [message, address]; a few send them the other way round.
  const [a, b] = params as [unknown, unknown]
  const raw = typeof a === 'string' && isAddress(a) && typeof b === 'string' ? b : a
  const who = raw === a ? b : a
  if (typeof who === 'string' && isAddress(who) && !isAddressEqual(who, me.address))
    throw new RpcError(4100, 'That isn’t this wallet.')
  if (typeof raw !== 'string') throw new RpcError(-32602, 'Nothing to sign.')
  let message = raw
  if (isHex(raw)) {
    try {
      message = hexToString(raw as Hex)
    } catch {
      throw refuse('Kova only signs messages people can read.')
    }
  }
  // Control characters (other than tabs and line breaks) mean bytes, not words: refuse them.
  const unreadable = [...message].some((ch) => {
    const code = ch.charCodeAt(0)
    return code < 32 && code !== 9 && code !== 10 && code !== 13
  })
  if (unreadable) throw refuse('Kova only signs messages people can read.')
  const data = await askWallet({
    action: 'sign',
    owner: me.address,
    site: new URL(origin).host,
    message,
  })
  if (typeof data.signature !== 'string') throw new Error('The wallet didn’t sign.')
  return data.signature as Hex
}
