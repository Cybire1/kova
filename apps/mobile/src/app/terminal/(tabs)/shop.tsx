import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { type ReactNode, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { webUrl } from '@/lib/config'
import { currencyInfo, type DisplayCurrency, formatUsd } from '@/lib/money'
import { usePrefs } from '@/lib/prefs'
import { useShop } from '@/lib/shop'
import { useStall } from '@/lib/stall'
import { useTakings } from '@/lib/takings'
import { useTerminal } from '@/lib/terminal'
import { colors } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { ShopBadge } from '@/ui/art'
import { Icon, type IconName } from '@/ui/Icon'
import { Txt } from '@/ui/primitives'
import { shopDockClearance } from '@/ui/ShopDock'
import { booksMessage, useHome } from '@/ui/Takings'
import { WalletBack } from '@/ui/WalletBack'

const priceCurrencies: DisplayCurrency[] = ['USD', 'EUR', 'GBP', 'NGN', 'KES', 'MXN']

/** The shop, and this phone's place in it: which terminal it is, how it prices, and the way back to your wallet. */
export default function ShopTab() {
  const insets = useSafeAreaInsets()
  const shop = useShop()
  const terminal = useTerminal()
  const { owned, revealKey, ownerLinked, linkOwner } = useStall()
  const { status, profile } = useWallet()
  const { setMode } = usePrefs()
  const [confirmUnpair, setConfirmUnpair] = useState(false)
  const [keyCopied, setKeyCopied] = useState(false)
  const [linking, setLinking] = useState<'idle' | 'working' | 'failed'>('idle')

  const copyKey = async () => {
    const key = await revealKey()
    if (!key) return
    await Clipboard.setStringAsync(key)
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    setKeyCopied(true)
    // Don't leave the key sitting on the clipboard.
    setTimeout(() => {
      void Clipboard.getStringAsync().then((text) => text === key && Clipboard.setStringAsync(''))
      setKeyCopied(false)
    }, 60_000)
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.paper }}
      contentContainerStyle={{
        paddingTop: insets.top + 8,
        paddingHorizontal: 20,
        paddingBottom: shopDockClearance + insets.bottom,
      }}
    >
      <View style={{ marginBottom: 10 }}>
        <WalletBack />
      </View>
      <Txt weight="bold" size={32} style={{ letterSpacing: -1 }}>
        Shop
      </Txt>

      <View style={styles.pass}>
        <View style={styles.passTop}>
          <View style={styles.badge}>
            <ShopBadge size={60} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt
              weight="bold"
              size={22}
              color={colors.white}
              numberOfLines={1}
              style={{ letterSpacing: -0.4 }}
            >
              {shop.name}
            </Txt>
            <Txt size={13} color={colors.onInk} numberOfLines={1}>
              {owned ? 'Your shop' : `Paired as ${shop.terminal}`}
            </Txt>
          </View>
        </View>
        <View style={styles.passFacts}>
          <Fact label="This phone" value={shop.terminal} />
          <Fact
            label="Settles to"
            value={
              owned && profile
                ? `Your wallet, ${profile.address.slice(0, 6)}…${profile.address.slice(-4)}`
                : 'The shop’s wallet'
            }
          />
          <Fact label="Card fees" value="None" last />
        </View>
      </View>

      {owned ? <TakingsGroup /> : null}

      {owned ? (
        <Group title="Business">
          <Row
            icon="chart"
            label="Business"
            value="This month’s payroll, suppliers and your team"
            onPress={() => router.push('/terminal/business')}
          />
          <Row
            icon="lock"
            label="Payroll"
            value="Pay everyone privately with one Face ID"
            onPress={() => router.push('/terminal/payroll')}
          />
          <Row
            icon="web"
            label="Suppliers"
            value="Pay anyone, anywhere, in seconds"
            onPress={() => router.push('/terminal/suppliers')}
          />
          <Row
            icon="user"
            label="Team"
            value="Who can spend the business’s dollars"
            onPress={() => router.push('/terminal/team')}
            last
          />
        </Group>
      ) : null}

      <Group title="Prices">
        <View style={styles.pad}>
          <Txt size={14} color={colors.muted} style={{ lineHeight: 20 }}>
            The keypad takes prices in this currency. Customers always pay the dollar amount, at a
            reference rate they can see.
          </Txt>
          <View style={styles.chips}>
            {priceCurrencies.map((c) => {
              const on = c === shop.currency
              return (
                <Pressable
                  key={c}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={currencyInfo[c].name}
                  onPress={() => {
                    void Haptics.selectionAsync()
                    shop.setCurrency(c)
                  }}
                  style={[styles.chip, on && styles.chipOn]}
                >
                  <Txt weight="semi" size={14} color={on ? colors.white : colors.ink}>
                    {currencyInfo[c].symbol} {c}
                  </Txt>
                </Pressable>
              )
            })}
          </View>
        </View>
      </Group>

      {owned ? (
        <Group title="On a computer">
          {ownerLinked === false ? (
            <Row
              icon="face"
              label={
                linking === 'working'
                  ? 'Waiting for Face ID…'
                  : linking === 'failed'
                    ? 'That didn’t work. Try again'
                    : 'Sign in on the web with Face ID'
              }
              value={`Your passkey opens ${shop.name} at mykova.app`}
              onPress={async () => {
                if (linking === 'working') return
                setLinking('working')
                try {
                  await linkOwner()
                  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
                  setLinking('idle')
                } catch {
                  setLinking('failed')
                }
              }}
            />
          ) : null}
          <Row
            icon="web"
            label="Open your shop on the web"
            value={
              ownerLinked
                ? 'Your passkey signs you in at mykova.app'
                : 'Payments, stalls and terminals on a big screen'
            }
            onPress={() => void WebBrowser.openBrowserAsync(`${webUrl}/wallet`)}
          />
          <Row
            icon="lock"
            label={keyCopied ? 'Key copied for one minute' : 'Copy your shop key'}
            value="Sign in to the dashboard with it. Face ID first."
            onPress={copyKey}
            last
          />
        </Group>
      ) : null}

      <Group title="This phone">
        {status === 'ready' ? (
          <Row
            icon="swap"
            label="Switch to my wallet"
            value="Pay and send as yourself"
            onPress={() => {
              setMode('pay')
              router.replace('/')
            }}
            last={!terminal.paired}
          />
        ) : null}
        {terminal.paired ? (
          confirmUnpair ? (
            <View style={styles.pad}>
              <Txt weight="semi" size={16}>
                Stop taking payments on this phone?
              </Txt>
              <Txt size={14} color={colors.muted} style={{ marginTop: 4, lineHeight: 20 }}>
                {owned
                  ? 'Its terminal key stops working. You still own the shop, and can make this phone its till again.'
                  : `Its key stops working at once. To use it again, pair it with a new code from ${shop.name}.`}
              </Txt>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setConfirmUnpair(false)}
                  style={[styles.small, { backgroundColor: colors.surface }]}
                >
                  <Txt weight="semi" size={15}>
                    Keep it
                  </Txt>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={async () => {
                    await terminal.unpair()
                    router.replace('/terminal/setup')
                  }}
                  style={[
                    styles.small,
                    { backgroundColor: colors.danger, borderColor: colors.danger },
                  ]}
                >
                  <Txt weight="semi" size={15} color={colors.white}>
                    Unpair
                  </Txt>
                </Pressable>
              </View>
            </View>
          ) : (
            <Row
              icon="terminal"
              label={`Unpair ${terminal.paired.name}`}
              value="This phone stops taking payments"
              danger
              onPress={() => setConfirmUnpair(true)}
              last
            />
          )
        ) : null}
      </Group>
    </ScrollView>
  )
}

