import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { type Address, getAddress, isAddressEqual } from 'viem'
import { parseScanned } from '@/lib/links'
import { formatUsd } from '@/lib/money'
import { useNadName } from '@/lib/names'
import { colors, fonts } from '@/lib/theme'
import { type Entry, isUnnamed, useWallet } from '@/lib/wallet'
import { Avatar } from './art'
import { Icon, type IconName } from './Icon'
import { Txt } from './primitives'

export type Picked = { address: Address; name?: string }

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

/**
 * Who, for anything that pays a person but isn't a one-off send: a repeat payment, a shop's share.
 * The same field as Send's (a name you saved, a .nad name, an address or a Kova link) and your
 * people one tap away, without Send's own ways out (a phone number, a link, a charge).
 */
export function PersonPicker({
  title,
  lead,
  onPick,
  refuse,
  maxListHeight = 64 * 5.5,
}: {
  title?: string
  lead?: string
  onPick: (person: Picked) => void
  /** Why this wallet can't be picked here, or null when it can. */
  refuse?: (address: Address) => string | null
  maxListHeight?: number
}) {
  const { contacts, activity } = useWallet()
  const [text, setText] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  const people = useMemo(() => {
    const lastWith = (a: Address) => activity.find((e) => e.address && isAddressEqual(e.address, a))
    return contacts
      .map((c) => ({ ...c, last: lastWith(c.address) }))
      .sort((x, y) => (y.last?.at ?? 0) - (x.last?.at ?? 0))
  }, [contacts, activity])

  const query = text.trim().toLowerCase()
  const shown = query
    ? people.filter(
        (p) => p.name.toLowerCase().includes(query) || p.address.toLowerCase().includes(query),
      )
    : people
  const scanned = query ? parseScanned(text) : null
  const direct = scanned?.kind === 'person' ? scanned : null
  const nad = useNadName(scanned ? '' : text)

  const choose = (person: Picked) => {
    const why = refuse?.(person.address)
    if (why) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
      return setProblem(why)
    }
    void Haptics.selectionAsync()
    setProblem(null)
    onPick(person)
  }

  const pickName = () => {
    if (!nad) return
    if (nad.state === 'found') return choose({ address: nad.address, name: nad.name })
    setProblem(
      nad.state === 'looking'
        ? `Still looking up ${nad.name}.`
        : nad.state === 'none'
          ? `No one has ${nad.name} yet.`
          : `Couldn’t look up ${nad.name}. Try again.`,
    )
  }

  const submit = () => {
    if (direct) return choose({ address: getAddress(direct.address), name: direct.name })
    if (nad && (nad.typed || (nad.state === 'found' && shown.length === 0))) return pickName()
    const only = shown.length === 1 ? shown[0] : undefined
    if (only) return choose({ address: only.address, name: only.name })
    if (query) setProblem('That isn’t a wallet address, a .nad name or a Kova link.')
  }

  const paste = async () => {
    const clip = (await Clipboard.getStringAsync()).trim()
    if (!clip) return setProblem('Nothing to paste. Copy their Kova link or wallet address first.')
    setText(clip)
    const got = parseScanned(clip)
    setProblem(
      got?.kind === 'person' || !got ? null : 'That’s a Kova link, but not to a person’s wallet.',
    )
  }

  return (
    <View>
      {title ? (
        <Txt weight="bold" size={30} style={{ letterSpacing: -0.8 }}>
          {title}
        </Txt>
      ) : null}
      {lead ? (
        <Txt size={15} color={colors.onTint} style={{ marginTop: 4, lineHeight: 21 }}>
          {lead}
        </Txt>
      ) : null}

      <View style={[styles.field, problem ? { borderColor: colors.danger } : null]}>
        <Icon name="user" size={18} color={colors.muted} />
        <TextInput
          value={text}
          onChangeText={(v) => {
            setText(v)
            setProblem(null)
          }}
          onSubmitEditing={submit}
          placeholder="Name, .nad name, address or link"
          placeholderTextColor="#8C9799"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          accessibilityLabel="Who"
          style={styles.input}
        />
        {text ? (
          <FieldButton icon="close" label="Clear" onPress={() => setText('')} />
        ) : (
          <FieldButton icon="copy" label="Paste" onPress={() => void paste()} />
        )}
      </View>
      {problem ? (
        <Txt
          weight="medium"
          size={14}
          color={colors.danger}
          style={{ marginTop: 8, marginLeft: 6 }}
        >
          {problem}
        </Txt>
      ) : null}

      {nad && (nad.typed || nad.state === 'found') ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: nad.state !== 'found' }}
          disabled={nad.state !== 'found'}
          onPress={pickName}
          style={({ pressed }) => [styles.direct, pressed && { transform: [{ scale: 0.98 }] }]}
        >
          {nad.state === 'found' ? (
            <Avatar name={nad.name} id={nad.address} size={48} />
          ) : (
            <View style={styles.directBadge}>
              <Icon name="user" size={22} />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Txt weight="semi" size={16} color={colors.white} numberOfLines={1}>
              {nad.name}
            </Txt>
            <Txt size={13} color={colors.onInk} numberOfLines={1}>
              {nad.state === 'found'
                ? `Their wallet, ${short(nad.address)}`
                : nad.state === 'looking'
                  ? 'Looking it up…'
                  : nad.state === 'none'
                    ? 'No one has this name yet'
                    : 'Couldn’t look it up. Try again in a moment.'}
            </Txt>
          </View>
          {nad.state === 'found' ? (
            <View style={styles.directGo}>
              <Icon name="arrow" size={20} />
            </View>
          ) : null}
        </Pressable>
      ) : null}

      {direct ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => choose({ address: getAddress(direct.address), name: direct.name })}
          style={({ pressed }) => [styles.direct, pressed && { transform: [{ scale: 0.98 }] }]}
        >
          <Avatar name={direct.name ?? direct.address} id={direct.address} size={48} />
          <View style={{ flex: 1 }}>
            <Txt weight="semi" size={16} color={colors.white} numberOfLines={1}>
              {direct.name || short(direct.address)}
            </Txt>
            <Txt size={13} color={colors.onInk}>
              Wallet address, ready
            </Txt>
          </View>
          <View style={styles.directGo}>
            <Icon name="arrow" size={20} />
          </View>
        </Pressable>
      ) : null}

      {shown.length > 0 ? (
        <>
          <Txt weight="semi" size={14} color={colors.muted} style={styles.section}>
            {query ? `Matches (${shown.length})` : 'Your people'}
          </Txt>
          <View style={styles.list}>
            <ScrollView
              style={{ maxHeight: maxListHeight }}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
            >
              {shown.map((p, i) => (
                <Pressable
                  key={p.address}
                  accessibilityRole="button"
                  accessibilityLabel={isUnnamed(p.name) ? short(p.address) : p.name}
                  onPress={() => choose({ address: p.address, name: p.name })}
                  style={({ pressed }) => [
                    styles.row,
                    i < shown.length - 1 && styles.rule,
                    pressed && { backgroundColor: colors.sunken },
                  ]}
                >
                  <Avatar name={p.name} id={p.address} size={42} />
                  <View style={{ flex: 1 }}>
                    <Txt weight="semi" size={16} numberOfLines={1}>
                      {isUnnamed(p.name) ? short(p.address) : p.name}
                    </Txt>
                    <Txt size={13} color={colors.muted} numberOfLines={1}>
                      {story(p.last)}
                    </Txt>
                  </View>
                  <Icon name="arrow" size={18} color={colors.muted} />
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </>
      ) : query && !direct && !nad?.typed && nad?.state !== 'found' ? (
        <Txt
          size={15}
          color={colors.muted}
          style={{ marginTop: 16, marginLeft: 6, lineHeight: 21 }}
        >
          No one matches “{text.trim()}”. Try their .nad name, or paste their Kova link or a full
          address.
        </Txt>
      ) : people.length === 0 && !query ? (
        <View style={styles.empty}>
          <Icon name="user" size={22} color={colors.muted} />
          <Txt size={14} color={colors.muted} style={{ flex: 1, lineHeight: 20 }}>
            Type their .nad name, or paste their Kova link or wallet address. People you’ve paid
            show up here.
          </Txt>
        </View>
      ) : null}
    </View>
  )
}

/** The latest money between you, as Send shows it. */
function story(last: Entry | undefined) {
  if (!last) return 'No payments yet'
  const amount = formatUsd(BigInt(last.amount))
  const days = Math.floor((Date.now() - last.at) / 86_400_000)
  const when =
    days <= 0
      ? 'today'
      : days === 1
        ? 'yesterday'
        : days < 7
          ? `${days}d ago`
          : new Date(last.at).toLocaleDateString([], { day: 'numeric', month: 'short' })
  return last.kind === 'sent' || last.kind === 'paid'
    ? `You sent ${amount} · ${when}`
    : `Paid you ${amount} · ${when}`
}

function FieldButton({
  icon,
  label,
  onPress,
}: {
  icon: IconName
  label: string
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.fieldButton, pressed && { transform: [{ scale: 0.94 }] }]}
    >
      <Icon name={icon} size={18} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  field: {
    marginTop: 16,
    height: 50,
    borderRadius: 25,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 18,
    paddingRight: 7,
    gap: 10,
  },
  input: { flex: 1, height: '100%', fontFamily: fonts.medium, fontSize: 16, color: colors.ink },
  fieldButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.sunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  direct: {
    marginTop: 12,
    borderRadius: 24,
    backgroundColor: colors.fill,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  directBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  directGo: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: { marginTop: 20, marginBottom: 8, marginLeft: 4 },
  list: {
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, height: 56 },
  rule: { borderBottomWidth: 1, borderColor: colors.sunken },
  empty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
    padding: 14,
    borderRadius: 18,
    backgroundColor: colors.sunken,
  },
})
