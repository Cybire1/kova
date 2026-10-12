/**
 * Proves private sends between people with the app's own code, against Monad testnet and a running
 * Kova API: two fresh wallets publish their private-receiving keys, Maya checks Tunde's against his
 * signature and sends him dollars privately with a sealed note, Monad shows them going to a one-time
 * address that isn't Tunde's, Tunde's viewing key finds the payment in Kova's public feed (Maya's
 * doesn't), his note opens, and he moves the dollars into his wallet. Neither wallet holds MON.
 * Maya's dollars come from Kova's testnet faucet, or from the wallet whose key is in KOVA_FUNDER_KEY.
 *   EXPO_PUBLIC_KOVA_NETWORK=testnet EXPO_PUBLIC_KOVA_MONAD_API_URL=http://localhost:4215 npm run check:private
 */
import { generateStealthAddress, stealthMetaAddress, stealthRegistrationMessage, stealthViewKey } from '@kova/monad'
import { type Address, decodeEventLog, type Hex, isAddressEqual } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { fundFromFaucet, getBalance, publicClient, sendMoney } from '../src/lib/chain'
import { apiUrl, settlementToken } from '../src/lib/config'
import { formatUsd } from '../src/lib/money'
import { fetchNoteKey, noteKeys, openNote, publishNoteKey } from '../src/lib/notes-core'
import {
  feedAfter,
  fetchReceivingKey,
  findMine,
  moveIn,
  publishReceivingKey,
  receiptOf,
  receivingKeys,
  transferInto,
  UntrustedKey,
  verifyReceivingKey,
  viewFromKey,
} from '../src/lib/private-core'

const assert = (ok: unknown, what: string) => {
  if (!ok) throw new Error(`FAILED: ${what}`)
  console.log(`ok  ${what}`)
}

const transferEvent = [
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
] as const

