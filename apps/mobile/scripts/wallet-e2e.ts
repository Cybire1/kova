/**
 * Proves the phone's wallet code against Monad testnet and a running Kova API, exactly as the
 * app runs it: test dollars → pay a real charge by signature → send to a person → see it arrive.
 * Neither wallet ever holds MON.
 *   KOVA_API_KEY=sk_test_… npm run e2e:wallet
 */
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createCharge, getCheckout, setDeviceKey } from '../src/lib/api'
import {
  fundFromFaucet,
  getBalance,
  incomingSince,
  payCharge,
  publicClient,
  sendMoney,
} from '../src/lib/chain'
import { formatUsd } from '../src/lib/money'

async function main() {
  const key = process.env.KOVA_API_KEY
  if (!key)
    throw new Error(
      'set KOVA_API_KEY to a merchant key on the API under test (pnpm setup:dev prints one)',
    )
  setDeviceKey(key)

  const maya = privateKeyToAccount(generatePrivateKey())
  const tunde = privateKeyToAccount(generatePrivateKey())

  let t = Date.now()
  await fundFromFaucet(maya.address)
  console.log(
    `funded ${maya.address}: ${formatUsd(await getBalance(maya.address))} (${Date.now() - t}ms)`,
  )

  const charge = await createCharge('4.60', { reference: 'wallet e2e' })
  const checkout = await getCheckout(charge.id)
  console.log(
    `checkout ${checkout.id}: ${checkout.amount} ${checkout.currency} to ${checkout.merchant_name} (${checkout.status})`,
  )
  const paid = await payCharge(maya, checkout)
  const after = await getCheckout(charge.id)
  console.log(`paid the charge in ${paid.ms}ms → ${after.status}`)

  const sent = await sendMoney(maya, tunde.address, 25_000_000n)
  console.log(`sent $25 to tunde in ${sent.ms}ms`)

  // Tunde's phone learns about it from Kova's index, which trails the chain by about a second.
  t = Date.now()
  let seen: Awaited<ReturnType<typeof incomingSince>>['transfers'] = []
  while (Date.now() - t < 15_000 && seen.length === 0) {
    seen = (await incomingSince(tunde.address, 0n)).transfers
    if (seen.length === 0) await new Promise((r) => setTimeout(r, 300))
  }
  console.log(
    `tunde sees ${seen.length} incoming after ${Date.now() - t}ms: ${seen.map((x) => formatUsd(x.amount)).join(', ')}`,
  )
  console.log(
    `maya ${formatUsd(await getBalance(maya.address))}, tunde ${formatUsd(await getBalance(tunde.address))}`,
  )
  console.log(
    `maya holds ${await publicClient.getBalance({ address: maya.address })} MON (Kova paid every fee)`,
  )
  if (after.status !== 'paid' || seen.length !== 1) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
