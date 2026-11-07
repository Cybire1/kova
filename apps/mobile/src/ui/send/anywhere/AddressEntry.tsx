import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { crossChainSender, detectAddress, eta, networksFor } from '@/lib/crosschain'
import { colors, fonts } from '@/lib/theme'
import { Icon } from '../../Icon'
import { Header, PillButton, Screen, Txt } from '../../primitives'
import { reachableNetworks } from './Belt'
import { ChainLogo } from './ChainLogo'

/**
 * Send to another network, from its own row in Send: one field for their address, a line that
 * says at once what Kova reads it as, and the networks it can go to, laid out plainly. Pasting an
 * address into Send's own field skips this and goes straight on.
 */
export function AddressEntry({
  onAddress,
  onClose,
}: {
  onAddress: (address: string) => void
  onClose: () => void
}) {
  const [text, setText] = useState('')
  const found = text.trim() ? detectAddress(text) : null
  const reach = crossChainSender()?.reach ?? []
  // Monad is an ordinary Kova send, so it isn't listed here. The ones people use most come first.
  const first = ['base', 'solana', 'ethereum', 'arbitrum', 'optimism', 'polygon']
  const rank = (id: string) => (first.includes(id) ? first.indexOf(id) : first.length)
  const places = reachableNetworks()
    .filter((n) => n.id !== 'monad')
    .sort((a, b) => rank(a.id) - rank(b.id))
  const seconds = places[0]?.seconds ?? 120

  const reading = (() => {
    if (!text.trim()) return null
    if (!found) return { ok: false, text: 'That doesn’t look like a full address yet.' }
    if (found.kind === 'evm')
      return { ok: true, text: 'An EVM address. You’ll pick its network next.' }
    if (found.kind === 'solana') return { ok: true, text: 'A Solana address. It goes to Solana.' }
    if (found.kind === 'move')
      return networksFor('move', reach).length
        ? { ok: true, text: 'A Sui or Aptos address. You’ll pick which next.' }
        : { ok: false, text: 'A Sui or Aptos address. Kova can’t send there yet.' }
    return { ok: false, text: `A ${found.family} address. Kova can’t send there yet.` }
  })()

  const paste = async () => {
    const clip = (await Clipboard.getStringAsync()).trim()
    if (!clip) return
    void Haptics.selectionAsync()
    setText(clip)
  }

  return (
    <Screen>
      <Header title="Another network" backIcon="close" onBack={onClose} />
      <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 8 }}>
        <Txt weight="bold" size={30} style={{ letterSpacing: -0.8 }}>
          Paste their address
        </Txt>
        <Txt size={15} color={colors.muted} style={{ marginTop: 4, lineHeight: 21 }}>
          Kova works out the network from it.
        </Txt>

        <View
          style={[styles.field, reading && !reading.ok ? { borderColor: colors.danger } : null]}
        >
          {found?.kind === 'solana' ? <ChainLogo name="solana" size={30} /> : null}
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="0x…, or a Solana address"
            placeholderTextColor="#8C9799"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            accessibilityLabel="Their address"
            style={styles.input}
          />
          {text ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear"
              hitSlop={6}
              onPress={() => setText('')}
              style={styles.fieldButton}
            >
              <Icon name="close" size={16} strokeWidth={2.6} />
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Paste"
              hitSlop={6}
              onPress={paste}
              style={[styles.fieldButton, styles.pasteButton]}
            >
              <Icon name="copy" size={16} color={colors.onFill} />
              <Txt weight="semi" size={14} color={colors.onFill}>
                Paste
              </Txt>
            </Pressable>
          )}
        </View>
        {reading ? (
          <View style={styles.reading}>
            <Icon
              name={reading.ok ? 'check' : 'info'}
              size={15}
              color={reading.ok ? colors.positive : colors.danger}
              strokeWidth={2.6}
            />
            <Txt
              weight="semi"
              size={13}
              color={reading.ok ? colors.positive : colors.danger}
              style={{ flex: 1 }}
            >
              {reading.text}
            </Txt>
          </View>
        ) : null}

        <Txt weight="semi" size={13} color={colors.muted} style={styles.section}>
          Where it can go
        </Txt>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.grid}>
          {places.map((n) => (
            <View key={n.id} style={styles.place} accessibilityLabel={n.name}>
              <ChainLogo name={n.id} size={34} />
              <Txt weight="medium" size={12} numberOfLines={1} style={{ maxWidth: 76 }}>
                {n.name}
              </Txt>
            </View>
          ))}
        </ScrollView>

        <View style={styles.facts}>
          <Fact icon="clock" text={`About ${eta(seconds)}`} />
          <Fact icon="bolt" text="No gas for anyone" />
          <Fact icon="check" text="Arrives as USDC" />
        </View>
        <PillButton
          label={found?.kind === 'solana' ? 'Continue on Solana' : 'Continue'}
          disabled={!found}
          onPress={() => found && onAddress(found.address)}
        />
      </View>
    </Screen>
  )
}

function Fact({ icon, text }: { icon: 'clock' | 'bolt' | 'check'; text: string }) {
  return (
    <View style={styles.fact}>
      <Icon name={icon} size={14} color={colors.muted} strokeWidth={2.4} />
      <Txt weight="semi" size={12} color={colors.muted}>
        {text}
      </Txt>
    </View>
  )
}

const styles = StyleSheet.create({
  field: {
    marginTop: 18,
    height: 56,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 12,
    paddingRight: 7,
    gap: 8,
  },
  input: {
    flex: 1,
    height: '100%',
    fontFamily: fonts.semi,
    fontSize: 16,
    color: colors.ink,
    paddingLeft: 4,
  },
  fieldButton: {
    height: 40,
    minWidth: 40,
    borderRadius: 20,
    backgroundColor: colors.sunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pasteButton: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 14,
    backgroundColor: colors.fill,
  },
  reading: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, marginLeft: 6 },
  section: { marginTop: 24, marginBottom: 10, marginLeft: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 16, paddingBottom: 12 },
  place: { width: '25%', alignItems: 'center', gap: 6 },
  facts: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 5 },
})
