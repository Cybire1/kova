import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { router, useFocusEffect } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  useWindowDimensions,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { type CatalogItem, posterLinkFor, stallLinkFor, updateItem, updateStall } from '@/lib/api'
import { useCatalog } from '@/lib/catalog'
import { useShop } from '@/lib/shop'
import { useStall } from '@/lib/stall'
import { colors } from '@/lib/theme'
import { Awning } from '@/ui/Awning'
import { Coin, Kovi } from '@/ui/art'
import { Icon, type IconName } from '@/ui/Icon'
import { Txt } from '@/ui/primitives'
import { shopDockClearance } from '@/ui/ShopDock'
import { about, dollars, ItemFace } from '@/ui/StallParts'
import { WalletBack } from '@/ui/WalletBack'

/**
 * Your stall: its sign, whether it's open, how to share it, and everything it sells. On a phone
 * paired to someone else's shop it is the menu, read-only.
 */
export default function StallTab() {
  const { owned } = useStall()
  return owned ? <OwnerStall /> : <ShopMenu />
}

function OwnerStall() {
  const { width } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const shop = useShop()
  const { stall, refresh, patch } = useStall()
  const catalog = useCatalog()
  const [refreshing, setRefreshing] = useState(false)
  const [copied, setCopied] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const saving = useRef<
    Partial<Record<'table_count' | 'loyalty_every', ReturnType<typeof setTimeout>>>
  >({})

  useEffect(
    () => () => {
      for (const timer of Object.values(saving.current)) clearTimeout(timer)
    },
    [],
  )

  useFocusEffect(
    useCallback(() => {
      void refresh().catch(() => {})
    }, [refresh]),
  )

  const onStall = useMemo(() => new Set(stall?.item_ids ?? []), [stall?.item_ids])
  const tillOnly = (catalog.items ?? []).filter((i) => !onStall.has(i.id))
  const items = stall?.items ?? []

  if (!stall)
    return (
      <View style={[styles.center, { backgroundColor: colors.paper }]}>
        <ActivityIndicator color={colors.ink} />
      </View>
    )

  const link = stallLinkFor(stall.slug)
  const toggleOpen = async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    const open = !stall.open
    patch({ ...stall, open })
    try {
      await updateStall(stall.id, { open })
    } catch (error) {
      patch({ ...stall, open: !open })
      setProblem(error instanceof Error ? error.message : 'That didn’t save. Try again.')
    }
  }

  const soldOut = async (item: CatalogItem, value: boolean) => {
    void Haptics.selectionAsync()
    patch({
      ...stall,
      items: stall.items.map((i) => (i.id === item.id ? { ...i, sold_out: value } : i)),
    })
    catalog.setItems(
      (list) => list?.map((i) => (i.id === item.id ? { ...i, sold_out: value } : i)) ?? list,
    )
    try {
      await updateItem(item.id, { sold_out: value })
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That didn’t save. Try again.')
      void refresh()
    }
  }

  /** Tables and the stamp card: shown at once, saved once the taps settle. */
  const setting = (field: 'table_count' | 'loyalty_every', value: number | null) => {
    setProblem(null)
    patch({ ...stall, [field]: value })
    clearTimeout(saving.current[field])
    saving.current[field] = setTimeout(() => {
      updateStall(stall.id, { [field]: value }).catch((error: Error) => {
        setProblem(error.message || 'That didn’t save. Try again.')
        void refresh()
      })
    }, 700)
  }
  const tables = stall.table_count ?? 0
  const every = stall.loyalty_every ?? 0

  const share = async () => {
    await Share.share({ message: `Order from ${stall.name} and pay in dollars with Kova: ${link}` })
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.paper }}
      contentContainerStyle={{ paddingBottom: shopDockClearance + insets.bottom }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true)
            await Promise.all([refresh().catch(() => {}), catalog.reload()])
            setRefreshing(false)
          }}
        />
      }
    >
      {/* The sign: the awning runs up under the status bar, like the canopy over a real stall. */}
      <View style={{ height: insets.top + 64, justifyContent: 'flex-end', overflow: 'hidden' }}>
        <Awning
          width={width}
          height={insets.top + 64}
          stripe={30}
          tone={stall.open ? 'coral' : 'teal'}
        />
        <View style={{ position: 'absolute', top: insets.top + 12, left: 16 }}>
          <WalletBack />
        </View>
      </View>
      <View style={styles.sign}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Txt weight="bold" size={30} style={{ letterSpacing: -1, lineHeight: 34 }}>
              {stall.name}
            </Txt>
            {stall.tagline ? (
              <Txt size={15} color={colors.muted} style={{ marginTop: 4, lineHeight: 21 }}>
                {stall.tagline}
              </Txt>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: stall.open }}
            accessibilityLabel={
              stall.open ? 'Open. Tap to close the stall' : 'Closed. Tap to open the stall'
            }
            onPress={toggleOpen}
            style={[
              styles.openSwitch,
              { backgroundColor: stall.open ? colors.tealSoft : colors.sunken },
            ]}
          >
            <View
              style={[
                styles.openKnob,
                { backgroundColor: stall.open ? colors.teal : colors.muted },
              ]}
            />
            <Txt weight="bold" size={14}>
              {stall.open ? 'Open' : 'Closed'}
            </Txt>
          </Pressable>
        </View>
        <Txt size={14} color={colors.muted} style={{ marginTop: 10, lineHeight: 20 }}>
          {stall.open
            ? 'People can order and pay now. Payments land in your wallet, in dollars.'
            : 'Closed. People can still see your stall, but can’t order until you open it.'}
        </Txt>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Copy your stall's link"
          onPress={async () => {
            await Clipboard.setStringAsync(link)
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
          style={styles.link}
        >
          <Icon name={copied ? 'check' : 'copy'} size={16} />
          <Txt weight="semi" size={14} numberOfLines={1} style={{ flexShrink: 1 }}>
            {copied ? 'Link copied' : link.replace(/^https?:\/\//, '')}
          </Txt>
        </Pressable>
      </View>

      <View style={styles.shareRow}>
        <ShareTile
          icon="scan"
          label="Show QR"
          onPress={() => router.push('/terminal/share')}
          tone={colors.tealSoft}
        />
        <ShareTile icon="share" label="Share link" onPress={share} tone={colors.coralSoft} />
        <ShareTile
          icon="print"
          label="Poster"
          onPress={() => void WebBrowser.openBrowserAsync(posterLinkFor(stall.slug))}
          tone={colors.surface}
        />
      </View>

      {problem ? (
        <Txt
          weight="medium"
          size={14}
          color={colors.danger}
          style={{ marginHorizontal: 20, marginTop: 10 }}
        >
          {problem}
        </Txt>
      ) : null}

      <View style={styles.sectionHead}>
        <View style={{ flex: 1 }}>
          <Txt weight="bold" size={22} style={{ letterSpacing: -0.5 }}>
            Tables and regulars
          </Txt>
          <Txt size={13} color={colors.muted}>
            Orders come to the table, and regulars get one free
          </Txt>
        </View>
      </View>
      <View style={styles.list}>
        <View style={[styles.setting, styles.rowRule]}>
          <View
            style={[
              styles.settingIcon,
              { backgroundColor: tables ? colors.coralSoft : colors.sunken },
            ]}
          >
            <Icon name="grid" size={20} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt weight="semi" size={16}>
              Tables
            </Txt>
            <Txt size={13} color={colors.muted} style={{ lineHeight: 18 }}>
              {tables
                ? `${tables} ${tables === 1 ? 'table' : 'tables'}, each with its own code. Orders show the table.`
                : 'Off. People collect at the counter.'}
            </Txt>
          </View>
          <Dial
            value={tables}
            name="tables"
            onChange={(n) => setting('table_count', n > 0 ? Math.min(200, n) : null)}
          />
        </View>
        {tables ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/terminal/share', params: { table: '1' } })}
            style={[styles.snapRow, { borderTopWidth: 0 }, styles.rowRule]}
          >
            <View style={[styles.snapIcon, { backgroundColor: colors.coralSoft }]}>
              <Icon name="scan" size={18} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt weight="semi" size={15}>
                Table codes
              </Txt>
              <Txt size={13} color={colors.muted}>
                Show, share or print a QR for each table
              </Txt>
            </View>
            <Icon name="arrow" size={20} />
          </Pressable>
        ) : null}
        <View style={styles.setting}>
          <View
            style={[
              styles.settingIcon,
              { backgroundColor: every ? colors.tealSoft : colors.sunken },
            ]}
          >
            <Icon name="sparkle" size={20} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt weight="semi" size={16}>
              Stamp card
            </Txt>
            <Txt size={13} color={colors.muted} style={{ lineHeight: 18 }}>
              {every
                ? `After ${every} paid orders, the next one’s cheapest item is free.`
                : 'Off. Reward regulars with a free item.'}
            </Txt>
          </View>
          <Dial
            value={every}
            name="orders per stamp card"
            onChange={(n) => setting('loyalty_every', n < 2 ? (every ? null : 2) : Math.min(20, n))}
          />
        </View>
        {every ? (
          <View
            style={styles.stampPreview}
            accessibilityLabel={`A stamp card of ${every}, then one free`}
          >
            {Array.from({ length: every }, (_, i) => i + 1).map((n) => (
              <View
                key={n}
                style={[styles.stampDot, n <= Math.ceil(every / 2) && styles.stampDotOn]}
              >
                {n <= Math.ceil(every / 2) ? <Coin size={16} /> : null}
              </View>
            ))}
            <View style={[styles.stampDot, styles.stampDotFree]}>
              <Icon name="sparkle" size={11} color={colors.white} />
            </View>
            <Txt size={12} color={colors.muted} style={{ marginLeft: 4 }}>
              No sign-up: the buyer’s wallet is the card
            </Txt>
          </View>
        ) : null}
      </View>

      <View style={styles.sectionHead}>
        <View style={{ flex: 1 }}>
          <Txt weight="bold" size={22} style={{ letterSpacing: -0.5 }}>
            On your stall
          </Txt>
          <Txt size={13} color={colors.muted}>
            {items.length === 0
              ? 'Nothing yet'
              : `${items.length} ${items.length === 1 ? 'item' : 'items'}, as buyers see them`}
          </Txt>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add an item"
          onPress={() => router.push('/terminal/item')}
          style={styles.addButton}
        >
          <Icon name="plus" size={18} color={colors.white} strokeWidth={2.4} />
          <Txt weight="semi" size={15} color={colors.white}>
            Add
          </Txt>
        </Pressable>
      </View>

      {items.length === 0 ? (
        <View style={styles.firstItems}>
          <Kovi pose="wave" size={120} />
          <Txt weight="semi" size={19} style={{ marginTop: 4, textAlign: 'center' }}>
            Put something on the counter
          </Txt>
          <Txt
            size={15}
            color={colors.muted}
            style={{ marginTop: 4, textAlign: 'center', lineHeight: 21 }}
          >
            Add items one by one with a photo and a price, or photograph your menu board and Kova
            fills it in.
          </Txt>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/terminal/item')}
              style={styles.bigChoice}
            >
              <Icon name="camera" size={22} />
              <Txt weight="semi" size={15}>
                Add an item
              </Txt>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/terminal/snap')}
              style={[styles.bigChoice, { backgroundColor: colors.tealSoft }]}
            >
              <Icon name="sparkle" size={22} />
              <Txt weight="semi" size={15}>
                Snap your menu
              </Txt>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.list}>
          {items.map((item, i) => (
            <ItemRow
              key={item.id}
              item={item}
              last={i === items.length - 1}
              onSoldOut={(v) => void soldOut(item, v)}
              currency={shop.currency}
            />
          ))}
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/terminal/snap')}
            style={styles.snapRow}
          >
            <View style={[styles.snapIcon]}>
              <Icon name="sparkle" size={18} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt weight="semi" size={15}>
                Snap your menu
              </Txt>
              <Txt size={13} color={colors.muted}>
                Add many items from one photo
              </Txt>
            </View>
            <Icon name="arrow" size={20} />
          </Pressable>
        </View>
      )}

      {tillOnly.length ? (
        <>
          <View style={styles.sectionHead}>
            <View style={{ flex: 1 }}>
              <Txt weight="bold" size={22} style={{ letterSpacing: -0.5 }}>
                Only at the till
              </Txt>
              <Txt size={13} color={colors.muted}>
                In your catalogue, not on your stall
              </Txt>
            </View>
          </View>
          <View style={styles.list}>
            {tillOnly.map((item, i) => (
              <ItemRow
                key={item.id}
                item={item}
                last={i === tillOnly.length - 1}
                currency={shop.currency}
              />
            ))}
          </View>
        </>
      ) : null}
    </ScrollView>
  )
}

