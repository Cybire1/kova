import type { ViewKey } from '@/lib/takings'

const DATABASE = 'kova-private-view-v1'
const STORE = 'views'
type StoredView = { key: CryptoKey; iv: Uint8Array<ArrayBuffer>; ciphertext: ArrayBuffer }
const versions = new Map<string, number>()

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Private balance storage is busy.'))
    request.onsuccess = () => resolve(request.result)
  })
}

async function record(
  wallet: string,
  operation: 'get' | 'put' | 'delete',
  value?: StoredView,
): Promise<StoredView | undefined> {
  const db = await database()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, operation === 'get' ? 'readonly' : 'readwrite')
      const store = tx.objectStore(STORE)
      const request =
        operation === 'get'
          ? store.get(wallet)
          : operation === 'put'
            ? store.put(value, wallet)
            : store.delete(wallet)
      tx.oncomplete = () =>
        resolve(operation === 'get' ? (request.result as StoredView | undefined) : undefined)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error ?? new Error('Private balance storage is unavailable.'))
    })
  } finally {
    db.close()
  }
}

/** Read-only scan access, encrypted with a non-exportable origin-local key. No signing key. */
export async function cachePrivateView(wallet: string, view: ViewKey): Promise<void> {
  const address = wallet.toLowerCase()
  const version = versions.get(address) ?? 0
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(
    JSON.stringify({
      viewingPrivateKey: view.viewingPrivateKey,
      spendingPublicKey: view.spendingPublicKey,
    }),
  )
  try {
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(address) },
      key,
      plaintext,
    )
    if ((versions.get(address) ?? 0) === version)
      await record(address, 'put', { key, iv, ciphertext })
  } finally {
    plaintext.fill(0)
  }
}

export async function restorePrivateView(wallet: string): Promise<ViewKey | null> {
  const address = wallet.toLowerCase()
  const version = versions.get(address) ?? 0
  try {
    const saved = await record(address, 'get')
    if (!saved) return null
    const plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: saved.iv, additionalData: new TextEncoder().encode(address) },
        saved.key,
        saved.ciphertext,
      ),
    )
    try {
      const value = JSON.parse(new TextDecoder().decode(plaintext)) as ViewKey
      if (
        !/^0x[\da-f]{64}$/i.test(value.viewingPrivateKey) ||
        !/^0x(?:02|03)[\da-f]{64}$/i.test(value.spendingPublicKey)
      )
        return null
      return (versions.get(address) ?? 0) === version ? value : null
    } finally {
      plaintext.fill(0)
    }
  } catch {
    return null
  }
}

/** Cancels unfinished writes too, so a slow unlock cannot repopulate storage after sign-out. */
export async function forgetPrivateView(wallet: string): Promise<void> {
  const address = wallet.toLowerCase()
  versions.set(address, (versions.get(address) ?? 0) + 1)
  await record(address, 'delete')
}
