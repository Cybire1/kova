import { useIsFocused } from '@react-navigation/native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import * as Haptics from 'expo-haptics'
import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  type BarcodeLookup,
  type CatalogItem,
  createCharge,
  lookupBarcode,
  ringUp,
} from '@/lib/api'
import { sameBarcode, useCatalog } from '@/lib/catalog'
import { settlementToken } from '@/lib/config'
import {
  applyKey,
  currencyInfo,
  type DisplayCurrency,
  formatLocal,
  groupTyped,
  localToUsd,
} from '@/lib/money'
import { useShop } from '@/lib/shop'
import { useStall } from '@/lib/stall'
import { load, save } from '@/lib/storage'
import { colors, fonts } from '@/lib/theme'
import { Kovi } from '@/ui/art'
import { Icon, type IconName } from '@/ui/Icon'
import { Keypad } from '@/ui/Keypad'
import { PillButton, Screen, Txt } from '@/ui/primitives'
import { shopDockClearance } from '@/ui/ShopDock'
import { RAIL, useWide } from '@/ui/ShopRail'
import { about, dollars, ItemFace, Stepper } from '@/ui/StallParts'
import { WalletBack } from '@/ui/WalletBack'

const priceCurrencies: DisplayCurrency[] = ['USD', 'EUR', 'GBP', 'NGN', 'KES', 'MXN']
/** Height the price, its dollar line and the note need above the keypad. */
const ENTRY = 158
type Mode = 'keypad' | 'items' | 'scan'
type Basket = Record<string, number>

/** Development only: a dev link's cart fills once per app run. */
let devCartFilled = false

const modes: { id: Mode; label: string; icon: IconName }[] = [
  { id: 'keypad', label: 'Keypad', icon: 'keypad' },
  { id: 'items', label: 'Items', icon: 'grid' },
  { id: 'scan', label: 'Scan', icon: 'barcode' },
]

/**
 * The counter. Three ways to ring up a sale: type a price, tap what's being bought, or scan
 * its barcode. Items and scans share one basket, priced by Kova from the shop's catalogue;
 * a typed price is charged as it is. Either way the customer sees one amount in dollars.
 */
