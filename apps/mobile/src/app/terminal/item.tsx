import * as Haptics from 'expo-haptics'
import { Image } from 'expo-image'
import { router, useLocalSearchParams } from 'expo-router'
import { type ReactNode, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  type CatalogItem,
  createItem,
  findSimilarItem,
  getCatalog,
  removeItem,
  updateItem,
  updateStall,
  uploadImage,
} from '@/lib/api'
import { currencyInfo, type DisplayCurrency, formatLocal, localToUsd } from '@/lib/money'
import { type PhotoSource, takePhoto } from '@/lib/photos'
import { useShop } from '@/lib/shop'
import { useStall } from '@/lib/stall'
import { colors, fonts } from '@/lib/theme'
import { BarcodeSheet } from '@/ui/BarcodeSheet'
import { Icon, type IconName } from '@/ui/Icon'
import { Header, PillButton, Screen, Txt } from '@/ui/primitives'
import { dollars, ItemFace } from '@/ui/StallParts'

type Photo =
  | { kind: 'none' }
  | { kind: 'saved'; url: string; id: string }
  | { kind: 'remote'; url: string }
  | { kind: 'local'; uri: string }

const MAX = 10_000

/**
 * Add or edit one thing the shop sells: a photo, a name, a price in the seller's own currency
 * (Kova turns it into the dollar price buyers pay), and for packaged goods, its barcode.
 * Opened from a scan at the till, it arrives filled in with what the barcode says.
 */
