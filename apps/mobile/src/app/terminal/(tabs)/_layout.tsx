import { Redirect, Tabs } from 'expo-router'
import { useTerminal } from '@/lib/terminal'
import { ShopDock } from '@/ui/ShopDock'
import { ShopRail, useWide } from '@/ui/ShopRail'

export const unstable_settings = { initialRouteName: 'index' }

/** The shop side of the app: Charge in the middle, orders and the stall on the left, the day and the shop on the right. */
export default function ShopTabs() {
  const terminal = useTerminal()
  // A counter tablet or a big terminal runs the shop as an OS, with a rail down the side.
  const wide = useWide()
  // An unpaired phone has nothing to charge with: send it to pairing.
  if (terminal.ready && !terminal.canCharge) return <Redirect href="/terminal/setup" />
  return (
    <Tabs
      tabBar={(props) => (wide ? <ShopRail {...props} /> : <ShopDock {...props} />)}
      screenOptions={{
        headerShown: false,
        animation: wide ? 'none' : 'shift',
        tabBarPosition: wide ? 'left' : 'bottom',
      }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="orders" />
      <Tabs.Screen name="stall" />
      <Tabs.Screen name="products" />
      <Tabs.Screen name="today" />
      <Tabs.Screen name="shop" />
    </Tabs>
  )
}
