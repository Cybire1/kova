import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'

/**
 * Development only: two wallets on one simulator. `stash` keeps everything the current dev wallet
 * has on this phone (its activity, contacts, private dollars, and the Keychain items that make it
 * sign: the dev key, the vault secret, its private-receiving keys) under a name; `unstash` puts a
 * stashed wallet back exactly as it was, ready for the next launch. Settings shared by every wallet
 * stay where they are.
 */
const SLOT = 'kova.dev.slot.'
const SHARED = new Set(['kova.prefs.v1', 'kova.rates.v1', 'kova.payfrom.v1', 'kova.send.privately.v1'])
const secrets = (owner: string) => [
  'kova.dev.prf',
  'kova.monad.vault.v1',
  `kova.monad.private.view.v1.${owner.toLowerCase()}`,
  `kova.monad.private.spend.v1.${owner.toLowerCase()}`,
]
const own = (key: string) => !key.startsWith(SLOT) && !SHARED.has(key)

export async function stashWallet(name: string, owner: string) {
  if (!__DEV__) throw new Error('Development only')
  const pairs = await AsyncStorage.multiGet((await AsyncStorage.getAllKeys()).filter(own))
  const secure: Record<string, string> = {}
  for (const key of secrets(owner)) {
    const value = await SecureStore.getItemAsync(key).catch(() => null)
    if (value) secure[key] = value
  }
  if (!secure['kova.dev.prf']) throw new Error('Only a dev wallet (fake=1) can be stashed: a passkey wallet’s key never leaves the Keychain.')
  await AsyncStorage.setItem(`${SLOT}${name}`, JSON.stringify({ owner, pairs }))
  await SecureStore.setItemAsync(`${SLOT}${name}`, JSON.stringify(secure))
}

export async function unstashWallet(name: string): Promise<string> {
  if (!__DEV__) throw new Error('Development only')
  const raw = await AsyncStorage.getItem(`${SLOT}${name}`)
  const secure = await SecureStore.getItemAsync(`${SLOT}${name}`)
  if (!raw || !secure) throw new Error(`No wallet stashed as “${name}”`)
  const { owner, pairs } = JSON.parse(raw) as { owner: string; pairs: [string, string | null][] }
  await AsyncStorage.multiRemove((await AsyncStorage.getAllKeys()).filter(own))
  await AsyncStorage.multiSet(pairs.filter((p): p is [string, string] => p[1] !== null))
  for (const [key, value] of Object.entries(JSON.parse(secure) as Record<string, string>)) await SecureStore.setItemAsync(key, value)
  return owner
}
