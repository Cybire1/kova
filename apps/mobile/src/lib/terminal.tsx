import * as SecureStore from 'expo-secure-store'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import { Platform } from 'react-native'
import { onDeviceKeyRevoked, pairTerminal, setDeviceKey, unpairTerminal } from './api'

/**
 * This phone's identity as a shop's terminal. Pairing trades a one-time code from the
 * dashboard for a device key, kept in the Keychain; the merchant's own key never touches the
 * phone. Unpairing here, or removing the terminal in the dashboard, revokes that key.
 */
export interface Paired {
  id: string
  name: string
  merchantName: string
  /** Missing on phones paired before it was recorded. */
  merchantId?: string
}

interface TerminalState {
  ready: boolean
  paired: Paired | null
  /** True when the phone can take payments. */
  canCharge: boolean
  pair: (code: string, name: string) => Promise<Paired>
  unpair: () => Promise<void>
}

const STORE = 'kova.terminal.v1'
const Ctx = createContext<TerminalState | null>(null)

export function useTerminal(): TerminalState {
  const value = useContext(Ctx)
  if (!value) throw new Error('useTerminal must be used inside <TerminalProvider>')
  return value
}

export function TerminalProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [paired, setPaired] = useState<Paired | null>(null)

  useEffect(() => {
    void (async () => {
      const raw = await SecureStore.getItemAsync(STORE).catch(() => null)
      if (raw) {
        const saved = JSON.parse(raw) as Paired & { key: string }
        setDeviceKey(saved.key)
        setPaired({
          id: saved.id,
          name: saved.name,
          merchantName: saved.merchantName,
          merchantId: saved.merchantId,
        })
      }
      setReady(true)
    })()
  }, [])

  const pair = useCallback(async (code: string, name: string) => {
    const result = await pairTerminal(code, name, {
      os: Platform.OS,
      version: String(Platform.Version),
    })
    const next: Paired = {
      id: result.id,
      name: result.name,
      merchantName: result.merchant.name,
      merchantId: result.merchant.id,
    }
    await SecureStore.setItemAsync(STORE, JSON.stringify({ ...next, key: result.key }), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    })
    setDeviceKey(result.key)
    setPaired(next)
    return next
  }, [])

  const forget = useCallback(async () => {
    await SecureStore.deleteItemAsync(STORE)
    setDeviceKey(null)
    setPaired(null)
  }, [])

  const unpair = useCallback(async () => {
    // Revoke on the server first; if the phone is offline, forgetting locally still stops it
    // charging, and the shop can remove it from the dashboard.
    await unpairTerminal().catch(() => {})
    await forget()
  }, [forget])

  // Removed from the dashboard: the next request is refused, and the phone goes back to pairing.
  useEffect(() => {
    onDeviceKeyRevoked(() => void forget())
    return () => onDeviceKeyRevoked(null)
  }, [forget])

  return (
    <Ctx.Provider value={{ ready, paired, canCharge: Boolean(paired), pair, unpair }}>
      {children}
    </Ctx.Provider>
  )
}
