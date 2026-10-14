/**
 * Savings, end to end on Monad testnet, through a Kova API: a wallet moves dollars into savings
 * with one signed receiveWithAuthorization (Kova's relayer pays the gas), the vault's shares are in
 * its own name, and a signed permit on those shares brings every dollar back to the same wallet.
 *
 * Needs an API with KOVA_SAVINGS_VAULT and KOVA_SAVER set (apps/card/contracts/script/DeploySavings.s.sol).
 * Usage: FUNDER_KEY=0x… tsx src/scripts/savings-check.ts [api]   (FUNDER_KEY holds a dollar or so of AUSD)
 */
import {
  formatAmount,
  networkByChainId,
  receiveAuthorizationTypedData,
  tokenByAddress,
  vaultPermitTypedData,
} from '@kova/monad'
import { type Address, type Hex, parseUnits, toHex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const api = process.argv[2] ?? 'http://localhost:4414'
const funderKey = process.env.FUNDER_KEY as Hex | undefined
if (!funderKey) throw new Error('FUNDER_KEY is required')

const health = (await (await fetch(`${api}/health`)).json()) as { chain_id: number; network: string; settlement_token: { address: Address } }
if (health.network !== 'testnet') throw new Error('savings-check is testnet only')
const net = networkByChainId(health.chain_id)
const token = tokenByAddress(net.id, health.settlement_token.address)
if (!token) throw new Error('unknown settlement token')

let failures = 0
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures += 1
}

interface Savings {
  live: boolean
  vault: { address: Address; name: string; version: string; chain_id: number; shares: string; nonce: string } | null
  saver: Address | null
  balance: string
  deposited: string
}

const wallet = privateKeyToAccount(funderKey)
const read = async () => (await (await fetch(`${api}/v1/wallets/${wallet.address}/savings`)).json()) as Savings
const post = async (path: string, body: unknown) => {
  const r = await fetch(`${api}/v1/wallets/${wallet.address}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: r.status, body: (await r.json()) as { tx_hash?: Hex; amount?: string; error?: { message: string } } }
}

const before = await read()
if (!before.live || !before.saver || !before.vault) throw new Error('This API has no savings vault (KOVA_SAVINGS_VAULT, KOVA_SAVER).')
console.log(`${wallet.address} saves into ${before.vault.name} (${before.vault.address}) through ${before.saver}`)

// 1. In: one signed receiveWithAuthorization naming the saver.
const value = parseUnits('0.10', 6)
const message = {
  from: wallet.address,
  to: before.saver,
  value,
  validAfter: 0n,
  validBefore: BigInt(Math.floor(Date.now() / 1000) + 600),
  nonce: toHex(BigInt(generatePrivateKey()), { size: 32 }),
}
const inSig = await wallet.signTypedData(receiveAuthorizationTypedData(token, net.chainId, message))
const moved = await post('savings/in', { value: value.toString(), valid_after: '0', valid_before: message.validBefore.toString(), nonce: message.nonce, signature: inSig })
check(moved.status === 200 && Boolean(moved.body.tx_hash), `$${formatAmount(value)} into savings: ${moved.body.tx_hash ?? moved.body.error?.message}`)
const saved = await read()
check(BigInt(saved.balance) >= BigInt(before.balance) + value - 1n, `savings hold $${formatAmount(BigInt(saved.balance))}, in this wallet's own name`)

// 2. Someone else's signature can't move it: a different wallet signing for this one is refused.
const stranger = privateKeyToAccount(generatePrivateKey())
const forged = await stranger.signTypedData(receiveAuthorizationTypedData(token, net.chainId, { ...message, nonce: toHex(BigInt(generatePrivateKey()), { size: 32 }) }))
const refused = await post('savings/in', { value: value.toString(), valid_after: '0', valid_before: message.validBefore.toString(), nonce: message.nonce, signature: forged })
check(refused.status !== 200, 'a signature from anyone else is refused')

// 3. Out: a permit on every share, redeemed back to the same wallet.
const shares = BigInt(saved.vault?.shares ?? '0')
const deadline = BigInt(Math.floor(Date.now() / 1000) + 600)
const outSig = await wallet.signTypedData(
  vaultPermitTypedData(
    { name: saved.vault?.name ?? '', version: saved.vault?.version ?? '1', verifyingContract: saved.vault?.address as Address },
    net.chainId,
    { owner: wallet.address, spender: saved.saver as Address, value: shares, nonce: BigInt(saved.vault?.nonce ?? '0'), deadline },
  ),
)
const back = await post('savings/out', { shares: shares.toString(), deadline: deadline.toString(), signature: outSig })
check(back.status === 200 && Boolean(back.body.tx_hash), `$${formatAmount(BigInt(back.body.amount ?? '0'))} back to the wallet: ${back.body.tx_hash ?? back.body.error?.message}`)
check(BigInt((await read()).balance) === 0n, 'savings are empty again; every dollar went home')

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