/**
 * Private takings: the switch, said plainly, and what comes with it once it's on: every private
 * sale, and the accountant's read-only view. Turning it off asks first, and keeps the keys, since
 * sales already private stay the shop's to move.
 */
function TakingsGroup() {
  const t = useTakings()
  const shop = useShop()
  const home = useHome()
  const [confirmOff, setConfirmOff] = useState(false)
  const switching = t.working === 'on' || t.working === 'off'
  const link = t.booksLink(shop.name)
  const problem =
    t.problem && (t.problem.during === 'on' || t.problem.during === 'off') ? t.problem.text : null

  return (
    <Group title="Takings">
      <View
        style={[
          styles.private,
          (confirmOff || problem || t.enabled || t.sales.length > 0) && styles.rowRule,
        ]}
      >
        <View
          style={[styles.rowIcon, { backgroundColor: t.enabled ? colors.coral : colors.sunken }]}
        >
          <Icon name="lock" size={19} color={t.enabled ? colors.white : colors.ink} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt weight="semi" size={16}>
            Private takings
          </Txt>
          <Txt size={13} color={colors.muted} style={{ lineHeight: 18, marginTop: 2 }}>
            Every sale goes to its own address that only your shop can open. Nobody on Monad can add
            up your takings.
          </Txt>
        </View>
        {switching ? (
          <ActivityIndicator color={colors.ink} style={{ width: 51 }} />
        ) : (
          <Switch
            value={t.enabled}
            disabled={!t.ready || t.working !== null}
            onValueChange={(on) => {
              void Haptics.selectionAsync()
              if (on) {
                setConfirmOff(false)
                void t.turnOn()
              } else setConfirmOff(true)
            }}
            trackColor={{ true: colors.teal, false: colors.sunken }}
            accessibilityLabel={t.enabled ? 'Private takings are on' : 'Private takings are off'}
          />
        )}
      </View>
      {confirmOff ? (
        <View style={[styles.pad, styles.rowRule]}>
          <Txt weight="semi" size={16}>
            Turn private takings off?
          </Txt>
          <Txt size={14} color={colors.muted} style={{ marginTop: 4, lineHeight: 20 }}>
            New sales will go straight to {home.long} again, where anyone on Monad can see them.
            Private sales you already have stay yours to move.
          </Txt>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setConfirmOff(false)}
              style={[styles.small, { backgroundColor: colors.tealSoft }]}
            >
              <Txt weight="semi" size={15}>
                Keep it private
              </Txt>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setConfirmOff(false)
                void t.turnOff()
              }}
              style={[styles.small, { backgroundColor: colors.surface }]}
            >
              <Txt weight="semi" size={15}>
                Turn off
              </Txt>
            </Pressable>
          </View>
        </View>
      ) : null}
      {problem ? (
        <View style={[styles.pad, (t.enabled || t.sales.length > 0) && styles.rowRule]}>
          <Txt weight="medium" size={14} color={colors.danger}>
            {problem}
          </Txt>
        </View>
      ) : null}
      {t.enabled || t.sales.length > 0 ? (
        <Row
          icon="list"
          label="See private takings"
          value={
            t.waitingCount
              ? `${formatUsd(t.waiting)} waiting at ${t.waitingCount} ${t.waitingCount === 1 ? 'address' : 'addresses'}`
              : t.sales.length
                ? `${t.sales.length} private ${t.sales.length === 1 ? 'sale' : 'sales'}, all moved to ${home.long}`
                : 'Each sale, at its own address'
          }
          onPress={() => router.push('/terminal/takings')}
          last={!link}
        />
      ) : null}
      {(t.enabled || t.sales.length > 0) && link ? (
        <Row
          icon="eye"
          label="Share an accountant view"
          value="Shows every sale. Can’t move money. Share it only with your accountant."
          onPress={() => void Share.share({ message: booksMessage(shop.name, link) })}
          last
        />
      ) : null}
    </Group>
  )
}

