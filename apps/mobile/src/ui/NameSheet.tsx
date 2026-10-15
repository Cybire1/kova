import * as Haptics from 'expo-haptics'
import { useEffect, useState } from 'react'
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { Address } from 'viem'
import { colors, fonts } from '@/lib/theme'
import { isUnnamed, useWallet } from '@/lib/wallet'
import { Avatar } from './art'
import { PillButton, Txt } from './primitives'

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

/**
 * Give someone a name. Their face stays the same (it comes from their address), so the sheet
 * shows it large: you name the face you already know from your payments.
 */
export function NameSheet({
  person,
  onClose,
  onSaved,
}: {
  person: { address: Address; name: string } | null
  onClose: () => void
  onSaved?: (name: string) => void
}) {
  const { renameContact } = useWallet()
  const insets = useSafeAreaInsets()
  const [name, setName] = useState('')

  // Reset only when a different person opens, not on every parent render (that would wipe typing).
  const who = person?.address
  const current = person?.name
  useEffect(() => {
    if (who) setName(current && !isUnnamed(current) ? current : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [who])

  const save = async () => {
    if (!person || !name.trim()) return
    await renameContact(person.address, name)
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    onSaved?.(name.trim())
    onClose()
  }

  const fresh = person ? isUnnamed(person.name) : true
  return (
    <Modal visible={!!person} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable accessibilityLabel="Close" style={styles.backdrop} onPress={onClose} />
        {person ? (
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.grip} />
            <View style={styles.face}>
              <Avatar name={person.name} id={person.address} size={96} />
            </View>
            <Txt
              weight="bold"
              size={26}
              style={{ textAlign: 'center', letterSpacing: -0.6, marginTop: 14 }}
            >
              {fresh ? 'Who is this?' : 'Rename'}
            </Txt>
            <Txt size={14} color={colors.muted} style={{ textAlign: 'center', marginTop: 4 }}>
              {short(person.address)} · only you see this name
            </Txt>
            <TextInput
              value={name}
              onChangeText={setName}
              onSubmitEditing={save}
              autoFocus
              autoCapitalize="words"
              autoCorrect={false}
              maxLength={40}
              returnKeyType="done"
              placeholder="Their name"
              placeholderTextColor="#8C9799"
              style={styles.input}
            />
            <View style={{ marginTop: 14 }}>
              <PillButton label="Save name" icon="check" disabled={!name.trim()} onPress={save} />
            </View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
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
  face: { alignSelf: 'center', marginTop: 18 },
  input: {
    marginTop: 22,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    paddingHorizontal: 22,
    fontFamily: fonts.semi,
    fontSize: 18,
    color: colors.ink,
    textAlign: 'center',
  },
})
