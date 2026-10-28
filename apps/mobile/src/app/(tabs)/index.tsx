import { formatMon, monInDollars } from '@kova/monad'
import { Image } from 'expo-image'
import { router, useLocalSearchParams } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { useCallback, useEffect, useState } from 'react'
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Circle } from 'react-native-svg'
import { getSummary, naira } from '@/lib/api'
import { getMonUsd } from '@/lib/chain'
import { isTestnet, webUrl } from '@/lib/config'
import { useOffline } from '@/lib/offline'
import { usePrefs } from '@/lib/prefs'
import { usePrivate } from '@/lib/private'
import { useStall } from '@/lib/stall'
import { useTakings } from '@/lib/takings'
import { useTerminal } from '@/lib/terminal'
import { colors } from '@/lib/theme'
import { isUnnamed, useWallet } from '@/lib/wallet'
import { ActionTile } from '@/ui/ActionTile'
import { Awning } from '@/ui/Awning'
import { Avatar, Flyer, ShopBadge } from '@/ui/art'
import { BalanceCard } from '@/ui/BalanceCard'
import { dockClearance } from '@/ui/Dock'
import { EntryRow } from '@/ui/EntryRow'
import { Icon } from '@/ui/Icon'
import { KeyIcon, KeysOnHome } from '@/ui/Keys'
import { MoneyTiles } from '@/ui/Money'
import { MonWalletCard } from '@/ui/MonWalletCard'
import { OfflinePill, OfflineRow } from '@/ui/Offline'
import { RoundButton, Txt } from '@/ui/primitives'
import { dollars } from '@/ui/StallParts'
import { StocksCard } from '@/ui/Stocks'

/**
 * Home is for paying, but you should never have to look for your money. The balance opens the
 * screen on a solid teal card, since money at rest is teal across Kova; Pay sits right beneath it,
 * Send and Request beside Pay, and the people you pay are one tap away.
 */
/** Four banks people know, bundled so Cash out shows them at once, even offline. */
const BANK_LOGOS = [
  { id: 'opay', logo: require('../../../assets/banks/opay.png') },
  { id: 'moniepoint', logo: require('../../../assets/banks/moniepoint.png') },
  { id: 'gtbank', logo: require('../../../assets/banks/gtbank.png') },
  { id: 'kuda', logo: require('../../../assets/banks/kuda.png') },
]

