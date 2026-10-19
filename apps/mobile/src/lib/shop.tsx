import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'
import { AppState } from 'react-native'
import { getSummary } from './api'
import type { DisplayCurrency } from './money'
import { load, save } from './storage'
import { useTerminal } from './terminal'

interface Shop {
  name: string
  /** This phone's name as a terminal, like "Front counter". */
  terminal: string
  currency: DisplayCurrency
  setCurrency: (c: DisplayCurrency) => void
}

const ShopContext = createContext<Shop>({
  name: 'Your shop',
  terminal: 'Kova Terminal',
  currency: 'USD',
  setCurrency: () => {},
})
export const useShop = () => useContext(ShopContext)

/** The merchant side shares one idea of the shop: its name and the currency it prices in. */
export function ShopProvider({ children }: { children: ReactNode }) {
  const [name, setName] = useState('Your shop')
  const [currency, setCurrencyState] = useState<DisplayCurrency>('USD')

  const { paired, canCharge } = useTerminal()
  useEffect(() => {
    void load<DisplayCurrency>('kova.shop.currency', 'USD').then(setCurrencyState)
  }, [])
  useEffect(() => {
    if (paired) setName(paired.merchantName)
    if (!canCharge) return
    // Check in on open and whenever the app comes back: picks up a renamed shop, and a
    // terminal removed from the dashboard goes back to pairing (see onDeviceKeyRevoked).
    const check = () =>
      void getSummary()
        .then((s) => setName(s.merchant.name))
        .catch(() => {})
    check()
    const sub = AppState.addEventListener('change', (state) => state === 'active' && check())
    return () => sub.remove()
  }, [paired, canCharge])

  const setCurrency = (c: DisplayCurrency) => {
    setCurrencyState(c)
    void save('kova.shop.currency', c)
  }

  return (
    <ShopContext.Provider
      value={{ name, terminal: paired?.name ?? 'Kova Terminal', currency, setCurrency }}
    >
      {children}
    </ShopContext.Provider>
  )
}