export default function Till() {
  const shop = useShop()
  const insets = useSafeAreaInsets()
  const [mode, setModeState] = useState<Mode>('keypad')
  const [basket, setBasket] = useState<Basket>({})
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const catalog = useCatalog()
  const wide = useWide()
  const { width } = useWindowDimensions()
  /** On a wide screen the cart stands beside the grid, so the grid gets what's left. */
  const CART = 420
  const gridWidth = wide ? width - RAIL - CART : width

  useEffect(() => {
    void load<Mode>('kova.till.mode', 'keypad').then(setModeState)
  }, [])
  const setMode = (next: Mode) => {
    void Haptics.selectionAsync()
    setModeState(next)
    setProblem(null)
    void save('kova.till.mode', next)
  }

  const byId = useMemo(() => new Map((catalog.items ?? []).map((i) => [i.id, i])), [catalog.items])

  // Development only: a dev link can fill the cart ("Croissant*2;Flat white*1"), so films and
  // screenshots show a sale in progress.
  const { cart: devCart } = useLocalSearchParams<{ cart?: string }>()
  useEffect(() => {
    if (!__DEV__ || !devCart || !catalog.items || devCartFilled) return
    devCartFilled = true
    const next: Basket = {}
    for (const part of devCart.split(';')) {
      const [name, qty = '1'] = part.split('*')
      const item = catalog.items.find((i) => i.name === name)
      if (item) next[item.id] = Number(qty)
    }
    setBasket(next)
  }, [devCart, catalog.items])
  const lines = Object.entries(basket).flatMap(([id, quantity]) => {
    const item = byId.get(id)
    return item && quantity > 0 ? [{ item, quantity }] : []
  })
  const count = lines.reduce((n, l) => n + l.quantity, 0)
  const total =
    lines.reduce((sum, l) => sum + Math.round(Number(l.item.price) * 100) * l.quantity, 0) / 100

  const add = useCallback(
    (item: CatalogItem, by = 1) =>
      setBasket((b) => ({ ...b, [item.id]: Math.max(0, Math.min(999, (b[item.id] ?? 0) + by)) })),
    [],
  )
  const setQty = useCallback(
    (id: string, quantity: number) => setBasket((b) => ({ ...b, [id]: quantity })),
    [],
  )

  const chargeBasket = async () => {
    setBusy(true)
    setProblem(null)
    try {
      const sale = await ringUp(lines.map((l) => ({ id: l.item.id, quantity: l.quantity })))
      const usd = sale.payment_intent.amount
      setBasket({})
      router.push({
        pathname: '/terminal/[id]',
        params: { id: sale.payment_intent.id, price: dollars(usd), usd },
      })
    } catch (error) {
      setProblem(
        error instanceof Error ? error.message : 'Kova is unreachable. Check the connection.',
      )
      void catalog.reload()
    } finally {
      setBusy(false)
    }
  }

  const footerBottom = wide
    ? insets.bottom + 16
    : shopDockClearance + Math.max(insets.bottom - 6, 16) - 44

  const panel = (
    <View style={{ flex: 1 }}>
      {mode === 'items' ? (
        <ItemsPanel
          items={catalog.items}
          problem={catalog.problem}
          basket={basket}
          onAdd={add}
          width={gridWidth}
        />
      ) : (
        <ScanPanel
          items={catalog.items}
          lines={lines}
          onAdd={add}
          onQty={setQty}
          reload={catalog.reload}
          currency={shop.currency}
        />
      )}
    </View>
  )

  if (wide)
    return (
      <Screen bg={colors.tealSoft} edges={['top']}>
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <View style={{ flex: 1 }}>
            <View style={[styles.header, { paddingTop: 8 }]}>
              <View style={{ flex: 1 }}>
                <Txt weight="bold" size={28} numberOfLines={1} style={{ letterSpacing: -0.6 }}>
                  Sell
                </Txt>
                <Txt size={14} color={colors.onTint} numberOfLines={1}>
                  {shop.name} · {shop.terminal}
                </Txt>
              </View>
            </View>
            <View style={[styles.modes, { marginHorizontal: 20 }]} accessibilityRole="tablist">
              {modes.map((m) => {
                const on = m.id === mode
                return (
                  <Pressable
                    key={m.id}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                    onPress={() => setMode(m.id)}
                    style={[styles.mode, on && styles.modeOn]}
                  >
                    <Icon
                      name={m.icon}
                      size={17}
                      color={on ? colors.white : colors.ink}
                      strokeWidth={on ? 2.6 : 2}
                    />
                    <Txt weight="semi" size={14} color={on ? colors.white : colors.ink}>
                      {m.label}
                    </Txt>
                  </Pressable>
                )
              })}
            </View>
            {mode === 'keypad' ? <KeypadPanel bottom={footerBottom} /> : panel}
          </View>
          <CartPanel
            width={CART}
            lines={lines}
            count={count}
            total={total}
            currency={shop.currency}
            busy={busy}
            problem={problem}
            bottom={footerBottom}
            onQty={setQty}
            onClear={() => setBasket({})}
            onCharge={chargeBasket}
          />
        </View>
      </Screen>
    )

  return (
    <Screen bg={colors.tealSoft} edges={['top']}>
      <View style={styles.back}>
        <WalletBack />
      </View>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Txt weight="bold" size={22} numberOfLines={1} style={{ letterSpacing: -0.5 }}>
            {shop.name}
          </Txt>
          <Txt size={13} color={colors.onTint} numberOfLines={1}>
            {shop.terminal}
          </Txt>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Prices in ${currencyInfo[shop.currency].name}. Change currency`}
          accessibilityState={{ expanded: picking }}
          onPress={() => {
            void Haptics.selectionAsync()
            setPicking((p) => !p)
          }}
          style={[styles.currency, picking && { backgroundColor: colors.ink }]}
        >
          <Txt weight="bold" size={15} color={picking ? colors.white : colors.ink}>
            {currencyInfo[shop.currency].symbol.trim()} {shop.currency}
          </Txt>
          <Icon
            name={picking ? 'chevronUp' : 'chevronDown'}
            size={16}
            strokeWidth={2.4}
            color={picking ? colors.white : colors.ink}
          />
        </Pressable>
      </View>
      {picking ? (
        <View style={styles.currencyMenu}>
          <Txt
            size={13}
            color={colors.muted}
            style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: 4 }}
          >
            Type prices in
          </Txt>
          {priceCurrencies.map((c) => {
            const on = c === shop.currency
            return (
              <Pressable
                key={c}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                onPress={() => {
                  void Haptics.selectionAsync()
                  shop.setCurrency(c)
                  setPicking(false)
                }}
                style={({ pressed }) => [
                  styles.currencyItem,
                  (on || pressed) && { backgroundColor: on ? colors.tealSoft : colors.sunken },
                ]}
              >
                <Txt weight="bold" size={15} style={{ width: 40 }}>
                  {currencyInfo[c].symbol.trim()}
                </Txt>
                <Txt weight="medium" size={15} style={{ flex: 1 }}>
                  {currencyInfo[c].name}
                </Txt>
                {on ? <Icon name="check" size={18} /> : null}
              </Pressable>
            )
          })}
        </View>
      ) : null}

      <View style={styles.modes} accessibilityRole="tablist">
        {modes.map((m) => {
          const on = m.id === mode
          return (
            <Pressable
              key={m.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              onPress={() => setMode(m.id)}
              style={[styles.mode, on && styles.modeOn]}
            >
              <Icon
                name={m.icon}
                size={17}
                color={on ? colors.white : colors.ink}
                strokeWidth={on ? 2.6 : 2}
              />
              <Txt weight="semi" size={14} color={on ? colors.white : colors.ink}>
                {m.label}
              </Txt>
              {m.id !== 'keypad' && count > 0 && !on ? <View style={styles.modeDot} /> : null}
            </Pressable>
          )
        })}
      </View>

      {mode === 'keypad' ? (
        <KeypadPanel bottom={footerBottom} />
      ) : (
        <>
          {panel}
          <View style={[styles.footer, { paddingBottom: footerBottom }]}>
            {count > 0 ? (
              <View style={styles.basketRow}>
                <Txt weight="semi" size={15}>
                  {count} {count === 1 ? 'item' : 'items'}
                  {shop.currency !== 'USD' ? (
                    <Txt size={14} color={colors.onTint}>
                      {'  '}
                      {formatLocal(total, shop.currency)}
                    </Txt>
                  ) : null}
                </Txt>
                <Pressable accessibilityRole="button" hitSlop={10} onPress={() => setBasket({})}>
                  <Txt weight="semi" size={15} style={{ textDecorationLine: 'underline' }}>
                    Clear
                  </Txt>
                </Pressable>
              </View>
            ) : null}
            {problem ? (
              <Txt
                weight="medium"
                size={14}
                color={colors.danger}
                style={{ marginBottom: 8, textAlign: 'center' }}
              >
                {problem}
              </Txt>
            ) : null}
            <PillButton
              label={
                count > 0
                  ? `Charge ${dollars(total)}`
                  : mode === 'scan'
                    ? 'Scan something to sell'
                    : 'Tap what they’re buying'
              }
              icon="tap"
              disabled={count === 0}
              loading={busy}
              onPress={chargeBasket}
            />
          </View>
        </>
      )}
    </Screen>
  )
}

/**
 * The cart, beside the grid on a wide screen: every line with its quantity and total, and Charge.
 */
function CartPanel({
  width,
  lines,
  count,
  total,
  currency,
  busy,
  problem,
  bottom,
  onQty,
  onClear,
  onCharge,
}: {
  width: number
  lines: { item: CatalogItem; quantity: number }[]
  count: number
  total: number
  currency: DisplayCurrency
  busy: boolean
  problem: string | null
  bottom: number
  onQty: (id: string, quantity: number) => void
  onClear: () => void
  onCharge: () => void
}) {
  return (
    <View style={[styles.cart, { width }]}>
      <View style={styles.cartHead}>
        <Txt weight="bold" size={22} style={{ letterSpacing: -0.4 }}>
          Cart
        </Txt>
        {count > 0 ? (
          <Pressable accessibilityRole="button" hitSlop={10} onPress={onClear}>
            <Txt weight="semi" size={15} style={{ textDecorationLine: 'underline' }}>
              Clear
            </Txt>
          </Pressable>
        ) : null}
      </View>
      {lines.length === 0 ? (
        <View style={[styles.center, { paddingHorizontal: 28 }]}>
          <Kovi pose="wave" size={110} />
          <Txt weight="semi" size={18} style={{ marginTop: 10 }}>
            Nothing in the cart
          </Txt>
          <Txt
            size={14}
            color={colors.muted}
            style={{ textAlign: 'center', marginTop: 4, lineHeight: 20 }}
          >
            Tap what they’re buying, or scan it.
          </Txt>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 12 }}
        >
          {lines.map(({ item, quantity }) => (
            <View key={item.id} style={styles.cartLine}>
              <ItemFace item={item} size={46} radius={12} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt weight="semi" size={15} numberOfLines={1}>
                  {item.name}
                </Txt>
                <Txt size={13} color={colors.muted}>
                  {dollars(item.price)} each
                </Txt>
              </View>
              <Stepper
                small
                value={quantity}
                max={999}
                name={item.name}
                onChange={(n) => onQty(item.id, n)}
              />
              <Txt weight="bold" size={15} style={{ width: 76, textAlign: 'right' }}>
                {dollars(Number(item.price) * quantity)}
              </Txt>
            </View>
          ))}
        </ScrollView>
      )}
      <View style={[styles.cartFoot, { paddingBottom: bottom }]}>
        <View style={styles.cartTotal}>
          <Txt weight="semi" size={16} color={colors.muted}>
            {count} {count === 1 ? 'item' : 'items'}
          </Txt>
          <View style={{ alignItems: 'flex-end' }}>
            <Txt weight="bold" size={30} style={{ letterSpacing: -0.8 }}>
              {dollars(total)}
            </Txt>
            {currency !== 'USD' && count > 0 ? (
              <Txt size={13} color={colors.muted}>
                {formatLocal(total, currency)}
              </Txt>
            ) : null}
          </View>
        </View>
        {problem ? (
          <Txt
            weight="medium"
            size={14}
            color={colors.danger}
            style={{ marginBottom: 8, textAlign: 'center' }}
          >
            {problem}
          </Txt>
        ) : null}
        <PillButton
          label={count > 0 ? `Charge ${dollars(total)}` : 'Charge'}
          icon="tap"
          disabled={count === 0}
          loading={busy}
          onPress={onCharge}
        />
      </View>
    </View>
  )
}

/**
 * Type a price in the shop's currency; Kova asks the customer for the dollar amount. The keypad
 * takes the room the price above it doesn't need, so nothing overlaps on any size of phone.
 */
function KeypadPanel({ bottom }: { bottom: number }) {
  const shop = useShop()
  const [typed, setTyped] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [space, setSpace] = useState(0)

  // A new currency means a new price.
  useEffect(() => setTyped(''), [shop.currency])

  const info = currencyInfo[shop.currency]
  const local = typed === '' ? 0 : Number(typed)
  const usd = local > 0 ? localToUsd(local, shop.currency) : '0.00'
  const label = `${info.symbol}${groupTyped(typed)}`
  // The keypad is four rows of (key + 4) with 12 between them.
  const key = space ? Math.max(46, Math.min(58, Math.floor((space - 52 - ENTRY) / 4))) : 60
  const roomy = space === 0 || space - (4 * key + 52) >= ENTRY - 12

  const charge = async () => {
    setBusy(true)
    setProblem(null)
    try {
      const intent = await createCharge(usd, {
        reference: note.trim() || undefined,
        metadata: { price: local, price_currency: shop.currency, reference_rate: info.perUsd },
      })
      setTyped('')
      setNote('')
      router.push({ pathname: '/terminal/[id]', params: { id: intent.id, price: label, usd } })
    } catch (error) {
      setProblem(
        error instanceof Error ? error.message : 'Kova is unreachable. Check the connection.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <View style={{ flex: 1 }} onLayout={(e) => setSpace(Math.round(e.nativeEvent.layout.height))}>
        <View style={styles.entry}>
          <Txt
            weight="semi"
            size={roomy ? 64 : 52}
            style={[styles.big, typed === '' && { color: 'rgba(13,13,18,0.28)' }]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {label}
          </Txt>
          <Txt size={14} color={colors.onTint} numberOfLines={1} adjustsFontSizeToFit>
            {shop.currency === 'USD'
              ? `Customer pays $${usd} in ${settlementToken.symbol}`
              : `Customer pays $${usd} ${settlementToken.symbol} at ${formatLocal(1, shop.currency)} per dollar`}
          </Txt>
          {roomy ? (
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="What's it for? (optional)"
              placeholderTextColor="rgba(13,13,18,0.45)"
              maxLength={60}
              style={styles.note}
            />
          ) : null}
          {problem ? (
            <Txt
              weight="medium"
              size={14}
              color={colors.danger}
              style={{ marginTop: 6 }}
              numberOfLines={2}
            >
              {problem}
            </Txt>
          ) : null}
        </View>
        <Keypad
          onKey={(k) => setTyped((v) => applyKey(v, k, info.decimals))}
          decimals={info.decimals > 0}
          size={key}
        />
      </View>
      <View style={[styles.footer, { paddingBottom: bottom }]}>
        <PillButton
          label={local > 0 ? `Charge ${label}` : 'Enter a price'}
          icon="tap"
          disabled={local <= 0}
          loading={busy}
          onPress={charge}
        />
      </View>
    </>
  )
}

/** The catalogue as big tiles: tap to add one, tap the corner to take one back. */
function ItemsPanel({
  items,
  problem,
  basket,
  onAdd,
  width,
}: {
  items: CatalogItem[] | null
  problem: string | null
  basket: Basket
  onAdd: (item: CatalogItem, by?: number) => void
  /** The room the grid has: the whole phone, or what the cart leaves on a wide screen. */
  width: number
}) {
  const { owned } = useStall()
  const [query, setQuery] = useState('')
  const [shelf, setShelf] = useState<string | null>(null)
  const shelves = useMemo(
    () => [...new Set((items ?? []).flatMap((i) => (i.category ? [i.category] : [])))].sort(),
    [items],
  )
  const columns = Math.max(3, Math.floor((width - 40) / 180))
  const tile = Math.floor((width - 40 - 10 * (columns - 1)) / columns)

  if (!items)
    return (
      <View style={styles.center}>
        {problem ? (
          <Txt size={15} color={colors.onTint} style={{ textAlign: 'center' }}>
            {problem}
          </Txt>
        ) : (
          <ActivityIndicator color={colors.ink} />
        )}
      </View>
    )

  if (items.length === 0)
    return (
      <View style={styles.center}>
        <Kovi pose="wave" size={120} />
        <Txt weight="semi" size={20} style={{ marginTop: 8 }}>
          Nothing to sell yet
        </Txt>
        <Txt
          size={15}
          color={colors.onTint}
          style={{ textAlign: 'center', marginTop: 4, lineHeight: 21 }}
        >
          {owned
            ? 'Add what you sell once, then ring it up with a tap.'
            : 'The shop’s owner adds items from their phone or the Kova dashboard.'}
        </Txt>
        {owned ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/terminal/item')}
            style={styles.inlineButton}
          >
            <Icon name="plus" size={18} />
            <Txt weight="semi" size={15}>
              Add an item
            </Txt>
          </Pressable>
        ) : null}
      </View>
    )

  const q = query.trim().toLowerCase()
  const shown = items.filter(
    (i) =>
      (!q || `${i.name} ${i.barcode ?? ''}`.toLowerCase().includes(q)) &&
      (shelf === null || i.category === shelf),
  )
  return (
    <FlatList
      data={shown}
      key={columns}
      keyExtractor={(i) => i.id}
      numColumns={columns}
      keyboardShouldPersistTaps="handled"
      onScrollBeginDrag={Keyboard.dismiss}
      columnWrapperStyle={{ gap: 10 }}
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12, gap: 10 }}
      ListHeaderComponent={
        <>
          {items.length > 9 ? (
            <View style={styles.search}>
              <Icon name="scan" size={18} color={colors.onTint} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Find an item"
                placeholderTextColor="rgba(13,13,18,0.45)"
                style={styles.searchInput}
              />
            </View>
          ) : null}
          {shelves.length > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingBottom: 4 }}
            >
              {[null, ...shelves].map((name) => {
                const on = shelf === name
                return (
                  <Pressable
                    key={name ?? 'all'}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                    onPress={() => setShelf(name)}
                    style={[styles.shelf, on && styles.shelfOn]}
                  >
                    <Txt weight="semi" size={14} color={on ? colors.white : colors.ink}>
                      {name ?? 'All'}
                    </Txt>
                  </Pressable>
                )
              })}
            </ScrollView>
          ) : null}
        </>
      }
      renderItem={({ item }) => {
        const qty = basket[item.id] ?? 0
        return (
          <View style={{ width: tile }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.name}, ${dollars(item.price)}${qty ? `, ${qty} in the basket` : ''}${item.sold_out ? ', sold out' : ''}`}
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                onAdd(item)
              }}
              style={({ pressed }) => [
                styles.tile,
                qty > 0 && styles.tileIn,
                pressed && { transform: [{ scale: 0.96 }] },
              ]}
            >
              <View style={{ opacity: item.sold_out ? 0.5 : 1 }}>
                <ItemFace item={item} size={tile - 16} radius={14} />
              </View>
              {item.sold_out || (item.stock !== null && item.stock <= 5) ? (
                <View
                  style={[styles.stockTag, item.sold_out && { backgroundColor: colors.ink }]}
                  pointerEvents="none"
                >
                  <Txt weight="bold" size={11} color={colors.white}>
                    {item.sold_out ? 'Sold out' : `${item.stock} left`}
                  </Txt>
                </View>
              ) : null}
              <Txt weight="semi" size={13} numberOfLines={2} style={styles.tileName}>
                {item.name}
              </Txt>
              <Txt weight="bold" size={14}>
                {dollars(item.price)}
              </Txt>
            </Pressable>
            {qty > 0 ? (
              <>
                <View style={styles.qty} pointerEvents="none">
                  <Txt weight="bold" size={14} color={colors.white}>
                    {qty}
                  </Txt>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`One less ${item.name}`}
                  hitSlop={8}
                  onPress={() => {
                    void Haptics.selectionAsync()
                    onAdd(item, -1)
                  }}
                  style={styles.less}
                >
                  <Icon name="minus" size={16} strokeWidth={2.6} />
                </Pressable>
              </>
            ) : null}
          </View>
        )
      }}
      ListEmptyComponent={
        <Txt size={15} color={colors.onTint} style={{ textAlign: 'center', marginTop: 24 }}>
          Nothing matches “{query}”.
        </Txt>
      }
    />
  )
}