export default function Home() {
  const { profile, balance, monBalance, activity, contacts, refresh } = useWallet()
  // MON counts in the total at Chainlink's MON / USD price on Monad, read again with the balance.
  const [monUsd, setMonUsd] = useState<number | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: a fresh price whenever the balance moves
  useEffect(() => {
    void getMonUsd()
      .then(setMonUsd)
      .catch(() => setMonUsd(null))
  }, [balance, monBalance])
  const mon =
    monBalance && monUsd
      ? {
          amount: monBalance,
          value: monInDollars(monBalance, monUsd),
          label: formatMon(monBalance),
        }
      : null
  // Development only: `split=1` opens Home with the balance's split shown, for screenshots.
  const { split } = useLocalSearchParams<{ split?: string }>()
  const insets = useSafeAreaInsets()
  const [refreshing, setRefreshing] = useState(false)
  const takings = useTakings()
  const privately = usePrivate()
  const offline = useOffline()
  const { setMode } = usePrefs()
  const { refresh: refreshTakings } = takings
  const { refresh: refreshPrivate } = privately

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await Promise.all([refresh(), refreshTakings(), refreshPrivate()])
    setRefreshing(false)
  }, [refresh, refreshTakings, refreshPrivate])

  // Cash out from home: to a bank in naira, in the app, when this server has naira on; otherwise
  // Ramp's off-ramp on the web, as Profile offers it (mainnet).
  const [nairaOn, setNairaOn] = useState<boolean | null>(null)
  useEffect(() => {
    void naira.info().then((info) => setNairaOn(info.enabled))
  }, [])
  const ramp = nairaOn === false && !isTestnet
  const cashOut = useCallback(() => {
    if (ramp) void WebBrowser.openBrowserAsync(`${webUrl}/wallet/cash-out`)
    else router.push('/cash-out')
  }, [ramp])

  if (!profile) return null
  const empty = balance === 0n && !(monBalance && monBalance > 0n)

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.paper }}
      contentContainerStyle={{
        paddingTop: insets.top + 8,
        paddingBottom: dockClearance + insets.bottom,
        paddingHorizontal: 20,
      }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Profile"
          onPress={() => router.push('/(tabs)/profile')}
        >
          <Avatar name={profile.name} id={profile.address} size={38} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Txt size={13} color={colors.muted}>
            Hello
          </Txt>
          <Txt weight="semi" size={18} style={{ letterSpacing: -0.3 }}>
            {profile.name.split(' ')[0]}
          </Txt>
        </View>
        <RoundButton
          icon="bell"
          label="Activity"
          size={36}
          onPress={() => router.push('/(tabs)/activity')}
        />
      </View>

      <OfflinePill />

      <BalanceCard
        balance={balance}
        currency={profile.currency}
        takings={
          takings.owner && takings.waiting > 0n
            ? {
                amount: takings.waiting,
                onPress: () => {
                  setMode('terminal')
                  router.replace('/terminal/today')
                },
              }
            : null
        }
        privateAmount={privately.keysHere ? privately.waiting : 0n}
        mon={mon}
        splitOpen={__DEV__ && split === '1'}
        onPrivate={() => router.push('/private')}
        waiting={
          offline.waiting.length > 0
            ? {
                out: offline.outWaiting,
                in: offline.inWaiting,
                onPress: () => router.push('/(tabs)/activity'),
              }
            : null
        }
      />

      <MonWalletCard usd={mon?.value ?? null} />

      <View style={styles.hero}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Pay. Scan or pay a link"
          onPress={() => router.push('/scan')}
          style={({ pressed }) => [styles.pay, pressed && { transform: [{ scale: 0.98 }] }]}
        >
          <Svg width={92} height={92} viewBox="-46 -46 92 92" style={styles.waves}>
            <Circle r={40} fill="none" stroke={colors.white} strokeOpacity={0.12} strokeWidth={2} />
            <Circle r={26} fill="none" stroke={colors.white} strokeOpacity={0.18} strokeWidth={2} />
            <Circle r={12} fill="none" stroke={colors.white} strokeOpacity={0.26} strokeWidth={2} />
          </Svg>
          <View style={styles.payTop}>
            <View style={[styles.payIcon, { backgroundColor: colors.coral }]}>
              <Icon name="scan" color={colors.white} />
            </View>
          </View>
          <View>
            <Txt weight="bold" size={34} color={colors.white} style={{ letterSpacing: -1 }}>
              Pay
            </Txt>
            <Txt size={12} color={colors.onInk}>
              Scan or pay a link
            </Txt>
          </View>
        </Pressable>
        <View style={{ flex: 1, gap: 12 }}>
          <ActionTile kind="send" onPress={() => router.push('/send')} />
          <ActionTile kind="request" onPress={() => router.push('/request')} />
        </View>
      </View>

      {/* Cash out, where everyone sees it: to any Nigerian bank in naira, or Ramp's off-ramp. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Cash out to any bank"
        onPress={cashOut}
        style={({ pressed }) => [styles.cashOut, pressed && { transform: [{ scale: 0.98 }] }]}
      >
        <View style={{ flex: 1, gap: 8 }}>
          <Txt weight="bold" size={17} color={colors.white} style={{ letterSpacing: -0.3 }}>
            Cash out to any bank
          </Txt>
          <View style={styles.cashOutRow}>
            {ramp ? null : (
              <View style={styles.cashOutBanks}>
                {BANK_LOGOS.map((bank) => (
                  <Image key={bank.id} source={bank.logo} style={styles.cashOutBank} />
                ))}
              </View>
            )}
            <Txt weight="semi" size={13} color={colors.white} style={{ opacity: 0.9 }}>
              {ramp ? 'To your bank or card' : 'Naira, in seconds'}
            </Txt>
          </View>
        </View>
        <View style={styles.cashOutGo}>
          <Icon name="arrow" size={18} color={colors.ink} />
        </View>
      </Pressable>

      <KeysOnHome />

      <ShopCard />

      <StocksCard />

      <MoneyTiles />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Keys. Allowances, your team and AI agents"
        onPress={() => router.push('/keys')}
        style={({ pressed }) => [styles.keysRow, pressed && { transform: [{ scale: 0.98 }] }]}
      >
        <KeyIcon name="sparkle" tone={colors.coralSoft} />
        <View style={{ flex: 1 }}>
          <Txt weight="bold" size={18} style={{ letterSpacing: -0.3 }}>
            Keys
          </Txt>
          <Txt
            size={12}
            color={colors.onTint}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.85}
          >
            Allowances, your team and AI agents
          </Txt>
        </View>
        <Icon name="arrow" size={18} />
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Travel. Flights and hotels, paid in dollars"
        onPress={() => router.push('/travel')}
        style={({ pressed }) => [styles.travel, pressed && { transform: [{ scale: 0.98 }] }]}
      >
        <View style={{ flex: 1 }}>
          <Txt weight="bold" size={20} style={{ letterSpacing: -0.4 }}>
            Travel
          </Txt>
          <Txt
            size={12}
            color={colors.onTint}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.85}
          >
            Flights and hotels, paid in dollars
          </Txt>
        </View>
        {/* The plane flies over the top right, clear of the line of text below it. */}
        <View style={styles.travelPlane} pointerEvents="none">
          <Flyer size={60} />
        </View>
        <View style={styles.travelGo}>
          <Icon name="arrow" color={colors.white} />
        </View>
      </Pressable>

      {empty ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/add-money')}
          style={styles.notice}
        >
          <View style={[styles.noticeIcon, { backgroundColor: colors.tealLight }]}>
            <Icon name="plus" />
          </View>
          <View style={{ flex: 1 }}>
            <Txt weight="semi" size={15}>
              {isTestnet ? 'Add test dollars to start' : 'Add money to start paying'}
            </Txt>
            <Txt size={13} color={colors.onTint}>
              {isTestnet
                ? '$5 a day, free on Monad testnet. Arrives in about a second.'
                : 'Deposit crypto, or add money by card or bank.'}
            </Txt>
          </View>
          <View style={styles.noticeCta}>
            <Txt weight="semi" size={15} color={colors.white}>
              Add
            </Txt>
          </View>
        </Pressable>
      ) : null}

      <Txt weight="semi" size={18} style={styles.section}>
        Send again
      </Txt>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 14, paddingRight: 20 }}
        style={{ marginHorizontal: -20, paddingLeft: 20 }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Pay someone new"
          onPress={() => router.push('/send')}
          style={styles.person}
        >
          <View style={styles.newPerson}>
            <Icon name="plus" />
          </View>
          <Txt weight="medium" size={13}>
            New
          </Txt>
        </Pressable>
        {contacts.slice(0, 8).map((c) => (
          <Pressable
            key={c.address}
            accessibilityRole="button"
            accessibilityLabel={`Send to ${c.name}`}
            onPress={() =>
              router.push({
                pathname: '/send/[to]',
                params: { to: c.address, name: c.name, cur: c.currency ?? '' },
              })
            }
            style={styles.person}
          >
            <Avatar name={c.name} id={c.address} size={48} />
            <Txt weight="medium" size={13} numberOfLines={1}>
              {isUnnamed(c.name) ? c.address.slice(0, 6) : c.name.split(' ')[0]}
            </Txt>
          </Pressable>
        ))}
      </ScrollView>

      <View style={[styles.sectionRow]}>
        <Txt weight="semi" size={18}>
          Recent
        </Txt>
        {activity.length > 3 ? (
          <Pressable
            accessibilityRole="link"
            onPress={() => router.push('/(tabs)/activity')}
            hitSlop={10}
          >
            <Txt size={14} color={colors.muted} style={{ textDecorationLine: 'underline' }}>
              See all
            </Txt>
          </Pressable>
        ) : null}
      </View>
      {offline.waiting.slice(0, 3).map((item) => (
        <OfflineRow key={item.id} item={item} />
      ))}
      {activity.length === 0 && offline.waiting.length === 0 ? (
        <Txt size={15} color={colors.muted} style={{ marginTop: 6, lineHeight: 22 }}>
          Your payments show up here the moment they land.
        </Txt>
      ) : (
        activity.slice(0, 3).map((entry) => <EntryRow key={entry.id} entry={entry} />)
      )}
    </ScrollView>
  )
}

