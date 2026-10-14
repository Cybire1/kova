// Sets up the demo's AI-agent scene on Monad testnet, through Kova's live API: a new wallet for Sam,
// funded with $1 of test AUSD from Ada's Bakery's wallet; an agent key for Claude ($2 a day, asks
// Sam above $0.50) switched on by Sam's own signatures (KovaCard link + permit). The agent's token
// and Sam's key go only to 0600 files in the job's tmp folder, never to the screen.
//   OWNER_KEY=<demo shop key> node film/scripts/agent-film.mjs
import { writeFileSync } from 'node:fs'
import { linkTypedData, permitTypedData, networkByChainId, tokenByAddress, transferAuthorizationTypedData, toSignedAuthorization, randomNonce } from '../../packages/monad/dist/index.js'
import { getAddress, maxUint256, parseUnits } from '../../apps/api/node_modules/viem/_esm/index.js'
import { generatePrivateKey, privateKeyToAccount } from '../../apps/api/node_modules/viem/_esm/accounts/index.js'

const api = 'https://api-monad.up.railway.app'
const tmp = '/Users/cyber/.claude/jobs/15cd9816/tmp'
const shopKey = process.env.OWNER_KEY
if (!shopKey) throw new Error('OWNER_KEY is required')
const call = async (path, body) => {
  const r = await fetch(`${api}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`${path}: ${r.status} ${j.error?.message ?? ''}`)
  return j
}
const health = await call('/health')
const net = networkByChainId(health.chain_id)
const token = tokenByAddress(net.id, health.settlement_token.address)
const shop = privateKeyToAccount(shopKey)
const samKey = generatePrivateKey()
const sam = privateKeyToAccount(samKey)
writeFileSync(`${tmp}/agent-film-sam.key`, samKey, { mode: 0o600 })

// $1 from Ada's Bakery to Sam's new wallet, relayed by Kova.
const authorization = { from: shop.address, to: sam.address, value: parseUnits('1', 6), validAfter: 0n, validBefore: BigInt(Math.floor(Date.now() / 1000) + 600), nonce: randomNonce() }
const signature = await shop.signTypedData(transferAuthorizationTypedData(token, net.chainId, authorization))
const funded = await call('/v1/transfers', toSignedAuthorization(token.address, authorization, signature))
console.log(`Sam ${sam.address}, funded $1: ${funded.tx_hash}`)

// Claude's key: $2 a day, any payee, asks Sam above $0.50.
const made = await call(`/v1/wallets/${sam.address}/agents`, { name: 'Claude', limit: '2', period: 'day', per_payment: '2', ask_above: '0.50', payees: 'anyone', days: 7 })
const plan = await call(`/v1/wallets/${sam.address}/keys/${made.id}/link`)
const deadline = BigInt(plan.deadline)
const holderSignature = await sam.signTypedData(linkTypedData(plan.chain_id, plan.contract, { holder: sam.address, card: getAddress(plan.card), dailyLimit: BigInt(plan.daily_limit), nonce: BigInt(plan.nonce), deadline }))
const permit = plan.permit.needed
  ? await sam.signTypedData(permitTypedData(plan.permit.token, plan.chain_id, { owner: sam.address, spender: plan.contract, value: maxUint256, nonce: BigInt(plan.permit.nonce), deadline }))
  : null
const on = await call(`/v1/wallets/${sam.address}/keys/${made.id}/activate`, { holder_signature: holderSignature, permit: permit ? { value: maxUint256.toString(), deadline: plan.deadline, signature: permit } : null })
if (!on.token) throw new Error(`not switched on: ${on.status}`)
writeFileSync(`${tmp}/agent-film-mcp.json`, JSON.stringify({ mcpServers: { kova: { type: 'http', url: `${api}/mcp`, headers: { Authorization: `Bearer ${on.token}` } } } }), { mode: 0o600 })
console.log(`Claude's key ${made.id} is ${on.status}, linked on Monad: ${on.link_tx}`)
console.log(`MCP config written to ${tmp}/agent-film-mcp.json (0600)`)