/**
 * Point the camera at a barcode and it's in the basket. Codes the shop hasn't catalogued yet
 * come up with what open product databases know, so the owner can add them on the spot.
 */
function ScanPanel({
  items,
  lines,
  onAdd,
  onQty,
  reload,
  currency,
}: {
  items: CatalogItem[] | null
  lines: { item: CatalogItem; quantity: number }[]
  onAdd: (item: CatalogItem, by?: number) => void
  onQty: (id: string, quantity: number) => void
  reload: () => Promise<CatalogItem[] | null>
  currency: DisplayCurrency
}) {
  const focused = useIsFocused()
  const { owned } = useStall()
  const [permission, requestPermission] = useCameraPermissions()
  const [torch, setTorch] = useState(false)
  const [typing, setTyping] = useState(false)
  const [code, setCode] = useState('')
  const [unknown, setUnknown] = useState<BarcodeLookup | null>(null)
  const [looking, setLooking] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const last = useRef<{ code: string; at: number }>({ code: '', at: 0 })
  /** A code the owner went to add: sell it as soon as it's in the catalogue. */
  const awaiting = useRef<string | null>(null)

  useEffect(() => {
    const code = awaiting.current
    if (!code || !items) return
    const item = items.find((i) => sameBarcode(i.barcode, code))
    if (item) {
      awaiting.current = null
      onAdd(item)
      setFlash(`${item.name} added`)
    }
  }, [items, onAdd])

  useEffect(() => {
    if (!flash) return
    const id = setTimeout(() => setFlash(null), 1400)
    return () => clearTimeout(id)
  }, [flash])

  const found = (code: string) => {
    const now = Date.now()
    // The camera reports the same code many times a second; one scan is one item.
    if (last.current.code === code && now - last.current.at < 1600) return
    last.current = { code, at: now }
    if (unknown || looking) return
    const item = items?.find((i) => sameBarcode(i.barcode, code))
    if (item) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      onAdd(item)
      setFlash(item.sold_out ? `${item.name} (marked sold out)` : `${item.name} +1`)
      return
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
    setLooking(true)
    lookupBarcode(code)
      .then((result) => {
        if (result.item) {
          onAdd(result.item)
          setFlash(`${result.item.name} +1`)
          void reload()
        } else setUnknown(result)
      })
      .catch((error: Error) => setFlash(error.message))
      .finally(() => setLooking(false))
  }

  const submitTyped = () => {
    const clean = code.replace(/\D/g, '')
    if (clean.length < 8) return setFlash('A barcode is 8 to 14 digits')
    setTyping(false)
    setCode('')
    Keyboard.dismiss()
    last.current = { code: '', at: 0 }
    found(clean)
  }

  const live = focused && !unknown && !typing && permission?.granted
  return (
    <View style={{ flex: 1 }}>
      <View style={styles.viewfinder}>
        {permission?.granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            active={focused}
            enableTorch={torch}
            barcodeScannerSettings={{
              barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'itf14'],
            }}
            onBarcodeScanned={live ? ({ data }) => found(data.trim()) : undefined}
          />
        ) : (
          <View style={styles.center}>
            <Txt weight="semi" size={17} color={colors.white}>
              Scan barcodes with the camera
            </Txt>
            <Pressable
              accessibilityRole="button"
              onPress={() => void requestPermission()}
              style={[styles.inlineButton, { backgroundColor: colors.surface }]}
            >
              <Icon name="camera" size={18} />
              <Txt weight="semi" size={15}>
                Allow camera
              </Txt>
            </Pressable>
          </View>
        )}
        {permission?.granted ? <View pointerEvents="none" style={styles.beam} /> : null}
        {flash || looking ? (
          <View pointerEvents="none" style={styles.flash}>
            {looking ? (
              <ActivityIndicator color={colors.ink} size="small" />
            ) : (
              <Icon name="check" size={16} />
            )}
            <Txt weight="semi" size={14} numberOfLines={1}>
              {looking ? 'Looking it up' : flash}
            </Txt>
          </View>
        ) : null}
        <View style={styles.viewfinderTools}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Type a barcode"
            onPress={() => setTyping(true)}
            style={[styles.tool, styles.toolWide]}
          >
            <Icon name="keypad" size={16} color={colors.white} />
            <Txt weight="semi" size={13} color={colors.white}>
              Type a code
            </Txt>
          </Pressable>
          {permission?.granted ? (
            <Pressable
              accessibilityRole="switch"
              accessibilityLabel="Torch"
              accessibilityState={{ checked: torch }}
              onPress={() => setTorch((t) => !t)}
              style={[styles.tool, torch && { backgroundColor: colors.surface }]}
            >
              <Icon name="bolt" size={18} color={torch ? colors.ink : colors.white} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {typing ? (
        <View style={styles.typeRow}>
          <TextInput
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 14))}
            placeholder="Barcode number"
            placeholderTextColor="rgba(13,13,18,0.45)"
            keyboardType="number-pad"
            autoFocus
            onSubmitEditing={submitTyped}
            style={[styles.searchInput, styles.typeInput]}
          />
          <Pressable accessibilityRole="button" onPress={submitTyped} style={styles.typeAdd}>
            <Txt weight="semi" size={15} color={colors.white}>
              Add
            </Txt>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            hitSlop={8}
            onPress={() => setTyping(false)}
          >
            <Icon name="close" size={20} />
          </Pressable>
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 8 }}
        keyboardShouldPersistTaps="handled"
      >
        {lines.length === 0 ? (
          <Txt
            size={15}
            color={colors.onTint}
            style={{ textAlign: 'center', marginTop: 12, lineHeight: 21 }}
          >
            Hold a barcode inside the frame. Each scan adds one to the basket.
          </Txt>
        ) : (
          [...lines].reverse().map(({ item, quantity }) => (
            <View key={item.id} style={styles.line}>
              <ItemFace item={item} size={44} />
              <View style={{ flex: 1 }}>
                <Txt weight="semi" size={15} numberOfLines={1}>
                  {item.name}
                </Txt>
                <Txt size={13} color={colors.onTint}>
                  {dollars(Number(item.price) * quantity)}
                  {quantity > 1 ? `, ${dollars(item.price)} each` : ''}
                  {about(Number(item.price) * quantity, currency)
                    ? `, ${about(Number(item.price) * quantity, currency)}`
                    : ''}
                </Txt>
              </View>
              <Stepper
                small
                value={quantity}
                name={item.name}
                max={999}
                onChange={(n) => onQty(item.id, n)}
              />
            </View>
          ))
        )}
      </ScrollView>

      <NotInCatalogue
        lookup={unknown}
        owner={Boolean(owned)}
        onClose={() => setUnknown(null)}
        onAdd={(lookup) => {
          setUnknown(null)
          awaiting.current = lookup.code
          router.push({
            pathname: '/terminal/item',
            params: {
              barcode: lookup.code,
              name: lookup.suggestion
                ? [lookup.suggestion.brand, lookup.suggestion.name].filter(Boolean).join(' ')
                : '',
              photo: lookup.suggestion?.image_url ?? '',
            },
          })
        }}
      />
    </View>
  )
}