export default function ItemEditor() {
  const params = useLocalSearchParams<{
    id?: string
    barcode?: string
    name?: string
    photo?: string
  }>()
  const insets = useSafeAreaInsets()
  const shop = useShop()
  const { stall, refresh } = useStall()
  const editing = Boolean(params.id)

  const [item, setItem] = useState<CatalogItem | null>(null)
  const [loading, setLoading] = useState(editing)
  const [photo, setPhoto] = useState<Photo>(
    params.photo ? { kind: 'remote', url: params.photo } : { kind: 'none' },
  )
  const [name, setName] = useState(params.name ?? '')
  const [description, setDescription] = useState('')
  const [currency, setCurrency] = useState<DisplayCurrency>(shop.currency)
  const [price, setPrice] = useState('')
  const [barcode, setBarcode] = useState(params.barcode ?? '')
  const [onStall, setOnStall] = useState(true)
  const [soldOut, setSoldOut] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [busy, setBusy] = useState<'save' | 'photo' | 'delete' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  /** A product the shop already sells that looks like this new one (Jev), and whether to add it anyway. */
  const [twin, setTwin] = useState<CatalogItem | null>(null)
  const [different, setDifferent] = useState(false)

  // Editing: load the item as it is now.
  useEffect(() => {
    if (!params.id) return
    void (async () => {
      const found =
        stall?.items.find((i) => i.id === params.id) ??
        (await getCatalog().catch(() => [])).find((i) => i.id === params.id)
      if (found) {
        setItem(found)
        setName(found.name)
        setDescription(found.description ?? '')
        setCurrency('USD')
        setPrice(found.price)
        setBarcode(found.barcode ?? '')
        setSoldOut(found.sold_out)
        setOnStall(Boolean(stall?.item_ids?.includes(found.id)))
        if (found.image_url && found.image_id)
          setPhoto({ kind: 'saved', url: found.image_url, id: found.image_id })
      } else setProblem('This item is no longer in your catalogue.')
      setLoading(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id])

  // A new name is a new question: ask again on the next save.
  useEffect(() => {
    setTwin(null)
    setDifferent(false)
  }, [name])

  const info = currencyInfo[currency]
  const typed = Number(price.replace(/,/g, ''))
  const usd =
    typed > 0 ? (currency === 'USD' ? typed.toFixed(2) : localToUsd(typed, currency)) : null
  const valid = name.trim().length > 0 && usd !== null && Number(usd) > 0 && Number(usd) <= MAX

  const pick = async (from: PhotoSource) => {
    setProblem(null)
    setBusy('photo')
    try {
      const shot = await takePhoto(from, 'item')
      if (shot) setPhoto({ kind: 'local', uri: shot.uri })
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That photo didn’t work.')
    } finally {
      setBusy(null)
    }
  }

  const save = async () => {
    if (!valid || !usd) return
    setBusy('save')
    setProblem(null)
    try {
      // A new product first gets checked against what the shop already sells.
      if (!item && !different) {
        const similar = await findSimilarItem(name.trim()).catch(() => null)
        if (similar?.item) {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
          setTwin(similar.item)
          setBusy(null)
          return
        }
      }
      let imageId: string | null | undefined
      if (photo.kind === 'local') imageId = (await uploadImage(photo.uri)).id
      // A product photo from the barcode lookup is a nice start, not a requirement.
      else if (photo.kind === 'remote')
        imageId = await uploadImage(photo.url)
          .then((r) => r.id)
          .catch(() => undefined)
      else if (photo.kind === 'none') imageId = null

      const fields = {
        name: name.trim(),
        price: usd,
        description: description.trim() || null,
        barcode: barcode || null,
        sold_out: soldOut,
        ...(imageId !== undefined ? { image_id: imageId } : {}),
      }
      if (item) {
        await updateItem(item.id, fields)
        const listed = Boolean(stall?.item_ids?.includes(item.id))
        if (stall && listed !== onStall) {
          const ids = stall.item_ids ?? []
          await updateStall(stall.id, {
            item_ids: onStall ? [...ids, item.id] : ids.filter((id) => id !== item.id),
          })
        }
      } else {
        await createItem({ ...fields, stall_ids: stall && onStall ? [stall.id] : [] })
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      await refresh().catch(() => {})
      router.back()
    } catch (error) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      setProblem(error instanceof Error ? error.message : 'That didn’t save. Try again.')
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    if (!item) return
    setBusy('delete')
    try {
      await removeItem(item.id)
      await refresh().catch(() => {})
      router.back()
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That didn’t work. Try again.')
      setBusy(null)
    }
  }

  const shown = photo.kind === 'local' ? photo.uri : photo.kind === 'none' ? null : photo.url

  return (
    <Screen bg={colors.paper} edges={['bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={{ paddingTop: Platform.OS === 'ios' ? 8 : insets.top }}>
          <Header title={editing ? 'Edit item' : 'New item'} backIcon="close" />
        </View>
        {loading ? (
          <ActivityIndicator color={colors.ink} style={{ marginTop: 40 }} />
        ) : (
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {/* The photo */}
            <View style={styles.photoRow}>
              <View style={styles.photoWell}>
                {shown ? (
                  <Image
                    source={{ uri: shown }}
                    style={styles.photo}
                    contentFit="cover"
                    transition={150}
                    accessibilityLabel={`Photo of ${name || 'the item'}`}
                  />
                ) : (
                  <ItemFace item={{ name: name || '?', image_url: null }} size={112} radius={26} />
                )}
                {busy === 'photo' ? (
                  <View style={styles.photoBusy}>
                    <ActivityIndicator color={colors.ink} />
                  </View>
                ) : null}
              </View>
              <View style={{ flex: 1, gap: 8 }}>
                <PhotoButton
                  icon="camera"
                  label="Take a photo"
                  onPress={() => void pick('camera')}
                />
                <PhotoButton
                  icon="image"
                  label="Choose a photo"
                  onPress={() => void pick('library')}
                />
                {shown ? (
                  <PhotoButton
                    icon="trash"
                    label="No photo"
                    onPress={() => setPhoto({ kind: 'none' })}
                    quiet
                  />
                ) : null}
              </View>
            </View>
            {photo.kind === 'remote' ? (
              <Txt size={13} color={colors.muted} style={{ marginTop: 8 }}>
                Photo from Open Food Facts. Take your own any time.
              </Txt>
            ) : null}

            <Label>Name</Label>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Jollof and chicken"
              placeholderTextColor="#8C9799"
              maxLength={80}
              style={styles.input}
            />

            <Label>Price</Label>
            <View style={styles.priceRow}>
              {shop.currency !== 'USD' ? (
                <View
                  style={styles.curToggle}
                  accessibilityRole="radiogroup"
                  accessibilityLabel="Price currency"
                >
                  {(['USD', shop.currency] as DisplayCurrency[]).map((c) => {
                    const on = c === currency
                    return (
                      <Pressable
                        key={c}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                        onPress={() => {
                          if (on) return
                          void Haptics.selectionAsync()
                          // Keep the same value, re-expressed in the other currency.
                          if (usd)
                            setPrice(
                              c === 'USD'
                                ? usd
                                : String(
                                    Math.round(Number(usd) * currencyInfo[c].perUsd * 100) / 100,
                                  ),
                            )
                          setCurrency(c)
                        }}
                        style={[styles.curItem, on && { backgroundColor: colors.ink }]}
                      >
                        <Txt weight="semi" size={14} color={on ? colors.white : colors.ink}>
                          {c}
                        </Txt>
                      </Pressable>
                    )
                  })}
                </View>
              ) : null}
              <View style={[styles.input, styles.priceInput]}>
                <Txt weight="semi" size={20} color={colors.muted}>
                  {info.symbol}
                </Txt>
                <TextInput
                  value={price}
                  onChangeText={(v) =>
                    setPrice(v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'))
                  }
                  placeholder={currency === 'NGN' ? '6,000' : '4.50'}
                  placeholderTextColor="#8C9799"
                  keyboardType="decimal-pad"
                  style={styles.priceText}
                  accessibilityLabel={`Price in ${info.name}`}
                />
              </View>
            </View>
            <Txt
              size={13}
              color={Number(usd) > MAX ? colors.danger : colors.muted}
              style={{ marginTop: 6, marginLeft: 4, lineHeight: 19 }}
            >
              {!usd
                ? 'Buyers pay in dollars. Type it in whichever currency you think in.'
                : Number(usd) > MAX
                  ? 'Prices go up to $10,000.'
                  : currency === 'USD'
                    ? `Buyers pay ${dollars(usd)}${shop.currency !== 'USD' ? `, about ${formatLocal(Number(usd), shop.currency)}` : ''}.`
                    : `Buyers pay ${dollars(usd)}, at ${formatLocal(1, currency)} to the dollar, rounded up.`}
            </Txt>

            <Label optional>Description</Label>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Smoky party jollof, with a drumstick"
              placeholderTextColor="#8C9799"
              maxLength={200}
              multiline
              style={[styles.input, { height: 70, paddingTop: 16, textAlignVertical: 'top' }]}
            />

            <Label optional>Barcode</Label>
            {barcode ? (
              <View style={styles.barcode}>
                <Icon name="barcode" size={20} />
                <Txt weight="semi" size={16} style={{ flex: 1, letterSpacing: 1 }}>
                  {barcode}
                </Txt>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Scan a different barcode"
                  hitSlop={8}
                  onPress={() => setScanning(true)}
                >
                  <Icon name="scan" size={20} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Remove the barcode"
                  hitSlop={8}
                  onPress={() => setBarcode('')}
                >
                  <Icon name="close" size={20} />
                </Pressable>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={() => setScanning(true)}
                style={styles.scanButton}
              >
                <Icon name="barcode" size={20} />
                <View style={{ flex: 1 }}>
                  <Txt weight="semi" size={15}>
                    Scan its barcode
                  </Txt>
                  <Txt size={13} color={colors.muted}>
                    For packaged goods, so the till can scan them
                  </Txt>
                </View>
                <Icon name="arrow" size={20} />
              </Pressable>
            )}

            <View style={styles.switches}>
              {stall ? (
                <SwitchRow
                  label="On your stall"
                  hint={`People can order it from ${stall.name}`}
                  value={onStall}
                  onChange={setOnStall}
                />
              ) : null}
              <SwitchRow
                label="Sold out"
                hint="Still shown, but nobody can order it"
                value={soldOut}
                onChange={setSoldOut}
                last
              />
            </View>

            {item ? (
              <View style={{ marginTop: 22, alignItems: 'center' }}>
                {confirmDelete ? (
                  <View style={styles.confirm}>
                    <Txt weight="semi" size={16}>
                      Remove {item.name}?
                    </Txt>
                    <Txt size={14} color={colors.muted} style={{ marginTop: 4, lineHeight: 20 }}>
                      It comes off your stall and the till. Past orders keep it.
                    </Txt>
                    <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => setConfirmDelete(false)}
                        style={[styles.small, { backgroundColor: colors.surface }]}
                      >
                        <Txt weight="semi" size={15}>
                          Keep it
                        </Txt>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        onPress={remove}
                        style={[
                          styles.small,
                          { backgroundColor: colors.danger, borderColor: colors.danger },
                        ]}
                      >
                        {busy === 'delete' ? (
                          <ActivityIndicator color={colors.white} />
                        ) : (
                          <Txt weight="semi" size={15} color={colors.white}>
                            Remove
                          </Txt>
                        )}
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    hitSlop={10}
                    onPress={() => setConfirmDelete(true)}
                  >
                    <Txt weight="semi" size={15} color={colors.danger}>
                      Remove from catalogue
                    </Txt>
                  </Pressable>
                )}
              </View>
            ) : null}
          </ScrollView>
        )}
        <View style={styles.footer}>
          {twin && !different ? (
            <View style={styles.twin}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <ItemFace item={twin} size={48} />
                <View style={{ flex: 1 }}>
                  <Txt weight="semi" size={16}>
                    You already sell {twin.name}
                  </Txt>
                  <Txt size={13} color={colors.muted}>
                    {dollars(twin.price)}. Is this the same product?
                  </Txt>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                <Pressable
                  accessibilityRole="button"
                  onPress={async () => {
                    // Same product: keep one item, and give it this barcode if it didn't have one.
                    if (barcode && !twin.barcode)
                      await updateItem(twin.id, { barcode }).catch(() => {})
                    await refresh().catch(() => {})
                    router.back()
                  }}
                  style={[styles.twinButton, { backgroundColor: colors.ink }]}
                >
                  <Txt weight="semi" size={14} color={colors.white}>
                    {barcode && !twin.barcode
                      ? 'Same: add the barcode to it'
                      : 'Same: keep that one'}
                  </Txt>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setDifferent(true)
                    setTwin(null)
                  }}
                  style={styles.twinButton}
                >
                  <Txt weight="semi" size={14}>
                    It’s different
                  </Txt>
                </Pressable>
              </View>
            </View>
          ) : null}
          {problem ? (
            <Txt
              weight="medium"
              size={14}
              color={colors.danger}
              style={{ marginBottom: 10, textAlign: 'center' }}
            >
              {problem}
            </Txt>
          ) : null}
          <PillButton
            label={editing ? 'Save changes' : 'Add item'}
            icon="check"
            disabled={!valid || busy === 'photo'}
            loading={busy === 'save'}
            onPress={save}
          />
        </View>
      </KeyboardAvoidingView>
      <BarcodeSheet
        visible={scanning}
        onClose={() => setScanning(false)}
        onCode={(code) => {
          setBarcode(code)
          setScanning(false)
        }}
      />
    </Screen>
  )
}

function Label({ children, optional }: { children: ReactNode; optional?: boolean }) {
  return (
    <Txt weight="semi" size={14} color={colors.muted} style={styles.label}>
      {children}
      {optional ? (
        <Txt size={13} color="#8C9799">
          {'  '}optional
        </Txt>
      ) : null}
    </Txt>
  )
}

function PhotoButton({
  icon,
  label,
  onPress,
  quiet,
}: {
  icon: IconName
  label: string
  onPress: () => void
  quiet?: boolean
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.photoButton,
        quiet && { borderColor: 'transparent', backgroundColor: 'transparent' },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Icon name={icon} size={18} />
      <Txt weight="semi" size={15}>
        {label}
      </Txt>
    </Pressable>
  )
}

function SwitchRow({
  label,
  hint,
  value,
  onChange,
  last,
}: {
  label: string
  hint: string
  value: boolean
  onChange: (v: boolean) => void
  last?: boolean
}) {
  return (
    <View style={[styles.switchRow, !last && styles.rule]}>
      <View style={{ flex: 1 }}>
        <Txt weight="semi" size={16}>
          {label}
        </Txt>
        <Txt size={13} color={colors.muted}>
          {hint}
        </Txt>
      </View>
      <Switch
        value={value}
        onValueChange={(v) => {
          void Haptics.selectionAsync()
          onChange(v)
        }}
        trackColor={{ true: colors.teal, false: colors.sunken }}
        accessibilityLabel={label}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingBottom: 24, paddingTop: 8 },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  photoWell: {
    width: 132,
    height: 132,
    borderRadius: 32,
    borderWidth: 2,
    borderColor: colors.ink,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  photo: { width: '100%', height: '100%' },
  photoBusy: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(241,239,234,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoButton: {
    height: 42,
    paddingHorizontal: 14,
    borderRadius: 21,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: { marginTop: 20, marginBottom: 8, marginLeft: 4 },
  input: {
    height: 50,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    paddingHorizontal: 18,
    fontFamily: fonts.medium,
    fontSize: 16,
    color: colors.ink,
  },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  curToggle: {
    flexDirection: 'row',
    padding: 3,
    gap: 2,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
  },
  curItem: { height: 44, paddingHorizontal: 12, borderRadius: 19, justifyContent: 'center' },
  priceInput: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  priceText: { flex: 1, height: '100%', fontFamily: fonts.bold, fontSize: 22, color: colors.ink },
  barcode: {
    height: 50,
    paddingHorizontal: 16,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  scanButton: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.ink,
    borderStyle: 'dashed',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  switches: {
    marginTop: 22,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  rule: { borderBottomWidth: 1, borderColor: colors.sunken },
  confirm: {
    alignSelf: 'stretch',
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.ink,
    padding: 16,
    backgroundColor: colors.surface,
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
  footer: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12 },
  twin: {
    marginBottom: 12,
    padding: 14,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.tealSoft,
  },
  twinButton: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: 10,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
