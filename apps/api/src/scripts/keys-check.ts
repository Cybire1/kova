/**
 * Spending keys, end to end on Monad testnet through a Kova API: an AI agent's key switched on by its
 * owner (KovaCard link + permit), paying over MCP, asking first above its line, refused over its
 * per-payment limit and while frozen, then removed; and an allowance accepted on someone else's
 * wallet (their key made from their own signature) and spent from.
 *
 * Usage: OWNER_KEY=0x… tsx src/scripts/keys-check.ts [api]
 *   OWNER_KEY holds a dollar or so of test AUSD; the API's relayer needs a little MON for the gas.
 */
import {
  claimTypedData,
  formatAmount,
  linkTypedData,
  paymentTypedData,
  permitTypedData,
  spendKeyFromSignature,
  spendKeyMessage,
  unlinkTypedData,
  updateTypedData,
} from '@kova/monad'
import {
  type Address,
  createPublicClient,
  getAddress,
  type Hex,
  http,
  maxUint256,
  parseAbi,
  parseUnits,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const api = process.argv[2] ?? 'http://localhost:4411'
const ownerKey = process.env.OWNER_KEY as Hex | undefined
if (!ownerKey) throw new Error('OWNER_KEY is required')

let failures = 0
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures += 1
}

async function call<T>(
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T & { error?: { message: string } }> {
  const response = await fetch(`${api}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const json = (await response.json().catch(() => ({}))) as T & { error?: { message: string } }
  if (!response.ok && !json.error) throw new Error(`${path}: ${response.status}`)
  return json
}

const health = await call<{
  chain_id: number
  network: string
  settlement_token: { address: Address }
  relayer_gas: string
}>('/health')
if (health.network !== 'testnet') throw new Error('keys-check is testnet only')
const rpc = createPublicClient({ transport: http('https://testnet-rpc.monad.xyz') })
const token = getAddress(health.settlement_token.address)
const balance = (a: Address) =>
  rpc.readContract({
    address: token,
    abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
    functionName: 'balanceOf',
    args: [a],
  })

const owner = privateKeyToAccount(ownerKey)
console.log(
  `owner ${owner.address} holds $${formatAmount(await balance(owner.address))}; relayer gas ${health.relayer_gas}`,
)

interface Key {
  id: string
  status: string
  key_address: Address | null
  left: string
}
interface Plan {
  contract: Address
  chain_id: number
  holder: Address
  card: Address
  daily_limit: string
  nonce: string
  deadline: number
  permit: {
    needed: boolean
    nonce: string
    token: { address: Address; domain: { name: string; version: string } }
  }
}

async function switchOn(id: string) {
  const plan = await call<Plan>(`/v1/wallets/${owner.address}/keys/${id}/link`)
  const deadline = BigInt(plan.deadline)
  const holderSignature = await owner.signTypedData(
    linkTypedData(plan.chain_id, plan.contract, {
      holder: owner.address,
      card: getAddress(plan.card),
      dailyLimit: BigInt(plan.daily_limit),
      nonce: BigInt(plan.nonce),
      deadline,
    }),
  )
  const permit = plan.permit.needed
    ? await owner.signTypedData(
        permitTypedData(plan.permit.token, plan.chain_id, {
          owner: owner.address,
          spender: plan.contract,
          value: maxUint256,
          nonce: BigInt(plan.permit.nonce),
          deadline,
        }),
      )
    : null
  return call<Key & { token: string | null; link_tx: string | null }>(
    `/v1/wallets/${owner.address}/keys/${id}/activate`,
    {
      holder_signature: holderSignature,
      permit: permit
        ? { value: maxUint256.toString(), deadline: plan.deadline, signature: permit }
        : null,
    },
  )
}

async function setFrozen(id: string, frozen: boolean) {
  const plan = await call<Plan & { frozen: boolean }>(
    `/v1/wallets/${owner.address}/keys/${id}/freeze?frozen=${frozen}`,
  )
  const signature = await owner.signTypedData(
    updateTypedData(plan.chain_id, plan.contract, {
      holder: owner.address,
      card: getAddress(plan.card),
      dailyLimit: BigInt(plan.daily_limit),
      frozen,
      nonce: BigInt(plan.nonce),
      deadline: BigInt(plan.deadline),
    }),
  )
  return call<Key>(`/v1/wallets/${owner.address}/keys/${id}/freeze`, {
    frozen,
    deadline: plan.deadline,
    holder_signature: signature,
  })
}

let mcpId = 0
async function mcp(
  agentToken: string,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  mcpId += 1
  const response = await fetch(`${api}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${agentToken}`,
      'mcp-protocol-version': '2025-06-18',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: mcpId,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
  const json = (await response.json()) as {
    result?: { content: { text: string }[] }
    error?: { message: string }
  }
  return json.result?.content[0]?.text ?? json.error?.message ?? `HTTP ${response.status}`
}

const shop = privateKeyToAccount(generatePrivateKey()).address
const txOf = (text: string) => /0x[0-9a-f]{64}/i.exec(text)?.[0] ?? null

// ── An AI agent ────────────────────────────────────────────────────────────────────────────
const made = await call<Key>(`/v1/wallets/${owner.address}/agents`, {
  name: 'Claude',
  limit: '2',
  period: 'day',
  per_payment: '0.50',
  ask_above: '0.20',
  payees: 'anyone',
  days: 7,
})
const on = await switchOn(made.id)
check(
  on.status === 'active' && Boolean(on.token),
  `agent key switched on by the owner (KovaCard link): ${on.link_tx ?? on.error?.message}`,
)
const agentToken = on.token as string

const paid = await mcp(agentToken, 'kova_pay', { to: shop, amount: '0.10', note: 'Coffee' })
check(
  paid.startsWith('Paid $0.10') && (await balance(shop)) === parseUnits('0.10', 6),
  `Claude pays $0.10 over MCP: ${txOf(paid) ?? paid}`,
)

const asked = await mcp(agentToken, 'kova_pay', { to: shop, amount: '0.30', note: 'Lunch' })
check(asked.includes('waiting for its owner'), 'over the ask-first line it waits for the owner')
const waiting = await call<{ approvals: { id: string; approve_message: string }[] }>(
  `/v1/wallets/${owner.address}/keys`,
)
const ask = waiting.approvals[0]
const yes = ask
  ? await call<{ status: string; tx_hash: string | null }>(
      `/v1/wallets/${owner.address}/approvals/${ask.id}`,
      {
        decision: 'approve',
        signature: await owner.signMessage({ message: ask.approve_message }),
      },
    )
  : null
check(
  yes?.status === 'paid',
  `the owner approves with their wallet's signature, and it pays: ${yes?.tx_hash}`,
)

const tooMuch = await mcp(agentToken, 'kova_pay', { to: shop, amount: '0.60' })
check(
  tooMuch.startsWith('Refused') && tooMuch.includes('a payment'),
  'over the most one payment can be: refused',
)

const frozen = await setFrozen(made.id, true)
check(frozen.status === 'frozen', 'the owner freezes the key (Monad and Kova)')
const whileFrozen = await mcp(agentToken, 'kova_pay', { to: shop, amount: '0.05' })
check(whileFrozen.startsWith('Refused'), 'while frozen: refused, nothing paid')
await setFrozen(made.id, false)
const after = await mcp(agentToken, 'kova_pay', { to: shop, amount: '0.05' })
check(after.startsWith('Paid $0.05'), `unfrozen, it pays again: ${txOf(after) ?? after}`)

// ── An allowance, on someone else's wallet ─────────────────────────────────────────────────
const mum = privateKeyToAccount(generatePrivateKey())
const invite = await call<{ id: string; code: string }>(
  `/v1/wallets/${owner.address}/key-invites`,
  {
    kind: 'allowance',
    name: 'Mum',
    limit: '1',
    period: 'week',
    days: 7,
    owner_name: 'Ada',
  },
)
const info = await call<{ id: string; contract: Address; chain_id: number; owner: Address }>(
  `/v1/key-invites/${invite.code}`,
)
const mumKey = privateKeyToAccount(
  spendKeyFromSignature(
    await mum.signMessage({
      message: spendKeyMessage({ keyId: info.id, owner: info.owner, holder: mum.address }),
    }),
  ),
)
const claimDeadline = BigInt(Math.floor(Date.now() / 1000) + 6 * 24 * 3600)
const accepted = await call<Key>(`/v1/key-invites/${invite.code}/accept`, {
  holder: mum.address,
  holder_name: 'Mum',
  key: mumKey.address,
  claim_signature: await mumKey.signTypedData(
    claimTypedData(info.chain_id, info.contract, {
      card: mumKey.address,
      holder: info.owner,
      deadline: claimDeadline,
    }),
  ),
  claim_deadline: Number(claimDeadline),
})
check(
  accepted.status === 'accepted',
  'Mum accepts on her own wallet; her key comes from her signature',
)
const allowanceOn = await switchOn(invite.id)
check(
  allowanceOn.status === 'active',
  `Ada switches it on: ${allowanceOn.link_tx ?? allowanceOn.error?.message}`,
)
const prepared = await call<{
  id: string
  typed_data: {
    domain: { chainId: number; verifyingContract: Address }
    message: { card: Address; to: Address; amount: string; memo: Hex; deadline: string }
  }
}>(`/v1/keys/${invite.id}/payments`, {
  holder: mum.address,
  to: shop,
  amount: '0.10',
  note: 'Bread',
})
const m = prepared.typed_data.message
const spent = await call<{ status: string; tx_hash: string | null }>(
  `/v1/key-payments/${prepared.id}/complete`,
  {
    signature: await mumKey.signTypedData(
      paymentTypedData(
        prepared.typed_data.domain.chainId,
        prepared.typed_data.domain.verifyingContract,
        {
          card: getAddress(m.card),
          to: getAddress(m.to),
          amount: BigInt(m.amount),
          memo: m.memo,
          deadline: BigInt(m.deadline),
        },
      ),
    ),
  },
)
check(spent.status === 'paid', `Mum spends $0.10 from Ada's wallet: ${spent.tx_hash}`)
check(
  (await balance(mum.address)) === 0n,
  'Mum’s own wallet was never touched: the dollars moved from Ada’s',
)

// ── Removing the agent ─────────────────────────────────────────────────────────────────────
const plan = await call<{
  contract: Address
  chain_id: number
  card: Address
  nonce: string
  deadline: number
}>(`/v1/wallets/${owner.address}/keys/${made.id}/remove`)
await call(`/v1/wallets/${owner.address}/keys/${made.id}/remove`, {
  deadline: plan.deadline,
  signature: await owner.signTypedData(
    unlinkTypedData(plan.chain_id, plan.contract, {
      holder: owner.address,
      card: getAddress(plan.card),
      nonce: BigInt(plan.nonce),
      deadline: BigInt(plan.deadline),
    }),
  ),
})
const gone = await mcp(agentToken, 'kova_status', {})
check(/isn’t valid|not valid|invalid/i.test(gone), 'removed: the agent’s token stops working')

console.log(`\nthe shop got $${formatAmount(await balance(shop))}`)
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
