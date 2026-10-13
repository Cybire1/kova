/**
 * Sends test dollars to an address from a fresh wallet, like a friend abroad would.
 *   pay-me.ts <address> [dollars] [--private] [--note "text"] [--name "Lucía"]
 * --private sends the way Kova Pay does it privately: to a one-time address made from their
 * published key (checked against their own signature first), announced in Kova's public feed with
 * no recipient, its memo (who sent it, --name, --note) sealed so only their viewing key opens it.
 * Without --private, --note seals a private note for the two of you, as the app does. The fresh wallet's
 * dollars come from Kova's testnet faucet ($5 a day), or from the wallet whose key is in
 * KOVA_FUNDER_KEY when that's set (never printed).
 */
import { generateStealthPayment } from '@kova/monad'
import type { Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { fundFromFaucet, getBalance, sendMoney } from '../src/lib/chain'
import { apiUrl } from '../src/lib/config'
import { fetchNoteKey, noteKeys } from '../src/lib/notes-core'
import { fetchReceivingKey } from '../src/lib/private-core'

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(`--${name}`)
const option = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const [to, dollars = '25'] = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--note' && args[i - 1] !== '--name')

async function main() {
  const recipient = to as `0x${string}`
  const friend = privateKeyToAccount(generatePrivateKey())
  const amount = BigInt(Math.round(Number(dollars) * 1e6))
  const text = option('note')
  // Privately: their key, or no send at all.
  const meta = flag('private') ? await fetchReceivingKey(recipient) : null
  if (flag('private') && !meta) throw new Error(`${recipient} hasn’t published a private receiving key with ${apiUrl}`)
  const funder = process.env.KOVA_FUNDER_KEY
  if (funder) {
    const from = privateKeyToAccount((funder.startsWith('0x') ? funder : `0x${funder}`) as Hex)
    await sendMoney(from, friend.address, amount)
    for (let i = 0; i < 20 && (await getBalance(friend.address)) < amount; i++) await new Promise((r) => setTimeout(r, 250))
  } else await fundFromFaucet(friend.address)
  const name = option('name')
  const stealth = meta ? generateStealthPayment(meta, { from: friend.address, ...(name ? { name } : {}), ...(text ? { note: text } : {}), kind: 'send' }) : null
  const note =
    text && !stealth ? { text, mine: noteKeys(crypto.getRandomValues(new Uint8Array(32))).publicKey, theirs: await fetchNoteKey(apiUrl, recipient) } : undefined
  const { hash, ms } = await sendMoney(
    friend,
    stealth?.stealthAddress ?? recipient,
    amount,
    note,
    stealth ? { ephemeralPublicKey: stealth.ephemeralPublicKey, viewTag: stealth.viewTag, sealed: stealth.sealed } : undefined,
  )
  console.log(`sent $${dollars}${stealth ? ` privately, to one-time address ${stealth.stealthAddress},` : ''} from ${friend.address} in ${ms}ms: ${hash}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
