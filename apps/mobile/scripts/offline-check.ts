/**
 * Offline payments, the other phone's side, through the app's own code (src/lib/offline-core.ts)
 * against a Kova API on Monad testnet. Used with the app on a simulator to check each path for real.
 *
 *   code <to> <dollars> [name]    FUNDER_KEY's wallet signs a payment code to <to>, with no network
 *   broke <to> <dollars> [name]   a new, empty wallet signs one (it can't settle: too little money)
 *   handin <code>                 hands a code to Kova, as whichever phone got signal first
 *   status <code>                 whether it has settled
 *   fund <to> <dollars>           sends FUNDER_KEY's test dollars to <to> (an ordinary send)
 *
 * Env: EXPO_PUBLIC_KOVA_NETWORK=testnet EXPO_PUBLIC_KOVA_MONAD_API_URL=http://localhost:4233 FUNDER_KEY=0x…
 */
import {
  decodeOfflinePayment,
  offlinePaymentLink,
  randomNonce,
  toSignedAuthorization,
  transferAuthorizationTypedData,
  verifyOfflinePayment,
} from '@kova/monad'
import { type Address, getAddress, type Hex, parseUnits } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { apiUrl, isTestnet, network, settlementToken } from '../src/lib/config'
import { handIn, offlineStatus, signOfflinePayment } from '../src/lib/offline-core'

if (!isTestnet) throw new Error('offline-check runs on testnet only')
const [command, ...args] = process.argv.slice(2)
const funder = () => {
  const key = process.env.FUNDER_KEY as Hex | undefined
  if (!key) throw new Error('FUNDER_KEY is required')
  return privateKeyToAccount(key)
}

async function main() {
  if (command === 'code' || command === 'broke') {
    const [to, dollars, name] = args
    if (!to || !dollars) throw new Error(`${command} <to> <dollars> [name]`)
    const account = command === 'code' ? funder() : privateKeyToAccount(generatePrivateKey())
    const { payment, code } = await signOfflinePayment(
      account,
      getAddress(to),
      parseUnits(dollars, 6),
      name ?? null,
    )
    const check = await verifyOfflinePayment(decodeOfflinePayment(code)!)
    console.log(
      JSON.stringify({
        from: account.address,
        to: payment.authorization.to,
        nonce: payment.authorization.nonce,
        verified: check.ok,
        length: code.length,
        link: offlinePaymentLink(code),
        code,
      }),
    )
    return
  }
  if (command === 'handin') {
    const code = args[0] ?? ''
    const p = decodeOfflinePayment(code)
    if (!p) throw new Error('not a code')
    const started = Date.now()
    const result = await handIn(code)
    const status = await offlineStatus(p.authorization.from, p.authorization.nonce)
    console.log(JSON.stringify({ api: apiUrl, result, ms: Date.now() - started, status }))
    return
  }
  if (command === 'status') {
    const p = decodeOfflinePayment(args[0] ?? '')
    if (!p) throw new Error('not a code')
    console.log(JSON.stringify(await offlineStatus(p.authorization.from, p.authorization.nonce)))
    return
  }
  if (command === 'fund') {
    const [to, dollars] = args
    if (!to || !dollars) throw new Error('fund <to> <dollars>')
    const account = funder()
    const authorization = {
      from: account.address,
      to: getAddress(to) as Address,
      value: parseUnits(dollars, 6),
      validAfter: 0n,
      validBefore: BigInt(Math.floor(Date.now() / 1000) + 600),
      nonce: randomNonce(),
    }
    const signature = await account.signTypedData(
      transferAuthorizationTypedData(settlementToken, network.chainId, authorization),
    )
    const response = await fetch(`${apiUrl}/v1/transfers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        toSignedAuthorization(settlementToken.address, authorization, signature),
      ),
    })
    console.log(response.status, JSON.stringify(await response.json()))
    return
  }
  throw new Error('code | broke | handin | status | fund')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
