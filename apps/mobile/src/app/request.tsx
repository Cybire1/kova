import { useState } from 'react'
import { Share, StyleSheet, TextInput, View } from 'react-native'
import { personLink } from '@/lib/links'
import { applyKey, groupTyped } from '@/lib/money'
import { colors, fonts } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { CodeCard } from '@/ui/CodeCard'
import { Keypad } from '@/ui/Keypad'
import { Header, PillButton, Screen, TextLink, Txt } from '@/ui/primitives'

/**
 * Ask for money: pick an amount, then show a code or share a link. Whoever opens it lands on
 * a ready-to-send payment with the amount and note filled in.
 */
export default function Request() {
  const { profile } = useWallet()
  const [typed, setTyped] = useState('')
  const [note, setNote] = useState('')
  const [ready, setReady] = useState(false)
  if (!profile) return null

  const amount = typed === '' ? 0 : Number(typed)
  const fixed = amount.toFixed(2)
  const link = personLink({
    address: profile.address,
    name: profile.name,
    currency: profile.currency,
    amount: fixed,
    note: note.trim() || undefined,
  })

  if (ready)
    return (
      <Screen bg={colors.sunken}>
        <Header title="Request" backIcon="close" />
        <View style={styles.center}>
          <Txt size={17}>Scan to pay {profile.name.split(' ')[0]}</Txt>
          <Txt weight="bold" size={56} style={{ letterSpacing: -2 }}>
            ${groupTyped(fixed)}
          </Txt>
          {note.trim() ? (
            <Txt weight="medium" size={16} color={colors.onTint}>
              {note.trim()}
            </Txt>
          ) : null}
          <CodeCard value={link} size={200} />
        </View>
        <View style={[styles.footer, { gap: 14 }]}>
          <PillButton
            label="Share request"
            icon="share"
            onPress={() =>
              void Share.share({
                message: `${profile.name} asked you for $${fixed}${note ? ` for ${note}` : ''} on Kova: ${link}`,
              })
            }
          />
          <View style={{ alignItems: 'center' }}>
            <TextLink label="Change amount" onPress={() => setReady(false)} />
          </View>
        </View>
      </Screen>
    )

  return (
    <Screen bg={colors.paper}>
      <Header title="Request" backIcon="close" />
      <View style={styles.entry}>
        <Txt
          weight="semi"
          size={72}
          style={[{ letterSpacing: -2.5 }, typed === '' && { color: '#B4B9B8' }]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          ${groupTyped(typed)}
        </Txt>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="What's it for?"
          placeholderTextColor="#8C9799"
          maxLength={60}
          style={styles.note}
        />
      </View>
      <Keypad onKey={(key) => setTyped((v) => applyKey(v, key))} size={60} />
      <View style={[styles.footer, { marginTop: 14 }]}>
        <PillButton
          label="Create request"
          icon="request"
          disabled={amount <= 0}
          onPress={() => setReady(true)}
        />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 2,
  },
  entry: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  note: {
    marginTop: 16,
    minWidth: 200,
    height: 40,
    borderRadius: 20,
    paddingHorizontal: 16,
    backgroundColor: colors.sunken,
    fontFamily: fonts.medium,
    fontSize: 15,
    color: colors.ink,
    textAlign: 'center',
  },
  footer: { paddingHorizontal: 20, paddingBottom: 12, paddingTop: 8 },
})
