/**
 * Proves Kova works on Monad mainnet, with mainnet AUSD: the test wallet sends $0.10 of AUSD to
 * the receiver through Kova's relayer, exactly as Kova Pay sends, and never holds MON.
 *   pnpm mainnet:check [api url]
 *
 * Reads KOVA_MAINNET_TEST_KEY and KOVA_MAINNET_RECEIVER_KEY from .env.mainnet (gitignored). Fund
 * the test wallet with a little AUSD first; this prints its address if it's empty.
 */
import {
  eip3009Abi,
  getNetwork,
  getToken,
  toSignedAuthorization,
  transferAuthorizationTypedData,
} from '@kova/monad'
import { createPublicClient, formatUnits, http, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const SEND = 100_000n // $0.10, AUSD has 6 decimals

async function main() {
  const api = process.argv[2] ?? 'https://api-monad-mainnet.up.railway.app'
  const testKey = process.env.KOVA_MAINNET_TEST_KEY as `0x${string}` | undefined
  const receiverKey = process.env.KOVA_MAINNET_RECEIVER_KEY as `0x${string}` | undefined
  if (!testKey || !receiverKey)
    throw new Error(
      'KOVA_MAINNET_TEST_KEY and KOVA_MAINNET_RECEIVER_KEY are missing (.env.mainnet)',
    )

  const health = (await (await fetch(`${api}/health`)).json()) as {
    network: string
    chain_id: number
    relayer_gas: string
  }
  if (health.network !== 'mainnet') throw new Error(`${api} is on ${health.network}, not mainnet`)
  console.log(`${api}: Monad mainnet (chain ${health.chain_id}), relayer gas ${health.relayer_gas}`)

  const network = getNetwork('mainnet')
  const token = getToken('mainnet', 'AUSD')
  const client = createPublicClient({ chain: network.chain, transport: http(network.rpcUrl) })
  const from = privateKeyToAccount(testKey)
  const to = privateKeyToAccount(receiverKey).address
  const balance = (address: `0x${string}`) =>
    client.readContract({
      address: token.address,
      abi: eip3009Abi,
      functionName: 'balanceOf',
      args: [address],
    })
  const usd = (v: bigint) => `$${formatUnits(v, token.decimals)}`

  const before = await balance(from.address)
  const mon = await client.getBalance({ address: from.address })
  console.log(`test wallet ${from.address}: ${usd(before)} AUSD, ${formatUnits(mon, 18)} MON`)
  if (before < SEND) {
    console.log(`Send at least $0.10 of AUSD on Monad to ${from.address}, then run this again.`)
    process.exit(2)
  }

  const authorization = {
    from: from.address,
    to,
    value: SEND,
    validAfter: 0n,
    validBefore: BigInt(Math.floor(Date.now() / 1000) + 600),
    nonce: toHex(crypto.getRandomValues(new Uint8Array(32))),
  }
  const signature = await from.signTypedData(
    transferAuthorizationTypedData(token, network.chainId, authorization),
  )
  const started = Date.now()
  const response = await fetch(`${api}/v1/transfers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(toSignedAuthorization(token.address, authorization, signature)),
  })
  const sent = (await response.json()) as {
    tx_hash?: string
    explorer_url?: string
    ms?: number
    error?: unknown
  }
  if (!response.ok)
    throw new Error(`send refused: ${response.status} ${JSON.stringify(sent.error ?? sent)}`)
  const roundTrip = Date.now() - started

  const [after, received, monAfter] = await Promise.all([
    balance(from.address),
    balance(to),
    client.getBalance({ address: from.address }),
  ])
  console.log(`sent ${usd(SEND)} to ${to} in ${roundTrip} ms (relay ${sent.ms} ms)`)
  console.log(`  ${sent.explorer_url}`)
  console.log(
    `test wallet now ${usd(after)}, receiver ${usd(received)}; test wallet MON unchanged: ${monAfter === mon}`,
  )
  process.exit(before - after === SEND ? 0 : 1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