async function main() {
  console.log(`Kova at ${apiUrl}`)
  const maya = privateKeyToAccount(generatePrivateKey())
  const tunde = privateKeyToAccount(generatePrivateKey())
  const sign = (account: typeof maya) => (message: string) => account.signMessage({ message })

  // Each wallet makes its keys from one signature, and publishes the public half, signed.
  const tundeKeys = await receivingKeys(tunde.address, sign(tunde))
  const tundeMeta = stealthMetaAddress(tundeKeys)
  assert(stealthMetaAddress(await receivingKeys(tunde.address, sign(tunde))) === tundeMeta, 'the same wallet makes the same keys every time')
  assert((await fetchReceivingKey(tunde.address)) === null, 'a new wallet has no private key with Kova yet')
  await publishReceivingKey(tunde.address, tundeMeta, await tunde.signMessage({ message: stealthRegistrationMessage(tunde.address, tundeMeta) }))
  assert((await fetchReceivingKey(tunde.address)) === tundeMeta, 'Kova returns Tunde’s key, and it checks out against his signature')

  const mayaKeys = await receivingKeys(maya.address, sign(maya))
  const mayaMeta = stealthMetaAddress(mayaKeys)
  await publishReceivingKey(maya.address, mayaMeta, await maya.signMessage({ message: stealthRegistrationMessage(maya.address, mayaMeta) }))

  // A key Kova might swap in carries the wrong signature: refused.
  const swapped = await verifyReceivingKey(tunde.address, mayaMeta, await tunde.signMessage({ message: stealthRegistrationMessage(tunde.address, tundeMeta) })).catch((e) => e)
  assert(swapped instanceof UntrustedKey, 'a key that Tunde didn’t sign is refused')
  const forged = await fetch(`${apiUrl}/v1/wallets/${tunde.address}/stealth`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ meta_address: mayaMeta, signature: await maya.signMessage({ message: stealthRegistrationMessage(tunde.address, mayaMeta) }) }),
  })
  assert(forged.status === 403, 'Kova won’t take a key for Tunde that someone else signed')

  // Tunde can read private notes.
  const tundeSecret = crypto.getRandomValues(new Uint8Array(32))
  const mayaSecret = crypto.getRandomValues(new Uint8Array(32))
  await publishNoteKey(apiUrl, tunde, tundeSecret)

  let t = Date.now()
  const funder = process.env.KOVA_FUNDER_KEY
  if (funder) {
    await sendMoney(privateKeyToAccount((funder.startsWith('0x') ? funder : `0x${funder}`) as Hex), maya.address, 2_000_000n)
    for (let i = 0; i < 20 && (await getBalance(maya.address)) === 0n; i++) await new Promise((r) => setTimeout(r, 250))
  } else await fundFromFaucet(maya.address)
  console.log(`    maya has ${formatUsd(await getBalance(maya.address))} (${Date.now() - t} ms)`)

  // Maya sends privately: a one-time address for this payment, and the note sealed to it.
  const amount = 1_250_000n
  const stealth = generateStealthAddress((await fetchReceivingKey(tunde.address)) as string)
  t = Date.now()
  const sent = await sendMoney(
    maya,
    stealth.stealthAddress,
    amount,
    { text: 'For the train tickets', mine: noteKeys(mayaSecret).publicKey, theirs: await fetchNoteKey(apiUrl, tunde.address) },
    { ephemeralPublicKey: stealth.ephemeralPublicKey, viewTag: stealth.viewTag },
  )
  console.log(`    sent ${formatUsd(amount)} privately in ${sent.ms} ms: ${sent.hash}`)

  // On Monad: Maya paid an address that isn't Tunde's.
  const receipt = await publicClient.getTransactionReceipt({ hash: sent.hash })
  const moves = receipt.logs
    .filter((log) => isAddressEqual(log.address, settlementToken.address))
    .map((log) => {
      try {
        return decodeEventLog({ abi: transferEvent, data: log.data, topics: log.topics })
      } catch {
        return null
      }
    })
    .filter((e) => e?.eventName === 'Transfer')
  const onChain = moves[0]?.args as { from: Address; to: Address; value: bigint } | undefined
  assert(onChain && isAddressEqual(onChain.from, maya.address) && isAddressEqual(onChain.to, stealth.stealthAddress) && onChain.value === amount, 'Monad shows Maya paying a one-time address')
  assert(!isAddressEqual(stealth.stealthAddress, tunde.address) && moves.every((m) => !isAddressEqual((m?.args as { to: Address }).to, tunde.address)), 'and nothing in it names Tunde')
  console.log(`    ${maya.address} → ${stealth.stealthAddress} (Tunde is ${tunde.address})`)

  // Tunde's phone finds it in Kova's public feed; Maya's keys find nothing there.
  t = Date.now()
  const feed = await feedAfter(null)
  const mine = await findMine(viewFromKey(stealthViewKey(tundeKeys)), feed, { checked: new Set(), since: null })
  console.log(`    checked ${feed.length} private payments on Kova in ${Date.now() - t} ms`)
  assert(mine.length === 1 && isAddressEqual(mine[0]!.stealth_address, stealth.stealthAddress), 'Tunde’s viewing key finds exactly his payment in the feed')
  assert((await findMine(viewFromKey(stealthViewKey(mayaKeys)), feed, { checked: new Set(), since: null })).length === 0, 'Maya’s keys find nothing of hers')
  const announced = feed.find((a) => isAddressEqual(a.stealth_address, stealth.stealthAddress))
  assert(announced && !JSON.stringify(announced).toLowerCase().includes(tunde.address.slice(2).toLowerCase()), 'the announcement names nobody')

  // Who sent it (public anyway) and the note, which only the two of them can open.
  const found = receiptOf(mine[0]!)
  let into = await transferInto(found)
  for (let i = 0; !into && i < 10; i++) {
    await new Promise((r) => setTimeout(r, 500))
    into = await transferInto(found)
  }
  assert(into && isAddressEqual(into.from, maya.address), 'Kova’s index says Maya sent it')
  const note = into?.note ? openNote(into.note.sealed, { from: into.from, to: found.stealthAddress, value: BigInt(found.amount), nonce: into.note.auth_nonce }, noteKeys(tundeSecret).secretKey) : null
  assert(note === 'For the train tickets', 'Tunde opens Maya’s sealed note')

  // Only Tunde's keys open it: Maya's sign nothing, and the dollars stay put.
  const stolen = await moveIn({ keys: mayaKeys, receipts: [found], to: maya.address })
  assert(stolen.count === 0 && stolen.failed === 1 && (await getBalance(stealth.stealthAddress)) === amount, 'Maya’s keys can’t move it')

  // Tunde moves it into his wallet: the one-time address signs its own transfer, Kova pays the gas.
  const before = await getBalance(tunde.address)
  const moved = await moveIn({ keys: tundeKeys, receipts: [found], to: tunde.address })
  console.log(`    moved ${formatUsd(moved.amount)} in ${moved.ms} ms: ${moved.moved.map((m) => m.txHash).join(', ')}`)
  assert(moved.count === 1 && moved.failed === 0, 'the move in went through')
  assert((await getBalance(tunde.address)) - before === amount && (await getBalance(stealth.stealthAddress)) === 0n, 'Tunde’s wallet has it all, and the one-time address is empty')
  const again = await moveIn({ keys: tundeKeys, receipts: [found], to: tunde.address })
  assert(again.count === 0 && again.empty === 1, 'an emptied address has nothing left to move')
  const mon = await publicClient.getBalance({ address: tunde.address })
  assert(mon === 0n, 'Tunde never held MON: Kova paid every fee')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