function ItemRow({
  item,
  last,
  onSoldOut,
  currency,
}: {
  item: CatalogItem
  last: boolean
  onSoldOut?: (v: boolean) => void
  currency: ReturnType<typeof useShop>['currency']
}) {
  const local = about(item.price, currency)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Edit ${item.name}`}
      onPress={() => router.push({ pathname: '/terminal/item', params: { id: item.id } })}
      style={({ pressed }) => [styles.row, !last && styles.rowRule, pressed && { opacity: 0.7 }]}
    >
      <View style={{ opacity: item.sold_out ? 0.5 : 1 }}>
        <ItemFace item={item} size={48} />
      </View>
      <View style={{ flex: 1, opacity: item.sold_out ? 0.6 : 1 }}>
        <Txt weight="semi" size={16} numberOfLines={1}>
          {item.name}
        </Txt>
        <Txt size={13} color={colors.muted} numberOfLines={1}>
          {dollars(item.price)}
          {local ? `, ${local}` : ''}
          {item.barcode ? '  ' : ''}
        </Txt>
        {item.barcode ? (
          <View style={styles.barcodeTag}>
            <Icon name="barcode" size={12} />
            <Txt size={11} color={colors.onTint}>
              {item.barcode}
            </Txt>
          </View>
        ) : null}
      </View>
      {onSoldOut ? (
        <View style={{ alignItems: 'center', gap: 2 }}>
          <Switch
            value={!item.sold_out}
            onValueChange={(inStock) => onSoldOut(!inStock)}
            trackColor={{ true: colors.teal, false: colors.sunken }}
            accessibilityLabel={
              item.sold_out ? `${item.name} is sold out` : `${item.name} is in stock`
            }
          />
          <Txt size={11} color={colors.muted}>
            {item.sold_out ? 'Sold out' : 'In stock'}
          </Txt>
        </View>
      ) : (
        <Icon name="arrow" size={20} />
      )}
    </Pressable>
  )
}

/** Fewer, how many (or Off), more: for a setting where none means off. */
function Dial({
  value,
  name,
  onChange,
}: {
  value: number
  name: string
  onChange: (n: number) => void
}) {
  const step = (n: number) => {
    void Haptics.selectionAsync()
    onChange(n)
  }
  return (
    <View style={styles.dial}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Fewer ${name}`}
        hitSlop={6}
        disabled={!value}
        onPress={() => step(value - 1)}
        style={[styles.dialKey, !value && { opacity: 0.3 }]}
      >
        <Icon name="minus" size={15} strokeWidth={2.2} />
      </Pressable>
      <Txt
        weight="bold"
        size={value ? 15 : 13}
        style={{ minWidth: 28, textAlign: 'center' }}
        accessibilityLiveRegion="polite"
      >
        {value || 'Off'}
      </Txt>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`More ${name}`}
        hitSlop={6}
        onPress={() => step(value + 1)}
        style={styles.dialKey}
      >
        <Icon name="plus" size={15} strokeWidth={2.2} />
      </Pressable>
    </View>
  )
}

