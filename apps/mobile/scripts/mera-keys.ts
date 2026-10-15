/**
 * Checks Kova Pay's Mera key layer from Node, with a stand-in PRF output in place of a passkey:
 * the same output always opens the same account, the account is Mera's documented derivation,
 * a session signs payments that Monad's tokens accept, and an ended session signs nothing.
 *   npm run check:mera
 */
import { getToken, transferAuthorizationTypedData } from '@kova/monad'
import { entropyToMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { recoverTypedDataAddress } from 'viem'
import { mnemonicToAccount } from 'viem/accounts'
import { openSigningSession } from '../src/lib/keys'

const assert = (ok: unknown, what: string) => {
  if (!ok) throw new Error(`FAILED: ${what}`)
  console.log(`ok  ${what}`)
}

async function main() {
  const prf = crypto.getRandomValues(new Uint8Array(32))
  const a = await openSigningSession(prf)
  const b = await openSigningSession(prf)
  assert(a.account.address === b.account.address, 'the same passkey output opens the same account')

  const reference = mnemonicToAccount(entropyToMnemonic(prf, wordlist))
  assert(
    a.account.address === reference.address,
    "it is Mera's derivation (BIP-39 entropy, m/44'/60'/0'/0/0)",
  )

  const other = await openSigningSession(crypto.getRandomValues(new Uint8Array(32)))
  assert(other.account.address !== a.account.address, 'another passkey opens another account')

  const token = getToken('testnet', 'AUSD')
  const typed = transferAuthorizationTypedData(token, 10143, {
    from: a.account.address,
    to: other.account.address,
    value: 4_600_000n,
    validAfter: 0n,
    validBefore: BigInt(Math.floor(Date.now() / 1000) + 600),
    nonce: `0x${'11'.repeat(32)}`,
  })
  const t = performance.now()
  const signature = await a.account.signTypedData(typed)
  const took = performance.now() - t
  assert(
    (await recoverTypedDataAddress({ ...typed, signature })) === a.account.address,
    `a session signs an AUSD payment without a prompt (${took.toFixed(0)}ms)`,
  )

  a.session.end()
  let refused = false
  try {
    await a.account.signTypedData(typed)
  } catch {
    refused = true
  }
  assert(refused, 'an ended session signs nothing')
  b.session.end()
  other.session.end()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
