/**
 * Private payments, end to end on Monad testnet, through a Kova API: a private send with a sealed
 * memo; its ERC-5564 Announcement on Monad, read back from the chain and opened with the recipient's
 * viewing key; spending straight from the one-time address (change stays there); and gathering two
 * private payments into one new address to pay from it, the sender proven by their wallet's signature.
 *
 * Usage: FUNDER_KEY=0x… tsx src/scripts/private-check.ts [api]   (FUNDER_KEY holds a dollar or so of AUSD)
 */
import {
  ERC5564_ANNOUNCER,
  erc5564AnnouncerAbi,
  formatAmount,
  generateStealthAddress,
  generateStealthPayment,
  networkByChainId,
  openStealthMemo,
  parseStealthMetadata,
  personalStealthKeysMessage,
  type StealthMemo,
  stealthKeysFromSignature,
  stealthMemoMessage,
  stealthMetaAddress,
  stealthPrivateKey,
  stealthSender,
  tokenByAddress,
  toSignedAuthorization,
  transferAuthorizationTypedData,
} from '@kova/monad'
import {
  type Address,
  createPublicClient,
  decodeEventLog,
  type Hex,
  http,
  parseUnits,
  toHex,
} from 'viem'
import { generatePrivateKey, type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts'

const api = process.argv[2] ?? 'http://localhost:4231'
const funderKey = process.env.FUNDER_KEY as Hex | undefined
if (!funderKey) throw new Error('FUNDER_KEY is required')

const health = (await (await fetch(`${api}/health`)).json()) as {
  chain_id: number
  network: string
  settlement_token: { address: Address }
}
if (health.network !== 'testnet') throw new Error('private-check is testnet only')
const net = networkByChainId(health.chain_id)
const token = tokenByAddress(net.id, health.settlement_token.address)
if (!token) throw new Error('unknown settlement token')
const chain = {
  id: net.chainId,
  name: net.name,
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [net.rpcUrl] } },
}
const rpc = createPublicClient({ chain, transport: http(net.rpcUrl) })

let failures = 0
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures += 1
}

