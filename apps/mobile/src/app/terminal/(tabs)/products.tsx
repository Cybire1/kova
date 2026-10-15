import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { type CatalogItem, updateItem } from '@/lib/api'
import { useCatalog } from '@/lib/catalog'
import { useStall } from '@/lib/stall'
import { colors } from '@/lib/theme'
import { Kovi } from '@/ui/art'
import { Icon } from '@/ui/Icon'
import { Txt } from '@/ui/primitives'
import { useDockClearance, useWide } from '@/ui/ShopRail'
import { dollars, ItemFace } from '@/ui/StallParts'

/** What "running low" means when a shop counts its stock. */
const LOW = 5

type Filter = 'all' | 'low' | 'sold_out' | string

/**
 * Products: everything the shop sells, online and at the counter, in one list. Stock is counted
 * down by every paid sale from either side; at zero an item is sold out everywhere, and a restock
 * puts it back on sale.
 */
export default function Products() {
  const insets = useSafeAreaInsets()
  const wide = useWide()
  const bottom = useDockClearance(160)
  const catalog = useCatalog()
  const { owned } = useStall()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [saving, setSaving] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const items = catalog.items ?? []
  const categories = useMemo(
    () => [...new Set(items.flatMap((i) => (i.category ? [i.category] : [])))].sort(),
    [items],
  )
  const low = items.filter((i) => i.stock !== null && i.stock > 0 && i.stock <= LOW).length
  const out = items.filter((i) => i.sold_out).length
  const q = query.trim().toLowerCase()
  const shown = items.filter((i) => {
    if (q && !`${i.name} ${i.barcode ?? ''} ${i.category ?? ''}`.toLowerCase().includes(q))
      return false
    if (filter === 'low') return i.stock !== null && i.stock > 0 && i.stock <= LOW
    if (filter === 'sold_out') return i.sold_out
    if (filter !== 'all') return i.category === filter
    return true
  })

  const change = async (
    item: CatalogItem,
    patch: { stock?: number | null; sold_out?: boolean },
  ) => {
    setSaving(item.id)
    setProblem(null)
    // Show it at once; the server's answer replaces it.
    catalog.setItems(
      (list) =>
        list?.map((i) =>
          i.id === item.id
            ? {
                ...i,
                ...patch,
                ...(patch.stock !== undefined && patch.stock !== null
                  ? { sold_out: patch.stock === 0 }
                  : {}),
              }
            : i,
        ) ?? list,
    )
    try {
      const saved = await updateItem(item.id, patch)
      catalog.setItems((list) => list?.map((i) => (i.id === saved.id ? saved : i)) ?? list)
      void Haptics.selectionAsync()
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That didn’t save. Try again.')
      void catalog.reload()
    } finally {
      setSaving(null)
    }
  }

  const chips: { id: Filter; label: string }[] = [
    { id: 'all', label: `All ${items.length}` },
    ...(low ? [{ id: 'low' as Filter, label: `Running low ${low}` }] : []),
    ...(out ? [{ id: 'sold_out' as Filter, label: `Sold out ${out}` }] : []),
    ...categories.map((c) => ({ id: c as Filter, label: c })),
  ]

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={() => void catalog.reload()} />
        }
        contentContainerStyle={{
          paddingTop: insets.top + 16,
          paddingHorizontal: wide ? 32 : 20,
          paddingBottom: bottom,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Txt weight="bold" size={wide ? 30 : 26} style={{ letterSpacing: -0.7 }}>
              Products
            </Txt>
            <Txt size={14} color={colors.muted}>
              Sold online and at the counter. Stock counts down with every sale.
            </Txt>
          </View>
          {owned ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/terminal/item')}
              style={styles.add}
            >
              <Icon name="plus" size={18} color={colors.white} />
              <Txt weight="semi" size={15} color={colors.white}>
                Add product
              </Txt>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.search}>
          <Icon name="scan" size={18} color={colors.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Find a product, barcode or shelf"
            placeholderTextColor="#8C9799"
            style={styles.searchInput}
          />
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingVertical: 12 }}
        >
          {chips.map((c) => {
            const on = filter === c.id
            return (
              <Pressable
                key={c.id}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => setFilter(c.id)}
                style={[
                  styles.chip,
                  on && styles.chipOn,
                  c.id === 'low' && !on && { borderColor: colors.coral },
                ]}
              >
                <Txt weight="semi" size={14} color={on ? colors.white : colors.ink}>
                  {c.label}
                </Txt>
              </Pressable>
            )
          })}
        </ScrollView>

        {problem ? (
          <Txt size={14} color={colors.danger} style={{ marginBottom: 8 }}>
            {problem}
          </Txt>
        ) : null}

        {!catalog.items ? (
          <View style={{ paddingTop: 60, alignItems: 'center' }}>
            {catalog.problem ? (
              <Txt color={colors.muted}>{catalog.problem}</Txt>
            ) : (
              <ActivityIndicator color={colors.ink} />
            )}
          </View>
        ) : items.length === 0 ? (
          <View style={{ paddingTop: 40, alignItems: 'center', gap: 6 }}>
            <Kovi pose="wave" size={120} />
            <Txt weight="semi" size={20}>
              Nothing to sell yet
            </Txt>
            <Txt size={15} color={colors.muted}>
              Add a product, or photograph your menu from the Stall.
            </Txt>
          </View>
        ) : (
          <View style={styles.table}>
            {wide ? (
              <View style={[styles.row, styles.headRow]}>
                <Txt weight="semi" size={13} color={colors.muted} style={{ flex: 1 }}>
                  Product
                </Txt>
                <Txt weight="semi" size={13} color={colors.muted} style={{ width: 140 }}>
                  Shelf
                </Txt>
                <Txt
                  weight="semi"
                  size={13}
                  color={colors.muted}
                  style={{ width: 100, textAlign: 'right' }}
                >
                  Price
                </Txt>
                <Txt
                  weight="semi"
                  size={13}
                  color={colors.muted}
                  style={{ width: 210, textAlign: 'center' }}
                >
                  Stock
                </Txt>
                <Txt
                  weight="semi"
                  size={13}
                  color={colors.muted}
                  style={{ width: 120, textAlign: 'right' }}
                >
                  Status
                </Txt>
              </View>
            ) : null}
            {shown.map((item) => (
              <ProductRow
                key={item.id}
                item={item}
                wide={wide}
                editable={Boolean(owned)}
                saving={saving === item.id}
                onChange={(patch) => void change(item, patch)}
              />
            ))}
            {shown.length === 0 ? (
              <Txt size={15} color={colors.muted} style={{ padding: 20, textAlign: 'center' }}>
                Nothing matches.
              </Txt>
            ) : null}
          </View>
        )}
      </ScrollView>
    </View>
  )
}

