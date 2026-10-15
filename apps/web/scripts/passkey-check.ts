/**
 * The web and the Kova app must turn one passkey into one account. With a stand-in PRF output in
 * place of a passkey, checks that the web's derivation is Mera's and the app's, and that its vault
 * keys are the app's, so a backup either one seals, the other opens.
 *   pnpm --filter @kova/web check:passkey
 */
import { entropyToMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { mnemonicToAccount } from 'viem/accounts'
import { openSigningSession as appSession } from '../../mobile/src/lib/keys'
import { vaultKeys as appVaultKeys } from '../../mobile/src/lib/vault-core'
import { openSigningSession, VAULT_SALT } from '../src/lib/passkey'
import { vaultKeys } from '../src/lib/vault'

const assert = (ok: unknown, what: string) => {
  if (!ok) throw new Error(`FAILED: ${what}`)
  console.log(`ok  ${what}`)
}

const prf = crypto.getRandomValues(new Uint8Array(32))
const web = await openSigningSession(prf)
const app = await appSession(prf)
assert(
  web.account.address === mnemonicToAccount(entropyToMnemonic(prf, wordlist)).address,
  "the web uses Mera's derivation (BIP-39 entropy, m/44'/60'/0'/0/0)",
)
assert(
  web.account.address === app.account.address,
  'the web and the app open the same wallet from the same passkey',
)
const secret = crypto.getRandomValues(new Uint8Array(32))
assert(
  vaultKeys(secret).id === appVaultKeys(secret).id,
  'the web and the app derive the same vault',
)
assert(
  Buffer.from(vaultKeys(secret).encryptKey).equals(Buffer.from(appVaultKeys(secret).encryptKey)),
  'with the same encryption key',
)
const { VAULT_SALT: appSalt } = await import('../../mobile/src/lib/passkey').catch(() => ({
  VAULT_SALT: null,
}))
if (appSalt)
  assert(
    Buffer.from(VAULT_SALT).equals(Buffer.from(appSalt)),
    'and ask the passkey for the same vault salt',
  )
else
  console.log(
    '--  the app’s passkey module needs React Native; its salt is sha256("kova.vault.prf.v1") in both',
  )
web.session.end()
app.session.end()