/** A scanned code the shop doesn't sell yet: what it probably is, and a way to add it. */
function NotInCatalogue({
  lookup,
  owner,
  onClose,
  onAdd,
}: {
  lookup: BarcodeLookup | null
  owner: boolean
  onClose: () => void
  onAdd: (lookup: BarcodeLookup) => void
}) {
  const insets = useSafeAreaInsets()
  const s = lookup?.suggestion
  return (
    <Modal visible={!!lookup} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close" style={styles.backdrop} onPress={onClose} />
      {lookup ? (
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.grip} />
          <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center', marginTop: 16 }}>
            {s ? (
              <ItemFace item={{ name: s.name, image_url: s.image_url }} size={62} />
            ) : (
              <Kovi pose="oops" size={80} />
            )}
            <View style={{ flex: 1 }}>
              <Txt weight="bold" size={22} style={{ letterSpacing: -0.4 }}>
                Not in your catalogue
              </Txt>
              <Txt size={14} color={colors.muted} numberOfLines={2}>
                {s
                  ? `Looks like ${[s.brand, s.name].filter(Boolean).join(' ')}`
                  : `Barcode ${lookup.code}`}
              </Txt>
            </View>
          </View>
          <Txt size={15} color={colors.muted} style={{ marginTop: 14, lineHeight: 21 }}>
            {owner
              ? 'Add it once with its price, and every scan after this rings it up.'
              : 'Ask the owner to add it to the catalogue. For now, charge it on the keypad.'}
          </Txt>
          <View style={{ marginTop: 16, gap: 10 }}>
            {owner ? (
              <PillButton label="Add it and sell it" icon="plus" onPress={() => onAdd(lookup)} />
            ) : null}
            <PillButton
              label={owner ? 'Not now' : 'OK'}
              tone="white"
              icon={owner ? 'close' : 'check'}
              onPress={onClose}
            />
          </View>
        </View>
      ) : null}
    </Modal>
  )
}