function ShareTile({
  icon,
  label,
  onPress,
  tone,
}: {
  icon: IconName
  label: string
  onPress: () => void
  tone: string
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        onPress()
      }}
      style={({ pressed }) => [
        styles.shareTile,
        { backgroundColor: tone },
        pressed && { transform: [{ scale: 0.96 }] },
      ]}
    >
      <View style={styles.shareIcon}>
        <Icon name={icon} size={20} />
      </View>
      <Txt weight="semi" size={14}>
        {label}
      </Txt>
    </Pressable>
  )
}

/** A terminal's view of the shop's catalogue: prices to quote, and what's sold out. */
function ShopMenu() {
  const insets = useSafeAreaInsets()
  const shop = useShop()
  const catalog = useCatalog()
  const items = catalog.items ?? []
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.paper }}
      contentContainerStyle={{
        paddingTop: insets.top + 8,
        paddingHorizontal: 20,
        paddingBottom: shopDockClearance + insets.bottom,
      }}
    >
      <Txt weight="bold" size={32} style={{ letterSpacing: -1 }}>
        Menu
      </Txt>
      <Txt size={14} color={colors.muted} style={{ marginTop: 4, lineHeight: 20 }}>
        Everything {shop.name} sells. Only the phone that opened the shop, or the Kova dashboard,
        can change it.
      </Txt>
      {catalog.items === null ? (
        <ActivityIndicator color={colors.ink} style={{ marginTop: 30 }} />
      ) : items.length === 0 ? (
        <View style={styles.firstItems}>
          <Kovi pose="sleep" size={120} />
          <Txt size={15} color={colors.muted} style={{ textAlign: 'center' }}>
            Nothing on the menu yet.
          </Txt>
        </View>
      ) : (
        <View style={[styles.list, { marginHorizontal: 0, marginTop: 16 }]}>
          {items.map((item, i) => (
            <View key={item.id} style={[styles.row, i < items.length - 1 && styles.rowRule]}>
              <ItemFace item={item} size={46} />
              <View style={{ flex: 1 }}>
                <Txt weight="semi" size={16} numberOfLines={1}>
                  {item.name}
                </Txt>
                <Txt size={13} color={colors.muted}>
                  {dollars(item.price)}
                  {about(item.price, shop.currency) ? `, ${about(item.price, shop.currency)}` : ''}
                </Txt>
              </View>
              {item.sold_out ? (
                <View style={styles.soldChip}>
                  <Txt weight="semi" size={12}>
                    Sold out
                  </Txt>
                </View>
              ) : null}
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  sign: { paddingHorizontal: 20, paddingTop: 16 },
  openSwitch: {
    height: 40,
    paddingLeft: 6,
    paddingRight: 14,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: colors.ink,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  openKnob: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.ink },
  link: {
    marginTop: 12,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  shareRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, marginTop: 16 },
  shareTile: {
    flex: 1,
    height: 88,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  shareIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginTop: 28,
    marginBottom: 10,
  },
  addButton: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: colors.ink,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  list: {
    marginHorizontal: 20,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  rowRule: { borderBottomWidth: 1, borderColor: colors.sunken },
  barcodeTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
    alignSelf: 'flex-start',
    paddingHorizontal: 7,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.sunken,
  },
  snapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderTopWidth: 2,
    borderColor: colors.sunken,
    backgroundColor: colors.paper,
  },
  snapIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.tealSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  setting: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  settingIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dial: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 36,
    paddingHorizontal: 1,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.white,
  },
  dialKey: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  stampPreview: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingBottom: 12,
    marginTop: -2,
  },
  stampDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.ink,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stampDotOn: { borderWidth: 0 },
  stampDotFree: { borderStyle: 'solid', backgroundColor: colors.coral },
  firstItems: { alignItems: 'center', paddingHorizontal: 28, paddingTop: 12 },
  bigChoice: {
    width: 150,
    height: 96,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  soldChip: {
    height: 26,
    paddingHorizontal: 10,
    borderRadius: 13,
    backgroundColor: colors.sunken,
    justifyContent: 'center',
  },
})
