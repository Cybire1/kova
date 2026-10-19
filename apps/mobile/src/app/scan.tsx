import { CameraView, useCameraPermissions } from 'expo-camera'
import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import { useRef, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { parseScanned, type Scanned } from '@/lib/links'
import { useOffline } from '@/lib/offline'
import { colors } from '@/lib/theme'
import { Kovi } from '@/ui/art'
import { Icon } from '@/ui/Icon'
import { PillButton, RoundButton, Txt } from '@/ui/primitives'

/** Points at a shop's QR or a friend's code and goes straight to the right payment. */
export default function Scan() {
  const insets = useSafeAreaInsets()
  const [permission, requestPermission] = useCameraPermissions()
  const [problem, setProblem] = useState<string | null>(null)
  const handled = useRef(false)
  const { offline } = useOffline()

  const open = (scanned: Scanned) => {
    handled.current = true
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    // A payment someone signed with no signal: checked on this phone, no network needed.
    if (scanned.kind === 'offline')
      router.replace({ pathname: '/o', params: { code: scanned.code } })
    else if (scanned.kind === 'charge')
      router.replace({ pathname: '/pay/[id]', params: { id: scanned.id } })
    else if (scanned.kind === 'stall')
      router.replace({
        pathname: '/s/[slug]',
        params: { slug: scanned.slug, ...(scanned.table ? { table: scanned.table } : {}) },
      })
    else if (scanned.kind === 'pair')
      router.replace({ pathname: '/terminal/setup', params: { code: scanned.code } })
    else if (scanned.kind === 'claim')
      router.replace({
        pathname: '/c/[id]',
        params: { id: scanned.id, ...(scanned.key ? { key: scanned.key } : {}) },
      })
    else
      router.replace({
        pathname: '/send/[to]',
        params: {
          to: scanned.address,
          name: scanned.name ?? '',
          cur: scanned.currency ?? '',
          amount: scanned.amount ?? '',
          note: scanned.note ?? '',
        },
      })
  }

  const onText = (text: string) => {
    if (handled.current) return
    const scanned = parseScanned(text)
    if (scanned) open(scanned)
    else setProblem("That code isn't a Kova payment. Try the shop's Kova QR.")
  }

  const paste = async () => {
    const text = await Clipboard.getStringAsync()
    if (!text) return setProblem('Nothing to paste. Copy a Kova pay link first.')
    handled.current = false
    onText(text)
  }

  const close = (
    <RoundButton
      icon="close"
      label="Close"
      fill={colors.surface}
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
    />
  )

  return (
    <View style={styles.screen}>
      {permission?.granted ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => onText(data)}
        />
      ) : null}

      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        {close}
        <Txt weight="semi" size={18} color={colors.white}>
          Scan to pay
        </Txt>
        <View style={{ width: 48 }} />
      </View>

      <View style={styles.frameWrap} pointerEvents="none">
        <View style={styles.frame}>
          <View
            style={[
              styles.corner,
              { top: 0, left: 0, borderTopWidth: 6, borderLeftWidth: 6, borderTopLeftRadius: 28 },
            ]}
          />
          <View
            style={[
              styles.corner,
              {
                top: 0,
                right: 0,
                borderTopWidth: 6,
                borderRightWidth: 6,
                borderTopRightRadius: 28,
              },
            ]}
          />
          <View
            style={[
              styles.corner,
              {
                bottom: 0,
                left: 0,
                borderBottomWidth: 6,
                borderLeftWidth: 6,
                borderBottomLeftRadius: 28,
              },
            ]}
          />
          <View
            style={[
              styles.corner,
              {
                bottom: 0,
                right: 0,
                borderBottomWidth: 6,
                borderRightWidth: 6,
                borderBottomRightRadius: 28,
              },
            ]}
          />
          {permission?.granted ? null : <Kovi pose="wave" size={150} />}
        </View>
      </View>

      <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
        {permission && !permission.granted ? (
          <>
            <Txt weight="semi" size={22}>
              Let Kova use the camera
            </Txt>
            <Txt size={15} color={colors.muted} style={styles.sheetBody}>
              It only looks for payment codes. Nothing is recorded.
            </Txt>
            <PillButton label="Allow camera" icon="scan" onPress={() => void requestPermission()} />
          </>
        ) : (
          <>
            <Txt weight="semi" size={22}>
              {offline ? 'Offline? Scan anyway' : 'Point at a Kova code'}
            </Txt>
            <Txt size={15} color={problem ? colors.danger : colors.muted} style={styles.sheetBody}>
              {problem ??
                (offline
                  ? "A friend's code to pay them with a code, or their payment code to get paid. Both work with no signal."
                  : "A shop's QR, a stall's table poster, a friend's code, a payment code, or a link with dollars in it.")}
            </Txt>
          </>
        )}
        <View style={styles.row}>
          <Pressable accessibilityRole="button" onPress={paste} style={styles.option}>
            <Icon name="copy" size={20} />
            <Txt weight="semi" size={15}>
              Paste a link
            </Txt>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace('/receive')}
            style={styles.option}
          >
            <Icon name="receive" size={20} />
            <Txt weight="semi" size={15}>
              Show my code
            </Txt>
          </Pressable>
        </View>
      </View>
    </View>
  )
}

const FRAME = 250

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  frameWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  frame: { width: FRAME, height: FRAME, alignItems: 'center', justifyContent: 'center' },
  corner: { position: 'absolute', width: 64, height: 64, borderColor: colors.coral },
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
    paddingHorizontal: 24,
    paddingTop: 26,
    gap: 4,
  },
  sheetBody: { marginTop: 4, marginBottom: 16, lineHeight: 21 },
  row: { flexDirection: 'row', gap: 10, marginTop: 8 },
  option: {
    flex: 1,
    height: 46,
    borderRadius: 23,
    borderWidth: 2,
    borderColor: colors.ink,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
})