const styles = StyleSheet.create({
  cart: { backgroundColor: colors.surface, borderLeftWidth: 2, borderLeftColor: colors.ink },
  shelf: {
    height: 38,
    paddingHorizontal: 16,
    borderRadius: 19,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    justifyContent: 'center',
  },
  shelfOn: { backgroundColor: colors.ink },
  stockTag: {
    position: 'absolute',
    left: 14,
    top: 14,
    paddingHorizontal: 8,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.coral,
    justifyContent: 'center',
  },
  cartHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 10,
  },
  cartLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.sunken,
  },
  cartFoot: {
    paddingHorizontal: 18,
    paddingTop: 14,
    borderTopWidth: 2,
    borderTopColor: colors.ink,
    gap: 10,
  },
  cartTotal: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  back: { paddingHorizontal: 20, paddingTop: 6 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 12,
  },
  currency: {
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  currencyMenu: {
    position: 'absolute',
    top: 70,
    right: 20,
    width: 240,
    zIndex: 10,
    padding: 6,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
  },
  currencyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    paddingHorizontal: 12,
    borderRadius: 14,
  },
  modes: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginTop: 10,
    padding: 4,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
  },
  mode: {
    flex: 1,
    height: 40,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  modeOn: { backgroundColor: colors.ink },
  modeDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.coral, marginLeft: 2 },
  entry: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 4 },
  big: { letterSpacing: -3 },
  note: {
    marginTop: 10,
    minWidth: 220,
    height: 36,
    borderRadius: 18,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255,255,255,0.5)',
    fontFamily: fonts.medium,
    fontSize: 15,
    color: colors.ink,
    textAlign: 'center',
  },
  footer: { paddingHorizontal: 20, paddingTop: 10 },
  basketRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 6,
    marginBottom: 10,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 6,
  },
  inlineButton: {
    marginTop: 14,
    height: 46,
    paddingHorizontal: 18,
    borderRadius: 23,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 44,
    borderRadius: 22,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(255,255,255,0.55)',
    marginBottom: 2,
  },
  searchInput: { flex: 1, fontFamily: fonts.medium, fontSize: 15, color: colors.ink },
  tile: {
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    padding: 6,
    paddingBottom: 10,
    gap: 4,
  },
  tileIn: { backgroundColor: colors.white },
  tileName: { marginTop: 4, minHeight: 34, lineHeight: 17 },
  qty: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 30,
    height: 30,
    paddingHorizontal: 6,
    borderRadius: 15,
    backgroundColor: colors.coral,
    borderWidth: 2,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  less: {
    position: 'absolute',
    top: -6,
    left: -6,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewfinder: {
    height: 230,
    marginHorizontal: 20,
    marginTop: 12,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.ink,
    overflow: 'hidden',
  },
  beam: {
    position: 'absolute',
    left: 36,
    right: 36,
    top: '50%',
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.coral,
    opacity: 0.9,
  },
  flash: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    maxWidth: '86%',
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 17,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  viewfinderTools: { position: 'absolute', right: 12, bottom: 12, flexDirection: 'row', gap: 8 },
  toolWide: { width: undefined, paddingHorizontal: 14, flexDirection: 'row', gap: 6 },
  tool: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(11,26,29,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 20,
    marginTop: 10,
  },
  typeInput: {
    height: 46,
    borderRadius: 23,
    paddingHorizontal: 16,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.ink,
    letterSpacing: 1,
  },
  typeAdd: {
    height: 46,
    paddingHorizontal: 18,
    borderRadius: 23,
    backgroundColor: colors.ink,
    justifyContent: 'center',
  },
  line: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 7 },
  backdrop: { flex: 1, backgroundColor: 'rgba(11,26,29,0.32)' },
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  grip: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(11,26,29,0.16)',
  },
})
