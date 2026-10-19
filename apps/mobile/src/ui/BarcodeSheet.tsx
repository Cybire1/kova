import { CameraView, useCameraPermissions } from 'expo-camera'
import * as Haptics from 'expo-haptics'
import { useEffect, useRef, useState } from 'react'
import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, fonts } from '@/lib/theme'
import { Icon } from './Icon'
import { PillButton, RoundButton, Txt } from './primitives'

/** Scan one barcode, or type it, and hand it back. */
export function BarcodeSheet({
  visible,
  onClose,
  onCode,
}: {
  visible: boolean
  onClose: () => void
  onCode: (code: string) => void
}) {
  const insets = useSafeAreaInsets()
  const [permission, requestPermission] = useCameraPermissions()
  const [typed, setTyped] = useState('')
  const done = useRef(false)

  useEffect(() => {
    if (visible) {
      done.current = false
      setTyped('')
    }
  }, [visible])

  const finish = (code: string) => {
    if (done.current) return
    done.current = true
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    onCode(code)
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.screen}>
        {visible && permission?.granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{
              barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'itf14'],
            }}
            onBarcodeScanned={({ data }) => finish(data.trim())}
          />
        ) : null}
        <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
          <RoundButton icon="close" label="Close" fill={colors.surface} onPress={onClose} />
          <Txt weight="semi" size={18} color={colors.white}>
            Scan its barcode
          </Txt>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.frameWrap} pointerEvents="none">
          <View style={styles.frame}>
            <View style={styles.beam} />
          </View>
        </View>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          {permission && !permission.granted ? (
            <>
              <Txt weight="semi" size={20}>
                Let Kova use the camera
              </Txt>
              <Txt
                size={15}
                color={colors.muted}
                style={{ marginTop: 4, marginBottom: 14, lineHeight: 21 }}
              >
                It only reads the barcode. Or type the number under the bars.
              </Txt>
              <PillButton
                label="Allow camera"
                icon="camera"
                onPress={() => void requestPermission()}
              />
            </>
          ) : (
            <Txt size={15} color={colors.muted} style={{ lineHeight: 21 }}>
              Line the bars up with the coral line. Or type the number printed under them.
            </Txt>
          )}
          <View style={styles.typeRow}>
            <Icon name="barcode" size={20} />
            <TextInput
              value={typed}
              onChangeText={(v) => setTyped(v.replace(/\D/g, '').slice(0, 14))}
              placeholder="5449000000996"
              placeholderTextColor="#8C9799"
              keyboardType="number-pad"
              style={styles.input}
            />
            <Pressable
              accessibilityRole="button"
              disabled={typed.length < 8}
              onPress={() => finish(typed)}
              style={[styles.use, { opacity: typed.length < 8 ? 0.35 : 1 }]}
            >
              <Txt weight="semi" size={15} color={colors.white}>
                Use
              </Txt>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  frameWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  frame: {
    width: 290,
    height: 170,
    borderRadius: 26,
    borderWidth: 4,
    borderColor: colors.coral,
    justifyContent: 'center',
  },
  beam: { marginHorizontal: 18, height: 2, borderRadius: 1, backgroundColor: colors.coral },
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 20,
    paddingTop: 22,
  },
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
    height: 50,
    paddingLeft: 16,
    paddingRight: 6,
    borderRadius: 25,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
  },
  input: { flex: 1, fontFamily: fonts.semi, fontSize: 17, color: colors.ink, letterSpacing: 1 },
  use: {
    height: 42,
    paddingHorizontal: 18,
    borderRadius: 21,
    backgroundColor: colors.ink,
    justifyContent: 'center',
  },
})