/** A transfer signed by `from`, relayed by Kova; with `stealth`, announced as a private payment. */
async function send(
  from: PrivateKeyAccount,
  to: Address,
  value: bigint,
  stealth?: { ephemeral_public_key: Hex; view_tag: Hex; sealed: Hex | null },
) {
  const authorization = {
    from: from.address,
    to,
    value,
    validAfter: 0n,
    validBefore: BigInt(Math.floor(Date.now() / 1000) + 600),
    nonce: toHex(BigInt(generatePrivateKey()), { size: 32 }),
  }
  const signature = await from.signTypedData(
    transferAuthorizationTypedData(token as NonNullable<typeof token>, net.chainId, authorization),
  )
  const started = performance.now()
  const response = await fetch(`${api}/v1/transfers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...toSignedAuthorization(
        (token as NonNullable<typeof token>).address,
        authorization,
        signature,
      ),
      ...(stealth ? { stealth } : {}),
    }),
  })
  const body = (await response.json()) as { tx_hash?: Hex; error?: { message: string } }
  if (!response.ok || !body.tx_hash)
    throw new Error(`send failed: ${body.error?.message ?? response.status}`)
  return { tx: body.tx_hash, ms: Math.round(performance.now() - started) }
}

const balance = (address: Address) =>
  rpc.readContract({
    address: (token as NonNullable<typeof token>).address,
    abi: [
      {
        type: 'function',
        name: 'balanceOf',
        stateMutability: 'view',
        inputs: [{ name: 'a', type: 'address' }],
        outputs: [{ type: 'uint256' }],
      },
    ] as const,
    functionName: 'balanceOf',
    args: [address],
  })

interface FeedItem {
  stealth_address: Address
  ephemeral_public_key: Hex
  view_tag: Hex
  from: Address | null
  sealed: Hex | null
  announce_tx: Hex | null
  announce_url: string | null
}

/** The feed's entry for a one-time address, once Kova has posted it on Monad. */
async function announced(stealthAddress: Address): Promise<FeedItem> {
  for (let i = 0; i < 40; i++) {
    const feed = (await (
      await fetch(`${api}/v1/public/stealth/announcements?limit=1000`)
    ).json()) as { data: FeedItem[] }
    const item = feed.data.find(
      (d) => d.stealth_address.toLowerCase() === stealthAddress.toLowerCase(),
    )
    if (item?.announce_tx) return item
    await new Promise((r) => setTimeout(r, 1500))
  }
  throw new Error(`not announced: ${stealthAddress}`)
}

const funder = privateKeyToAccount(funderKey)
const sam = privateKeyToAccount(generatePrivateKey())
const keys = stealthKeysFromSignature(
  await sam.signMessage({ message: personalStealthKeysMessage(sam.address) }),
)
const meta = stealthMetaAddress(keys)
console.log(
  `funder ${funder.address} holds $${formatAmount(await balance(funder.address))}; recipient ${sam.address}`,
)

// 1. A private send with a sealed memo.
const memo: StealthMemo = { from: funder.address, name: 'Ada', note: 'Train tickets', kind: 'send' }
const first = generateStealthPayment(meta, memo)
const sent = await send(funder, first.stealthAddress, parseUnits('0.25', 6), {
  ephemeral_public_key: first.ephemeralPublicKey,
  view_tag: first.viewTag,
  sealed: first.sealed,
})
console.log(`private send $0.25 to ${first.stealthAddress} in ${sent.ms} ms: ${sent.tx}`)

// 2. Its announcement on Monad, read back from the chain itself, and opened.
const item = await announced(first.stealthAddress)
const receipt = await rpc.getTransactionReceipt({ hash: item.announce_tx as Hex })
const log = receipt.logs.find((l) => l.address.toLowerCase() === ERC5564_ANNOUNCER.toLowerCase())
const event = log
  ? decodeEventLog({ abi: erc5564AnnouncerAbi, data: log.data, topics: log.topics })
  : null
const onChain = event?.eventName === 'Announcement' ? event.args : null
check(
  onChain?.stealthAddress.toLowerCase() === first.stealthAddress.toLowerCase(),
  `announced on Monad: ${item.announce_url}`,
)
const metadata = onChain ? parseStealthMetadata(onChain.metadata) : null
check(
  metadata?.amount === parseUnits('0.25', 6) && metadata.viewTag === first.viewTag,
  'the metadata carries the view tag and the amount, as ERC-5564 lays them out',
)
const opened = openStealthMemo(keys.viewingPrivateKey, {
  ephemeralPublicKey: onChain?.ephemeralPubKey as Hex,
  stealthAddress: first.stealthAddress,
  sealed: metadata?.sealed,
})
check(
  opened?.name === 'Ada' && opened.note === 'Train tickets',
  'the recipient opens the memo from the chain alone (no question to Kova about the address)',
)
check(
  openStealthMemo(
    stealthKeysFromSignature(
      await funder.signMessage({ message: personalStealthKeysMessage(funder.address) }),
    ).viewingPrivateKey,
    { ...first, sealed: metadata?.sealed },
  ) === null,
  'nobody else’s viewing key opens it',
)
check(
  (await stealthSender(opened, { stealthAddress: first.stealthAddress, from: item.from }))
    ?.proven === 'chain',
  'the sender is proven by Monad itself',
)

// 3. Spend straight from the one-time address: no move into the wallet, change stays private.
const one = privateKeyToAccount(stealthPrivateKey(keys, first.ephemeralPublicKey))
check(
  one.address.toLowerCase() === first.stealthAddress.toLowerCase(),
  'the spending key opens the one-time address',
)
const spent = await send(one, funder.address, parseUnits('0.10', 6))
check(
  (await balance(first.stealthAddress)) === parseUnits('0.15', 6),
  `paid $0.10 straight from it in ${spent.ms} ms, $0.15 change still there: ${spent.tx}`,
)

// 4. Two private payments that only cover $0.30 together: gathered into one new address of Sam's, then spent.
const second = generateStealthPayment(meta, { from: funder.address, name: 'Ada', kind: 'send' })
await send(funder, second.stealthAddress, parseUnits('0.20', 6), {
  ephemeral_public_key: second.ephemeralPublicKey,
  view_tag: second.viewTag,
  sealed: second.sealed,
})
const e = generatePrivateKey()
const gatherAddress = generateStealthAddress(meta, e).stealthAddress
const proof = await sam.signMessage({ message: stealthMemoMessage(gatherAddress) })
const gather = generateStealthPayment(
  meta,
  { from: sam.address, name: 'Sam', kind: 'change', proof },
  e,
)
const two = privateKeyToAccount(stealthPrivateKey(keys, second.ephemeralPublicKey))
const g1 = await send(one, gather.stealthAddress, await balance(one.address), {
  ephemeral_public_key: gather.ephemeralPublicKey,
  view_tag: gather.viewTag,
  sealed: gather.sealed,
})
const g2 = await send(two, gather.stealthAddress, await balance(two.address))
check(
  (await balance(gather.stealthAddress)) === parseUnits('0.35', 6),
  `gathered $0.35 into ${gather.stealthAddress}: ${g1.tx}, ${g2.tx}`,
)
const gathered = await announced(gather.stealthAddress)
const gatherMemo = openStealthMemo(keys.viewingPrivateKey, {
  ephemeralPublicKey: gathered.ephemeral_public_key,
  stealthAddress: gather.stealthAddress,
  sealed: gathered.sealed,
})
check(
  gatherMemo?.kind === 'change',
  'the gathered address is announced, so Sam’s other devices find it too',
)
check(
  (await stealthSender(gatherMemo, { stealthAddress: gather.stealthAddress, from: gathered.from }))
    ?.proven === 'signed',
  'its sender is proven by Sam’s signature (it came from one-time addresses, not his wallet)',
)
const g = privateKeyToAccount(stealthPrivateKey(keys, gather.ephemeralPublicKey))
const paid = await send(g, funder.address, parseUnits('0.30', 6))
check(
  (await balance(gather.stealthAddress)) === parseUnits('0.05', 6),
  `paid $0.30 from the gathered address in ${paid.ms} ms: ${paid.tx}`,
)
check(
  (await balance(sam.address)) === 0n,
  'Sam’s own wallet was never touched: nothing on Monad links these payments to him',
)

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
