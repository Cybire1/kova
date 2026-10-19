/**
 * Offline payments, end to end on Monad testnet, through a Kova API: Ada signs a payment with no
 * network and it travels as a code; Sam's side checks it with no network; Sam hands it in and it
 * settles; Ada handing in the same code later can't pay twice; the cap and the week are enforced.
 *
 * Usage: FUNDER_KEY=0x… tsx src/scripts/offline-check.ts [api]   (FUNDER_KEY holds a dollar or so of AUSD)
 */
import {
  decodeOfflinePayment,
  encodeOfflinePayment,
  formatAmount,
  networkByChainId,
  OFFLINE_MAX,
  OFFLINE_VALIDITY,
  type OfflinePayment,
  offlineCodeFrom,
  offlinePaymentLink,
  randomNonce,
  tokenByAddress,
  toSignedAuthorization,
  transferAuthorizationTypedData,
  verifyOfflinePayment,
} from '@kova/monad'
import { type Address, type Hex, parseUnits } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const api = process.argv[2] ?? 'http://localhost:4233'
const funderKey = process.env.FUNDER_KEY as Hex | undefined
if (!funderKey) throw new Error('FUNDER_KEY is required')

const health = (await (await fetch(`${api}/health`)).json()) as {
  chain_id: number
  network: string
  settlement_token: { address: Address }
}
if (health.network !== 'testnet') throw new Error('offline-check is testnet only')
const net = networkByChainId(health.chain_id)
const token = tokenByAddress(net.id, health.settlement_token.address)
if (!token) throw new Error('unknown settlement token')

let failures = 0
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures += 1
}

const ada = privateKeyToAccount(funderKey)
const sam = privateKeyToAccount(generatePrivateKey()).address

/** What Ada's phone does with no signal: sign, and turn it into a code. */
async function signOffline(value: bigint, validBefore: bigint): Promise<string> {
  const authorization = {
    from: ada.address,
    to: sam,
    value,
    validAfter: 0n,
    validBefore,
    nonce: randomNonce(),
  }
  const signature = await ada.signTypedData(
    transferAuthorizationTypedData(token as NonNullable<typeof token>, net.chainId, authorization),
  )
  return encodeOfflinePayment({
    chainId: net.chainId,
    token: (token as NonNullable<typeof token>).address,
    authorization,
    signature,
    name: 'Ada',
  })
}

/** What either phone does once it has signal: hand the payment to Kova. */
async function handIn(p: OfflinePayment) {
  const started = performance.now()
  const response = await fetch(`${api}/v1/transfers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...toSignedAuthorization(p.token, p.authorization, p.signature),
      offline: true,
    }),
  })
  const body = (await response.json()) as {
    tx_hash?: Hex
    error?: { code: string; message: string }
  }
  return { status: response.status, body, ms: Math.round(performance.now() - started) }
}

const status = async (p: OfflinePayment) =>
  (await (
    await fetch(
      `${api}/v1/public/offline-payments/${p.authorization.from}/${p.authorization.nonce}`,
    )
  ).json()) as { status: string; tx_hash: Hex | null }

const now = BigInt(Math.floor(Date.now() / 1000))
console.log(`Ada ${ada.address}, Sam ${sam} (a new wallet)`)

// 1. Signed with no network, carried as a link.
const code = await signOffline(parseUnits('0.30', 6), now + OFFLINE_VALIDITY)
const link = offlinePaymentLink(code)
console.log(`code: ${code.length} characters; link: ${link.slice(0, 48)}…`)

// 2. Sam's phone, also with no network: read and check it.
const received = decodeOfflinePayment(offlineCodeFrom(link) ?? '')
check(
  received !== null && received.authorization.to === sam,
  'Sam’s phone reads the code from the link',
)
check(
  (await verifyOfflinePayment(received as OfflinePayment)).ok,
  'and checks Ada’s signature with no network',
)
const p = received as OfflinePayment
check((await status(p)).status === 'waiting', 'Kova has it as waiting before anyone hands it in')

// 3. Sam gets signal first and hands it in.
const first = await handIn(p)
check(
  first.status === 200 && Boolean(first.body.tx_hash),
  `Sam hands it in: settled on Monad in ${first.ms} ms, ${first.body.tx_hash}`,
)

// 4. Ada gets signal later and hands in the same code: it can't pay twice.
const second = await handIn(p)
check(
  second.status === 409,
  `Ada hands in the same code: refused as already paid (${second.body.error?.code})`,
)
check((await status(p)).status === 'settled', 'and both phones see it settled')

// 5. The limits.
const tooBig = decodeOfflinePayment(
  await signOffline(OFFLINE_MAX + 1n, now + OFFLINE_VALIDITY),
) as OfflinePayment
check((await handIn(tooBig)).body.error?.code === 'policy_declined', 'over $100 is refused')
const tooLong = decodeOfflinePayment(
  await signOffline(parseUnits('0.10', 6), now + OFFLINE_VALIDITY + 86_400n),
) as OfflinePayment
check((await handIn(tooLong)).status === 400, 'waiting more than a week is refused')

console.log(
  `Sam now holds $${formatAmount(parseUnits('0.30', 6))} from a payment Ada made with no signal`,
)
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