function Fact({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.fact, !last && styles.factRule]}>
      <Txt size={13} color={colors.onInk}>
        {label}
      </Txt>
      <Txt
        weight="semi"
        size={14}
        color={colors.white}
        numberOfLines={1}
        style={{ flexShrink: 1, textAlign: 'right' }}
      >
        {value}
      </Txt>
    </View>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ marginTop: 24 }}>
      <Txt weight="semi" size={13} color={colors.muted} style={{ marginBottom: 8, marginLeft: 4 }}>
        {title}
      </Txt>
      <View style={styles.group}>{children}</View>
    </View>
  )
}

function Row({
  icon,
  label,
  value,
  onPress,
  last,
  danger,
}: {
  icon: IconName
  label: string
  value?: string
  onPress: () => void
  last?: boolean
  danger?: boolean
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.row, !last && styles.rowRule, pressed && { opacity: 0.7 }]}
    >
      <View
        style={[styles.rowIcon, { backgroundColor: danger ? colors.coralSoft : colors.tealSoft }]}
      >
        <Icon name={icon} size={19} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt weight="semi" size={16} color={danger ? colors.danger : colors.ink}>
          {label}
        </Txt>
        {value ? (
          <Txt size={13} color={colors.muted} numberOfLines={2}>
            {value}
          </Txt>
        ) : null}
      </View>
      <Icon name="arrow" size={20} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  pass: { marginTop: 16, borderRadius: 28, backgroundColor: colors.ink, overflow: 'hidden' },
  passTop: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18, paddingBottom: 14 },
  badge: {
    borderRadius: 36,
    borderWidth: 3,
    borderColor: colors.yellow,
    padding: 2,
    backgroundColor: colors.surface,
  },
  passFacts: { marginHorizontal: 18, marginBottom: 12 },
  fact: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  factRule: { borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  group: {
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  pad: { padding: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  chip: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.ink,
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: colors.ink },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowRule: { borderBottomWidth: 1, borderColor: colors.sunken },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  private: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  small: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
