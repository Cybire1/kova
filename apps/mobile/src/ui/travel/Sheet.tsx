import type { ReactNode } from 'react'
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, pair } from '@/lib/theme'
import { Txt } from '../primitives'

/** A sheet that rises from the bottom, on paper, with a grip and an optional title. */
export function Sheet({
  visible,
  onClose,
  title,
  children,
  tall,
}: {
  visible: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  tall?: boolean
}) {
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable accessibilityLabel="Close" style={styles.backdrop} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            tall && { height: '86%' },
            { paddingBottom: Math.max(insets.bottom, 16) },
          ]}
        >
          <View style={styles.grip} />
          {title ? (
            <Txt
              weight="bold"
              size={22}
              style={{ letterSpacing: -0.5, marginTop: 12, marginBottom: 6 }}
            >
              {title}
            </Txt>
          ) : null}
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: pair('rgba(11,26,29,0.32)', 'rgba(0,0,0,0.6)') },
  sheet: {
    maxHeight: '90%',
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
    backgroundColor: colors.rule,
  },
})