/**
 * Your shop, one of the wallet's features: the way into shop mode, as on the web. With a shop it
 * shows today's takings and opens the shop; on a phone that's a shop's till it opens the till;
 * with neither, it opens a shop, owned by this wallet.
 */
function ShopCard() {
  const stall = useStall()
  const terminal = useTerminal()
  const { setMode } = usePrefs()
  const { width } = useWindowDimensions()
  const [today, setToday] = useState<{ total: string; count: number } | null>(null)

  useEffect(() => {
    if (!terminal.paired) return
    let live = true
    getSummary()
      .then((s) => live && setToday(s.today ?? null))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [terminal.paired])

  const owned = stall.owned
  const till = !owned ? terminal.paired : null
  const shop = stall.stall
  const enter = (to: '/terminal' | '/terminal/today') => {
    setMode('terminal')
    router.replace(to)
  }
  const card =
    owned && stall.complete
      ? {
          label: 'Your shop',
          title: owned.name,
          line: today
            ? today.count > 0
              ? `${dollars(today.total)} today, ${today.count} ${today.count === 1 ? 'sale' : 'sales'}`
              : 'No sales yet today'
            : shop
              ? `${shop.open ? 'Open' : 'Closed'}, ${shop.items.length} ${shop.items.length === 1 ? 'item' : 'items'}`
              : 'Your shop',
          go: () => enter('/terminal/today'),
        }
      : till
        ? {
            label: 'Your till',
            title: till.merchantName,
            line: `This phone is ${till.name}`,
            go: () => enter('/terminal'),
          }
        : owned
          ? {
              label: 'Your shop',
              title: 'Finish your shop',
              line: 'A step or two left',
              go: () => router.push('/open-stall'),
            }
          : {
              label: 'Run a shop?',
              title: 'Open a shop',
              line: 'Take payments into this wallet',
              go: () => router.push('/open-stall'),
            }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${card.title}. ${card.line}`}
      onPress={card.go}
      style={({ pressed }) => [styles.shop, pressed && { transform: [{ scale: 0.98 }] }]}
    >
      <Awning
        width={width - 44}
        height={22}
        stripe={16}
        tone={shop && !shop.open ? 'teal' : 'coral'}
      />
      <View style={styles.shopBody}>
        <ShopBadge size={42} />
        <View style={{ flex: 1 }}>
          <Txt size={12} weight="semi" color={colors.onTint}>
            {card.label}
          </Txt>
          <Txt weight="bold" size={19} numberOfLines={1} style={{ letterSpacing: -0.4 }}>
            {card.title}
          </Txt>
          <Txt size={13} color={colors.onTint} numberOfLines={1}>
            {card.line}
          </Txt>
        </View>
        <View style={styles.shopGo}>
          <Icon name="arrow" color={colors.white} />
        </View>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  keysRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
  },
  shop: {
    marginTop: 12,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  shopBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 14,
    paddingRight: 12,
    paddingTop: 8,
    paddingBottom: 12,
  },
  shopGo: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 46 },
  hero: { flexDirection: 'row', gap: 12, height: 182, marginTop: 12 },
  pay: {
    flex: 1.35,
    borderRadius: 30,
    backgroundColor: colors.ink,
    padding: 18,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  payIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waves: { position: 'absolute', right: -14, top: 40 },
  payTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cashOut: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingLeft: 18,
    paddingRight: 12,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.coral,
  },
  cashOutRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cashOutBanks: { flexDirection: 'row', gap: 4 },
  cashOutBank: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.white },
  cashOutGo: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  small: { flex: 1, padding: 14, paddingHorizontal: 16, justifyContent: 'space-between' },
  travel: {
    marginTop: 12,
    height: 66,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.tealSoft,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 18,
    paddingRight: 12,
    overflow: 'hidden',
  },
  travelPlane: { position: 'absolute', right: 58, top: -6, transform: [{ rotate: '-6deg' }] },
  travelGo: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notice: {
    marginTop: 22,
    borderRadius: 24,
    backgroundColor: colors.sunken,
    borderWidth: 2,
    borderColor: colors.ink,
    padding: 12,
    paddingLeft: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  noticeIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noticeCta: {
    height: 36,
    paddingHorizontal: 16,
    borderRadius: 18,
    backgroundColor: colors.ink,
    justifyContent: 'center',
  },
  section: { marginTop: 26, marginBottom: 12 },
  sectionRow: {
    marginTop: 26,
    marginBottom: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  person: { alignItems: 'center', gap: 6, width: 54 },
  newPerson: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.ink,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
})
