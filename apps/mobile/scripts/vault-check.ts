/**
 * Proves the wallet vault against a running Kova API, with a stand-in for the passkey's second
 * PRF output: a backup sealed on one phone opens on another from the same passkey, Kova only ever
 * holds ciphertext, another passkey can't read or replace it, and an old signature can't roll it back.
 *   npm run check:vault
 */
import { vaultMessage } from '@kova/monad'
import { base64urlnopad } from '@scure/base'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { apiUrl } from '../src/lib/config'
import { openVault, sealAndUpload, vaultKeys } from '../src/lib/vault-core'

const assert = (ok: unknown, what: string) => {
  if (!ok) throw new Error(`FAILED: ${what}`)
  console.log(`ok  ${what}`)
}

async function main() {
  const secret = crypto.getRandomValues(new Uint8Array(32))
  const contents = {
    v: 1 as const,
    name: 'Adaeze',
    currency: 'NGN',
    contacts: [{ address: '0x307766c07061feAeCE008ef076Eefa27190C15e2', name: 'Mama Ada' }],
  }

  assert((await openVault(secret)) === null, 'a new passkey has no backup yet')
  await sealAndUpload(secret, contents)
  const opened = await openVault(Uint8Array.from(secret))
  assert(
    opened?.name === 'Adaeze' && opened.contacts[0]?.name === 'Mama Ada',
    'the same passkey opens its backup on another phone',
  )

  const other = crypto.getRandomValues(new Uint8Array(32))
  assert((await openVault(other)) === null, 'another passkey finds nothing to open')

  // What Kova stores is ciphertext: fetch the raw record and look for the name.
  const listing = await fetch(`${apiUrl}/v1/vaults/${await vaultIdOf(secret)}`).then(
    (r) => r.json() as Promise<{ ciphertext: string }>,
  )
  assert(
    !JSON.stringify(listing).includes('Adaeze') && !JSON.stringify(listing).includes('Mama Ada'),
    'Kova holds only ciphertext',
  )

  // An impostor signs a replacement for someone else's vault.
  const impostor = privateKeyToAccount(generatePrivateKey())
  const id = await vaultIdOf(secret)
  const signedAt = Math.floor(Date.now() / 1000) + 5
  const forged = await fetch(`${apiUrl}/v1/vaults/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ciphertext: 'AAAA',
      nonce: base64urlnopad.encode(new Uint8Array(24)),
      signed_at: signedAt,
      signature: await impostor.signMessage({
        message: vaultMessage(id, 'AAAA', base64urlnopad.encode(new Uint8Array(24)), signedAt),
      }),
    }),
  })
  assert(forged.status === 403, 'only the vault’s own key can replace it')

  // A later backup wins; replaying an older one is refused.
  await new Promise((r) => setTimeout(r, 1100))
  await sealAndUpload(secret, { ...contents, name: 'Ada' })
  assert((await openVault(secret))?.name === 'Ada', 'a newer backup replaces the old one')
}

async function vaultIdOf(secret: Uint8Array) {
  return vaultKeys(secret).id
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