function Status({ item }: { item: CatalogItem }) {
  const [label, tone] = item.sold_out
    ? ['Sold out', colors.danger]
    : item.stock !== null && item.stock <= LOW
      ? ['Running low', colors.coralDeep]
      : ['On sale', colors.positive]
  return (
    <View style={styles.status}>
      <View style={[styles.dot, { backgroundColor: tone }]} />
      <Txt weight="semi" size={13} color={tone}>
        {label}
      </Txt>
    </View>
  )
}

function ProductRow({
  item,
  wide,
  editable,
  saving,
  onChange,
}: {
  item: CatalogItem
  wide: boolean
  editable: boolean
  saving: boolean
  onChange: (patch: { stock?: number | null; sold_out?: boolean }) => void
}) {
  const counted = item.stock !== null
  const stock = (
    <View style={[styles.stock, wide && { width: 210 }]}>
      {counted ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`One fewer ${item.name}`}
            disabled={!editable || saving || item.stock === 0}
            onPress={() => onChange({ stock: Math.max(0, (item.stock ?? 0) - 1) })}
            style={styles.step}
          >
            <Icon name="minus" size={16} strokeWidth={2.6} />
          </Pressable>
          <Txt weight="bold" size={18} style={{ minWidth: 44, textAlign: 'center' }}>
            {item.stock}
          </Txt>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`One more ${item.name}`}
            disabled={!editable || saving}
            onPress={() => onChange({ stock: (item.stock ?? 0) + 1 })}
            style={styles.step}
          >
            <Icon name="plus" size={16} strokeWidth={2.6} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Restock ${item.name} by 10`}
            disabled={!editable || saving}
            onPress={() => onChange({ stock: (item.stock ?? 0) + 10 })}
            style={styles.restock}
          >
            <Txt weight="semi" size={13}>
              +10
            </Txt>
          </Pressable>
        </>
      ) : (
        <Pressable
          accessibilityRole="button"
          disabled={!editable || saving}
          onPress={() => onChange({ stock: 20 })}
          style={styles.count}
        >
          <Txt weight="semi" size={13}>
            Count stock
          </Txt>
        </Pressable>
      )}
    </View>
  )
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Edit ${item.name}`}
      disabled={!editable}
      onPress={() => router.push({ pathname: '/terminal/item', params: { id: item.id } })}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.sunken }]}
    >
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14, minWidth: 0 }}>
        <View style={{ opacity: item.sold_out ? 0.5 : 1 }}>
          <ItemFace item={item} size={wide ? 56 : 48} radius={14} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt weight="semi" size={16} numberOfLines={1}>
            {item.name}
          </Txt>
          <Txt size={13} color={colors.muted} numberOfLines={1}>
            {wide
              ? (item.barcode ?? 'No barcode')
              : `${dollars(item.price)}${item.category ? ` · ${item.category}` : ''}`}
          </Txt>
          {!wide ? <View style={{ marginTop: 8 }}>{stock}</View> : null}
        </View>
      </View>
      {wide ? (
        <>
          <Txt
            size={15}
            style={{ width: 140 }}
            numberOfLines={1}
            color={item.category ? colors.ink : colors.muted}
          >
            {item.category ?? '—'}
          </Txt>
          <Txt weight="semi" size={16} style={{ width: 100, textAlign: 'right' }}>
            {dollars(item.price)}
          </Txt>
          {stock}
          <View style={{ width: 120, alignItems: 'flex-end' }}>
            <Status item={item} />
          </View>
        </>
      ) : (
        <Status item={item} />
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  add: {
    height: 48,
    paddingHorizontal: 20,
    borderRadius: 24,
    backgroundColor: colors.ink,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  search: {
    marginTop: 18,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.ink,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  searchInput: { flex: 1, fontFamily: 'Manrope_600SemiBold', fontSize: 16, color: colors.ink },
  chip: {
    height: 38,
    paddingHorizontal: 16,
    borderRadius: 19,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: colors.ink },
  table: {
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
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.sunken,
  },
  headRow: { paddingVertical: 10, backgroundColor: colors.paper },
  stock: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  step: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  restock: {
    height: 34,
    paddingHorizontal: 10,
    borderRadius: 17,
    backgroundColor: colors.tealSoft,
    justifyContent: 'center',
    marginLeft: 4,
  },
  count: {
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: colors.ink,
    borderStyle: 'dashed',
    justifyContent: 'center',
  },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
})
