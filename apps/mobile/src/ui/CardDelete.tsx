import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import { useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { formatUsd } from '@/lib/money'
import { type DollarCard, deleteDollarCard, newDollarCard } from '@/lib/partners'
import { colors } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Icon } from './Icon'
import { problemOf } from './Money'
import { Header, PillButton, Screen, Txt } from './primitives'

/**
 * Delete the dollar card: a quiet link under the card's activity, and a sheet that says plainly
 * what happens before anything does. The card stops at once and can't come back; the money was
 * never on the card itself, so it stays the holder's, to move to Kova whenever they like.
 */
export function DeleteCardLink({
  balance,
  onDeleted,
}: {
  balance: string | null
  onDeleted: (card: DollarCard) => void
}) {
  const { profile, signMessage } = useWallet()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const left = balance ? BigInt(balance) : 0n

  const remove = async () => {
    if (!profile) return
    setBusy(true)
    setError(null)
    try {
      const after = await deleteDollarCard(profile.address, signMessage)
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setOpen(false)
      onDeleted(after)
    } catch (e) {
      setError(problemOf(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        hitSlop={8}
        style={({ pressed }) => [styles.link, pressed && { opacity: 0.6 }]}
      >
        <Icon name="trash" size={16} color={colors.danger} />
        <Txt weight="semi" size={15} color={colors.danger}>
          Delete card
        </Txt>
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable
          style={styles.scrim}
          accessibilityLabel="Keep my card"
          onPress={() => !busy && setOpen(false)}
        />
        <View style={styles.sheet}>
          <View style={styles.grab} />
          <View style={styles.badge}>
            <Icon name="trash" size={22} color={colors.danger} />
          </View>
          <Txt weight="bold" size={24} style={{ letterSpacing: -0.6, marginTop: 14 }}>
            Delete this card?
          </Txt>
          <View style={{ gap: 10, marginTop: 12 }}>
            <Point text="It stops working at once, and it can’t be brought back." />
            <Point
              text={
                left > 0n
                  ? `Your ${formatUsd(left)} stays yours. Move it to your Kova balance any time.`
                  : 'There’s no money on it, so nothing needs moving.'
              }
            />
            <Point text="Subscriptions paid with it will fail. Give them a new card first." />
            <Point text="You can get a new card later, with a new number." />
          </View>
          {error ? (
            <Txt weight="medium" size={14} color={colors.danger} style={{ marginTop: 14 }}>
              {error}
            </Txt>
          ) : null}
          <View style={{ gap: 10, marginTop: 22 }}>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void remove()}
              style={({ pressed }) => [styles.danger, (pressed || busy) && { opacity: 0.75 }]}
            >
              <Txt weight="semi" size={16} color={colors.white}>
                {busy ? 'Deleting…' : 'Delete card'}
              </Txt>
            </Pressable>
            <PillButton tone="white" label="Keep it" icon="close" onPress={() => setOpen(false)} />
          </View>
        </View>
      </Modal>
    </>
  )
}

function Point({ text }: { text: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
      <View style={styles.dot} />
      <Txt size={15} color={colors.onTint} style={{ flex: 1, lineHeight: 21 }}>
        {text}
      </Txt>
    </View>
  )
}

/** After the card is deleted: its money, one tap from the Kova balance, and a way to a new card. */
export function CardClosed({
  data,
  onChange,
}: {
  data: DollarCard
  onChange: (card: DollarCard) => void
}) {
  const { profile, signMessage } = useWallet()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const left = data.balance ? BigInt(data.balance) : 0n

  const again = async () => {
    if (!profile) return
    setBusy(true)
    setError(null)
    try {
      onChange(await newDollarCard(profile.address, signMessage))
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    } catch (e) {
      setError(problemOf(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Header title="Dollar card" />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, flexGrow: 1 }}>
        <View style={styles.closedCard}>
          <Icon name="card" size={28} color={colors.muted} />
          <Txt weight="semi" size={14} color={colors.muted}>
            Deleted
          </Txt>
        </View>
        <Txt weight="bold" size={28} style={{ letterSpacing: -0.8 }}>
          Your card is deleted
        </Txt>
        <Txt size={15} color={colors.muted} style={{ lineHeight: 22 }}>
          {data.balance === null || data.balance === undefined
            ? 'Anything that was on it is still yours.'
            : left > 0n
              ? `${formatUsd(left)} is still yours. Move it to your Kova balance, free.`
              : 'Nothing was left on it.'}
        </Txt>
        {error ? (
          <Txt weight="medium" size={14} color={colors.danger}>
            {error}
          </Txt>
        ) : null}
        <View style={{ flex: 1 }} />
        <View style={{ gap: 10 }}>
          {left >= 1_000_000n ? (
            <PillButton
              label={`Move ${formatUsd(left)} to Kova`}
              icon="down"
              onPress={() => router.push('/dollar-card/withdraw')}
            />
          ) : null}
          <PillButton
            tone={left >= 1_000_000n ? 'white' : 'ink'}
            label={busy ? 'Making your card…' : 'Get a new card'}
            icon="plus"
            loading={busy}
            onPress={() => void again()}
          />
        </View>
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 28,
    marginBottom: 12,
    paddingVertical: 10,
  },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 40,
  },
  grab: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.rule,
    marginBottom: 16,
  },
  badge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.coralSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.muted, marginTop: 8 },
  danger: {
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closedCard: {
    height: 150,
    borderRadius: 22,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.edge,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 6,
  },
})
