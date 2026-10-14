import { parseAmount } from '@kova/monad'
import * as Haptics from 'expo-haptics'
import * as WebBrowser from 'expo-web-browser'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { webUrl } from '@/lib/config'
import { formatUsd } from '@/lib/money'
import {
  type DollarCard,
  getDollarCard,
  issueDollarCard,
  revealDollarCard,
  setDollarCard,
} from '@/lib/partners'
import { colors } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Icon, type IconName } from '@/ui/Icon'
import { NotYet, problemOf, SandboxNote, useMoney } from '@/ui/Money'
import { Header, PillButton, Screen, Txt } from '@/ui/primitives'
import { Stage } from '@/ui/Stage'

const LIMITS = [50, 200, 500, 1000]

/**
 * The dollar card: a virtual card (Lithic) that pays online and in shops from your Kova dollars,
 * with a daily limit you set and a freeze that bites at the issuer. Its number only ever shows in
 * the issuer's own page.
 */
export default function DollarCardScreen() {
  const { profile, signMessage } = useWallet()
  const { data, setData, problem } = useMoney<DollarCard>(getDollarCard)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const act = async (label: string, run: () => Promise<DollarCard>) => {
    setBusy(label)
    setError(null)
    try {
      setData(await run())
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    } catch (e) {
      setError(problemOf(e))
    } finally {
      setBusy(null)
    }
  }

  const card = data?.card

  return (
    <Screen bg={colors.paper}>
      <Header title="Dollar card" />
      <ScrollView contentContainerStyle={styles.body}>
        {!data ? (
          <Txt size={15} color={colors.muted} style={{ marginTop: 40, textAlign: 'center' }}>
            {problem ?? 'Opening…'}
          </Txt>
        ) : !data.live ? (
          <NotYet
            pose="ride"
            title="A dollar card for anywhere"
            lead="Pay online and in shops straight from your Kova dollars: subscriptions, flights, anything that takes a card."
            facts={[
              ['Spends from', 'Your Kova balance'],
              ['Daily limit', 'You set it, any time'],
              ['Freeze', 'One tap, refused at once'],
              ['Card number', 'Shown only to you'],
            ]}
            feature="dollar_card"
            requested={data.requested}
            onRequested={() => setData({ ...data, requested: true })}
          />
        ) : !card ? (
          <View style={{ flex: 1 }}>
            <View style={{ alignItems: 'center', height: 140 }}>
              <Stage pose="ride" size={130} />
            </View>
            <Txt weight="semi" size={30} style={styles.title}>
              Get your dollar card
            </Txt>
            <Txt size={16} color={colors.onTint} style={styles.lead}>
              A virtual card you can use straight away, spending up to $200 a day from your balance.
            </Txt>
            {data.sandbox ? <SandboxNote text="Card sandbox: a test card, no money moves" /> : null}
            {error ? (
              <Txt weight="medium" size={14} color={colors.danger} style={{ marginTop: 10 }}>
                {error}
              </Txt>
            ) : null}
            <View style={{ marginTop: 'auto', paddingTop: 20 }}>
              <PillButton
                label={busy ? 'Making your card…' : 'Get my card'}
                icon="card"
                loading={busy !== null}
                disabled={!profile}
                onPress={() =>
                  profile && act('issue', () => issueDollarCard(profile.address, signMessage))
                }
              />
            </View>
          </View>
        ) : (
          <View>
            {data.sandbox ? <SandboxNote text="Card sandbox: a test card, no money moves" /> : null}
            <View style={[styles.card, card.frozen && styles.cardFrozen]}>
              <View style={styles.cardTop}>
                <Txt weight="bold" size={24} color={colors.surface} style={{ letterSpacing: -0.8 }}>
                  kova
                </Txt>
                {card.frozen ? (
                  <View style={styles.chip}>
                    <Txt weight="bold" size={12}>
                      Frozen
                    </Txt>
                  </View>
                ) : (
                  <Txt weight="bold" size={12} color={colors.onInk} style={{ letterSpacing: 1.2 }}>
                    VIRTUAL
                  </Txt>
                )}
              </View>
              <Txt weight="semi" size={20} color={colors.surface} style={{ letterSpacing: 1.6 }}>
                •••• •••• •••• {card.last_four}
              </Txt>
              <View style={styles.cardTop}>
                <Txt weight="semi" size={14} color={colors.onInk}>
                  {profile?.name || 'Kova'}
                </Txt>
                <Txt weight="semi" size={14} color={colors.onInk}>
                  {card.exp_month && card.exp_year
                    ? `${card.exp_month}/${card.exp_year.slice(-2)}`
                    : ''}
                </Txt>
              </View>
            </View>
            {error ? (
              <Txt weight="medium" size={14} color={colors.danger} style={{ marginTop: 10 }}>
                {error}
              </Txt>
            ) : null}
            <View style={styles.actions}>
              <Action
                icon="eye"
                label={busy === 'reveal' ? 'Opening…' : 'Show number'}
                disabled={busy !== null}
                onPress={async () => {
                  if (!profile) return
                  setBusy('reveal')
                  setError(null)
                  try {
                    const reveal = await revealDollarCard(
                      profile.address,
                      signMessage,
                      new URL(webUrl).origin,
                    )
                    await WebBrowser.openBrowserAsync(reveal.url)
                  } catch (e) {
                    setError(problemOf(e))
                  } finally {
                    setBusy(null)
                  }
                }}
              />
              <Action
                icon="lock"
                label={busy === 'freeze' ? 'One moment…' : card.frozen ? 'Unfreeze' : 'Freeze'}
                fill={card.frozen ? colors.tealSoft : colors.coralSoft}
                disabled={busy !== null}
                onPress={() =>
                  profile &&
                  act('freeze', () =>
                    setDollarCard(profile.address, signMessage, { frozen: !card.frozen }),
                  )
                }
              />
            </View>
            <Txt weight="semi" size={14} color={colors.muted} style={styles.section}>
              Daily limit
            </Txt>
            <View style={styles.limits}>
              {LIMITS.map((dollars) => {
                const units = parseAmount(String(dollars))
                const on = BigInt(card.daily_limit) === units
                return (
                  <Pressable
                    key={dollars}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    disabled={busy !== null || on}
                    onPress={() =>
                      profile &&
                      act('limit', () =>
                        setDollarCard(profile.address, signMessage, {
                          daily_limit: units.toString(),
                        }),
                      )
                    }
                    style={[styles.limit, on && styles.limitOn]}
                  >
                    <Txt weight="semi" size={15} color={on ? colors.surface : colors.ink}>
                      ${dollars.toLocaleString('en-US')}
                    </Txt>
                  </Pressable>
                )
              })}
            </View>
            <Txt weight="semi" size={14} color={colors.muted} style={styles.section}>
              Payments
            </Txt>
            {data.transactions.length === 0 ? (
              <Txt size={15} color={colors.muted}>
                Card payments show up here.
              </Txt>
            ) : (
              <View style={styles.list}>
                {data.transactions.map((t, i) => (
                  <View key={t.id} style={[styles.row, i > 0 && styles.rule]}>
                    <View style={{ flex: 1 }}>
                      <Txt weight="semi" size={15}>
                        {t.merchant}
                      </Txt>
                      <Txt size={13} color={colors.muted}>
                        {new Date(t.at).toLocaleDateString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                        })}{' '}
                        · {t.status}
                      </Txt>
                    </View>
                    <Txt weight="semi" size={15}>
                      −{formatUsd(BigInt(t.amount))}
                    </Txt>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </Screen>
  )
}

function Action({
  icon,
  label,
  onPress,
  disabled,
  fill = colors.surface,
}: {
  icon: IconName
  label: string
  onPress: () => void
  disabled?: boolean
  fill?: string
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.action, { backgroundColor: fill }]}
    >
      <Icon name={icon} size={18} />
      <Txt weight="semi" size={15}>
        {label}
      </Txt>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  body: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 32 },
  title: { letterSpacing: -0.8, textAlign: 'center' },
  lead: { lineHeight: 23, marginTop: 8, textAlign: 'center' },
  card: {
    marginTop: 14,
    aspectRatio: 1.586,
    padding: 20,
    justifyContent: 'space-between',
    borderWidth: 2,
    borderColor: colors.ink,
    borderRadius: 24,
    backgroundColor: colors.ink,
  },
  cardFrozen: { backgroundColor: '#3E4C4F' },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chip: {
    paddingVertical: 3,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: colors.surface,
  },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  action: {
    flex: 1,
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 2,
    borderColor: colors.ink,
    borderRadius: 20,
  },
  section: { marginTop: 22, marginBottom: 8, marginLeft: 4 },
  limits: { flexDirection: 'row', gap: 8 },
  limit: {
    flex: 1,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.ink,
    borderRadius: 999,
    backgroundColor: colors.surface,
  },
  limitOn: { backgroundColor: colors.ink },
  list: {
    paddingHorizontal: 16,
    borderWidth: 2,
    borderColor: colors.ink,
    borderRadius: 22,
    backgroundColor: colors.surface,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  rule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(11,26,29,0.18)' },
})
