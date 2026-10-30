import { MAX_SPLIT_SHARES, SPLIT_WHOLE, splitAmount, splitProblem } from '@kova/monad'
import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  type ColorValue,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native'
import { FadeIn } from 'react-native-reanimated'
import { type Address, getAddress, isAddressEqual } from 'viem'
import { getSplits, notSwitchedOn, type ShopSplits, type SplitShareOut } from '@/lib/api'
import { formatUsd } from '@/lib/money'
import { percent, saveShopSplits, shortAddress } from '@/lib/programs'
import { useStall } from '@/lib/stall'
import { colors, pair } from '@/lib/theme'
import { isUnnamed, useWallet } from '@/lib/wallet'
import Animated from '@/ui/animated'
import { Avatar, Kovi } from '@/ui/art'
import { Icon, type IconName } from '@/ui/Icon'
import { Field } from '@/ui/Keys'
import { PersonPicker, type Picked } from '@/ui/PersonPicker'
import { ComingSoon, useNames } from '@/ui/Programs'
import { Header, PillButton, Screen, TextLink, Txt } from '@/ui/primitives'
import { Sheet } from '@/ui/travel/Sheet'

/** Each share's colour, in the bar and beside its row. What's left for the shop is the white. */
const tones: ColorValue[] = [
  colors.coral,
  colors.teal,
  colors.yellow,
  colors.tealLight,
  colors.blush,
]
const sales = [10_000_000n, 50_000_000n, 100_000_000n]
/** The percentage steps: half a percent. */
const STEP = 50

const same = (a: SplitShareOut[], b: SplitShareOut[]) =>
  a.length === b.length &&
  a.every(
    (s, i) =>
      isAddressEqual(s.to, b[i]?.to ?? '0x0000000000000000000000000000000000000000') &&
      s.bps === b[i]?.bps &&
      (s.name ?? '') === (b[i]?.name ?? ''),
  )

/**
 * Splits: every sale shared out the moment it lands, by rules the shop's wallet signs. Up to five
 * shares (10% to savings, 5% to a partner), and the rest to the shop. No shares turns it off.
 */
export default function Splits() {
  const { owned } = useStall()
  const { profile, signTypedData } = useWallet()
  const [data, setData] = useState<ShopSplits | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [draft, setDraft] = useState<SplitShareOut[]>([])
  const [editing, setEditing] = useState<number | 'new' | null>(null)
  const [sale, setSale] = useState(sales[0] ?? 10_000_000n)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [confirmOff, setConfirmOff] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    if (!owned) return
    try {
      const next = await getSplits()
      setData(next)
      if (next.live) setDraft(next.shares)
      setProblem(null)
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Kova is unreachable. Try again.')
    }
  }, [owned])
  useEffect(() => {
    void load()
  }, [load])

  const names = useNames(draft.map((s) => s.to))
  const labelOf = (s: SplitShareOut) => s.name?.trim() || names(s.to)

  if (!owned)
    return (
      <Screen>
        <Header title="Splits" />
        <View style={styles.body}>
          <Notice
            icon="lock"
            title="Splits are set by the shop’s owner"
            text="Open them on the phone that opened the shop, or at mykova.app. This phone takes payments for the shop, and can’t change where they go."
          />
        </View>
      </Screen>
    )

  const live = data?.live ? data : null
  const owner = live ? getAddress(live.owner) : null
  const mine = Boolean(owner && profile && isAddressEqual(owner, profile.address as Address))
  const saved = live?.shares ?? []
  const dirty = live ? !same(draft, saved) : false
  const issue = owner ? splitProblem(draft, owner) : null
  const total = draft.reduce((a, s) => a + s.bps, 0)
  const { parts, kept } = splitAmount(sale, draft)

  const save = async (shares: SplitShareOut[], off = false) => {
    if (!owner) return
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const clean = shares.map((s) => ({
        to: getAddress(s.to),
        bps: s.bps,
        ...(s.name?.trim() ? { name: s.name.trim().slice(0, 40) } : {}),
      }))
      const next = await saveShopSplits(owner, clean, signTypedData)
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setData(next)
      if (next.live) setDraft(next.shares)
      setConfirmOff(false)
      setDone(
        off || clean.length === 0
          ? 'Splits are off. Every sale goes to you again.'
          : 'Saved. From the next sale, each one is shared out as it lands.',
      )
    } catch (e) {
      if (notSwitchedOn(e)) {
        setData({ object: 'splits', live: false })
        return
      }
      const text = e instanceof Error ? e.message : 'The splits didn’t save. Nothing changed.'
      if (!/cancel/i.test(text)) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
        setError(text)
      }
    } finally {
      setBusy(false)
    }
  }

  const editingShare = typeof editing === 'number' ? draft[editing] : undefined

  return (
    <Screen>
      <Header title="Splits" />
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.ink}
            onRefresh={() => {
              setRefreshing(true)
              void load().finally(() => setRefreshing(false))
            }}
          />
        }
      >
        {!data ? (
          problem ? (
            <View style={styles.center}>
              <Kovi pose="oops" size={120} />
              <Txt weight="semi" size={18} style={{ marginTop: 6 }}>
                Couldn’t load your splits
              </Txt>
              <Txt size={14} color={colors.muted} style={styles.centerText}>
                {problem}
              </Txt>
              <View style={{ alignSelf: 'stretch', marginTop: 16 }}>
                <PillButton
                  label="Try again"
                  icon="swap"
                  tone="white"
                  onPress={() => void load()}
                />
              </View>
            </View>
          ) : (
            <View style={styles.center}>
              <ActivityIndicator color={colors.ink} />
              <Txt size={15} color={colors.muted} style={{ marginTop: 10 }}>
                Opening…
              </Txt>
            </View>
          )
        ) : !live ? (
          <ComingSoon
            title="Share every sale"
            lead="Send part of every sale somewhere else the moment it lands: your savings, a partner, a landlord. The rest comes to you."
            facts={[
              ['Shares', 'Up to 5, by percentage'],
              ['When', 'As each sale lands'],
              ['Set by', 'The wallet your shop is paid into'],
            ]}
            note="Splits are switching on soon."
          />
        ) : live.private_takings ? (
          <Notice
            icon="lock"
            title="Turn off private takings to use splits."
            text="Private takings pay each sale to its own one-time address, so a sale can’t be shared out as it lands. Turn private takings off on Shop, then come back."
            action={{ label: 'Back to Shop', onPress: () => router.back() }}
          />
        ) : !mine ? (
          <Notice
            icon="user"
            title="Your shop’s wallet signs its splits"
            text={`Your shop is paid into ${shortAddress(live.owner)}, and only that wallet can set where its sales go. This phone’s wallet is ${profile ? shortAddress(profile.address) : 'a different one'}. Open Kova with the shop’s wallet to set splits.`}
          />
        ) : (
          <View style={{ gap: 14, paddingTop: 6 }}>
            <Txt size={16} color={colors.onTint} style={{ lineHeight: 22 }}>
              Share out every sale the moment it lands: some to savings, some to a partner. The rest
              comes to you.
            </Txt>

            <View style={styles.hero}>
              <View style={styles.heroTop}>
                <Txt weight="semi" size={14} color={colors.onInk}>
                  Every sale, shared out
                </Txt>
                <View
                  style={[
                    styles.status,
                    { backgroundColor: live.on ? colors.teal : 'rgba(255,255,255,0.14)' },
                  ]}
                >
                  <View
                    style={[
                      styles.statusDot,
                      { backgroundColor: live.on ? colors.white : colors.onInk },
                    ]}
                  />
                  <Txt weight="bold" size={12} color={colors.white}>
                    {live.on ? 'On' : 'Off'}
                  </Txt>
                </View>
              </View>
              <View
                style={styles.bar}
                accessibilityLabel={`${percent(SPLIT_WHOLE - total)} to you`}
              >
                {draft.map((s, i) =>
                  s.bps > 0 ? (
                    <View
                      key={s.to}
                      style={{ flex: s.bps, backgroundColor: tones[i % tones.length] }}
                    />
                  ) : null,
                )}
                {SPLIT_WHOLE - total > 0 ? (
                  <View style={{ flex: SPLIT_WHOLE - total, backgroundColor: colors.white }} />
                ) : null}
              </View>
              <Txt weight="bold" size={40} color={colors.white} style={styles.big}>
                {formatUsd(kept)}
                <Txt weight="semi" size={16} color={colors.onInk}>
                  {'  '}to you
                </Txt>
              </Txt>
              <Txt size={14} color={colors.onInk} style={{ lineHeight: 20 }}>
                {draft.length === 0
                  ? 'No shares yet. All of every sale comes to you.'
                  : `Of a ${formatUsd(sale)} sale: ${draft
                      .map((s, i) => `${formatUsd(parts[i] ?? 0n)} to ${labelOf(s)}`)
                      .join(' · ')} · ${formatUsd(kept)} to you`}
              </Txt>
              <View style={styles.sales}>
                {sales.map((v) => (
                  <Pressable
                    key={String(v)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: v === sale }}
                    accessibilityLabel={`Show a ${formatUsd(v)} sale`}
                    onPress={() => {
                      void Haptics.selectionAsync()
                      setSale(v)
                    }}
                    style={[styles.sale, v === sale && styles.saleOn]}
                  >
                    <Txt weight="bold" size={13} color={v === sale ? colors.dark : colors.white}>
                      {formatUsd(v).replace('.00', '')}
                    </Txt>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.sectionHead}>
              <Txt weight="bold" size={20}>
                Shares
              </Txt>
              <Txt weight="semi" size={13} color={colors.muted}>
                {draft.length} of {MAX_SPLIT_SHARES}
              </Txt>
            </View>

            <View style={styles.list}>
              {draft.map((s, i) => (
                <Pressable
                  key={s.to}
                  accessibilityRole="button"
                  accessibilityLabel={`${labelOf(s)}, ${percent(s.bps)}. Change it`}
                  onPress={() => {
                    setDone(null)
                    setEditing(i)
                  }}
                  style={({ pressed }) => [
                    styles.row,
                    styles.rule,
                    pressed && { backgroundColor: colors.sunken },
                  ]}
                >
                  <View>
                    <Avatar name={labelOf(s)} id={s.to} size={42} />
                    <View style={[styles.swatch, { backgroundColor: tones[i % tones.length] }]} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Txt weight="semi" size={16} numberOfLines={1}>
                      {labelOf(s)}
                    </Txt>
                    <Txt size={13} color={colors.muted} numberOfLines={1}>
                      {shortAddress(s.to)}
                    </Txt>
                  </View>
                  <View style={styles.pct}>
                    <Txt weight="bold" size={14}>
                      {percent(s.bps)}
                    </Txt>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${labelOf(s)}`}
                    hitSlop={6}
                    onPress={() => {
                      void Haptics.selectionAsync()
                      setDone(null)
                      setDraft((d) => d.filter((_, j) => j !== i))
                    }}
                    style={styles.trash}
                  >
                    <Icon name="trash" size={16} />
                  </Pressable>
                </Pressable>
              ))}
              <View style={styles.row}>
                <View style={styles.youDot}>
                  <Icon name="stall" size={20} color={colors.dark} />
                </View>
                <View style={{ flex: 1 }}>
                  <Txt weight="semi" size={16}>
                    You
                  </Txt>
                  <Txt size={13} color={colors.muted}>
                    The rest, into {shortAddress(live.owner)}
                  </Txt>
                </View>
                <View style={[styles.pct, { backgroundColor: colors.tealSoft }]}>
                  <Txt weight="bold" size={14}>
                    {percent(Math.max(0, SPLIT_WHOLE - total))}
                  </Txt>
                </View>
              </View>
            </View>

            {draft.length < MAX_SPLIT_SHARES ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setDone(null)
                  setEditing('new')
                }}
                style={({ pressed }) => [styles.add, pressed && { transform: [{ scale: 0.98 }] }]}
              >
                <View style={styles.addIcon}>
                  <Icon name="plus" size={18} color={colors.white} />
                </View>
                <View style={{ flex: 1 }}>
                  <Txt weight="semi" size={16}>
                    Add a share
                  </Txt>
                  <Txt size={13} color={colors.muted}>
                    {draft.length === 0
                      ? 'Savings, a partner, anyone with a wallet'
                      : `${MAX_SPLIT_SHARES - draft.length} more at most`}
                  </Txt>
                </View>
              </Pressable>
            ) : (
              <Txt size={13} color={colors.muted} style={{ textAlign: 'center' }}>
                Five shares is the most. Remove one to add another.
              </Txt>
            )}

            {dirty && issue ? (
              <View style={styles.issue}>
                <Icon name="info" size={16} color={colors.danger} />
                <Txt weight="medium" size={14} style={{ flex: 1, lineHeight: 19 }}>
                  {issue}
                </Txt>
              </View>
            ) : null}
            {error ? (
              <Animated.View entering={FadeIn} style={styles.issue}>
                <Icon name="info" size={16} color={colors.danger} />
                <Txt weight="medium" size={14} color={colors.danger} style={{ flex: 1 }}>
                  {error}
                </Txt>
              </Animated.View>
            ) : null}
            {done ? (
              <Animated.View entering={FadeIn} style={styles.done}>
                <Icon name="check" size={18} />
                <Txt weight="semi" size={14} style={{ flex: 1, lineHeight: 19 }}>
                  {done}
                </Txt>
              </Animated.View>
            ) : null}

            {dirty ? (
              <View style={{ gap: 10 }}>
                <PillButton
                  label={busy ? 'Saving…' : draft.length === 0 ? 'Turn splits off' : 'Save splits'}
                  icon="face"
                  loading={busy}
                  disabled={!!issue}
                  onPress={() => void save(draft)}
                />
                <View style={{ alignItems: 'center' }}>
                  <TextLink
                    label="Undo changes"
                    color={colors.muted}
                    onPress={() => {
                      setDraft(saved)
                      setError(null)
                    }}
                  />
                </View>
              </View>
            ) : saved.length > 0 ? (
              confirmOff ? (
                <Animated.View entering={FadeIn.duration(200)} style={styles.confirm}>
                  <Txt weight="semi" size={16}>
                    Turn splits off?
                  </Txt>
                  <Txt size={14} color={colors.muted} style={{ lineHeight: 20 }}>
                    From the next sale, all of it comes to you. What’s already been shared out stays
                    where it went. One Face ID tap.
                  </Txt>
                  <View style={styles.confirmRow}>
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() => setConfirmOff(false)}
                      style={[styles.small, { backgroundColor: colors.surface }]}
                    >
                      <Txt weight="semi" size={15}>
                        Keep them
                      </Txt>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() => void save([], true)}
                      style={[
                        styles.small,
                        { backgroundColor: colors.danger, borderColor: colors.danger },
                      ]}
                    >
                      {busy ? (
                        <ActivityIndicator color={colors.white} />
                      ) : (
                        <Txt weight="semi" size={15} color={colors.white}>
                          Turn off
                        </Txt>
                      )}
                    </Pressable>
                  </View>
                </Animated.View>
              ) : (
                <View style={{ alignItems: 'center' }}>
                  <TextLink
                    label="Turn splits off"
                    color={colors.danger}
                    onPress={() => {
                      setDone(null)
                      setConfirmOff(true)
                    }}
                  />
                </View>
              )
            ) : null}

            <Txt size={13} color={colors.muted} style={styles.fine}>
              Shares go out on Monad in the same moment a sale lands. A Kova Card tap or a direct
              payment is shared out moments later. Only your shop’s wallet can change them, and Kova
              covers the fee.
            </Txt>
          </View>
        )}
      </ScrollView>

      {owner ? (
        <ShareSheet
          visible={editing !== null}
          share={editingShare}
          others={draft.filter((_, i) => i !== editing)}
          owner={owner}
          sale={sale}
          labelOf={labelOf}
          onClose={() => setEditing(null)}
          onSave={(share) => {
            setDraft((d) =>
              typeof editing === 'number'
                ? d.map((s, i) => (i === editing ? share : s))
                : [...d, share],
            )
            setEditing(null)
          }}
          onRemove={
            typeof editing === 'number'
              ? () => {
                  setDraft((d) => d.filter((_, i) => i !== editing))
                  setEditing(null)
                }
              : undefined
          }
        />
      ) : null}
    </Screen>
  )
}

/** One share: who gets it, what you call it, and how much of every sale. */
function ShareSheet({
  visible,
  share,
  others,
  owner,
  sale,
  labelOf,
  onClose,
  onSave,
  onRemove,
}: {
  visible: boolean
  share: SplitShareOut | undefined
  others: SplitShareOut[]
  owner: Address
  sale: bigint
  labelOf: (s: SplitShareOut) => string
  onClose: () => void
  onSave: (share: SplitShareOut) => void
  onRemove?: () => void
}) {
  const [to, setTo] = useState<Picked | null>(null)
  const [name, setName] = useState('')
  const [bps, setBps] = useState(1000)
  const room = SPLIT_WHOLE - others.reduce((a, s) => a + s.bps, 0)

  // Fresh each time it opens: the share being changed, or a new one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the sheet opens, not while typing
  useEffect(() => {
    if (!visible) return
    setTo(share ? { address: getAddress(share.to), name: share.name } : null)
    setName(share ? labelOf(share) : '')
    setBps(share ? share.bps : Math.min(1000, Math.max(STEP, room)))
  }, [visible])

  const over = bps > room
  const each = splitAmount(sale, [{ bps }]).parts[0] ?? 0n

  return (
    <Sheet visible={visible} onClose={onClose} tall>
      {!to ? (
        <ScrollView keyboardShouldPersistTaps="handled" style={{ marginTop: 12 }}>
          <PersonPicker
            title="Who gets a share?"
            lead="Your savings wallet, a partner, a landlord: anyone with a wallet."
            maxListHeight={64 * 4}
            refuse={(a) =>
              isAddressEqual(a, owner)
                ? 'The rest already goes to you; no need for a share.'
                : others.some((s) => isAddressEqual(s.to, a))
                  ? 'They already have a share. Tap theirs to change it.'
                  : null
            }
            onPick={(p) => {
              setTo(p)
              if (!name.trim() && p.name && !isUnnamed(p.name)) setName(p.name)
            }}
          />
        </ScrollView>
      ) : (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          style={{ marginTop: 12 }}
          contentContainerStyle={{ gap: 14, paddingBottom: 8 }}
        >
          <Txt weight="bold" size={26} style={{ letterSpacing: -0.6 }}>
            {share ? 'Change this share' : 'New share'}
          </Txt>
          <View style={styles.person}>
            <Avatar name={name || to.address} id={to.address} size={44} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt weight="semi" size={16} numberOfLines={1}>
                {name.trim() || shortAddress(to.address)}
              </Txt>
              <Txt size={13} color={colors.muted} numberOfLines={1}>
                {shortAddress(to.address)}
              </Txt>
            </View>
            <TextLink label="Change" onPress={() => setTo(null)} />
          </View>
          <Field
            label="What you call it"
            value={name}
            onChange={(v) => setName(v.slice(0, 40))}
            placeholder="Savings, Ada, Rent"
          />

          <View style={styles.pctBox}>
            <Txt weight="bold" size={13} color={colors.muted}>
              Share of every sale
            </Txt>
            <View style={styles.stepper}>
              <StepButton
                icon="minus"
                label="Less"
                disabled={bps <= STEP}
                onPress={() => setBps((b) => Math.max(STEP, b - STEP))}
              />
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Txt
                  weight="bold"
                  size={48}
                  color={over ? colors.danger : colors.ink}
                  style={styles.big}
                >
                  {percent(bps)}
                </Txt>
                <Txt size={13} color={colors.muted}>
                  {formatUsd(each)} of every {formatUsd(sale)}
                </Txt>
              </View>
              <StepButton
                icon="plus"
                label="More"
                disabled={bps + STEP > room}
                onPress={() => setBps((b) => Math.min(room, b + STEP))}
              />
            </View>
            <View style={styles.chips}>
              {[500, 1000, 1500, 2000, 2500].map((v) => (
                <Pressable
                  key={v}
                  accessibilityRole="button"
                  accessibilityState={{ selected: bps === v, disabled: v > room }}
                  disabled={v > room}
                  onPress={() => {
                    void Haptics.selectionAsync()
                    setBps(v)
                  }}
                  style={[styles.chip, bps === v && styles.chipOn, v > room && { opacity: 0.35 }]}
                >
                  <Txt weight="bold" size={14} color={bps === v ? colors.onChosen : colors.ink}>
                    {percent(v)}
                  </Txt>
                </Pressable>
              ))}
            </View>
            <Txt size={13} color={over ? colors.danger : colors.muted}>
              {over
                ? `The other shares leave ${percent(room)}. Make this one smaller.`
                : `${percent(room - bps)} still comes to you after this.`}
            </Txt>
          </View>

          <PillButton
            label={share ? 'Update share' : 'Add share'}
            icon="check"
            disabled={over || bps <= 0}
            onPress={() =>
              onSave({
                to: getAddress(to.address),
                bps,
                ...(name.trim() ? { name: name.trim() } : {}),
              })
            }
          />
          {onRemove ? (
            <View style={{ alignItems: 'center' }}>
              <TextLink label="Remove this share" color={colors.danger} onPress={onRemove} />
            </View>
          ) : null}
          <Txt size={12} color={colors.muted} style={{ textAlign: 'center' }}>
            Nothing changes until you save your splits.
          </Txt>
        </ScrollView>
      )}
    </Sheet>
  )
}

function Notice({
  icon,
  title,
  text,
  action,
}: {
  icon: IconName
  title: string
  text: string
  action?: { label: string; onPress: () => void }
}) {
  return (
    <View style={{ paddingTop: 12 }}>
      <View style={styles.noticeArt}>
        <Kovi pose="key" size={130} />
      </View>
      <View style={styles.notice}>
        <View style={styles.noticeIcon}>
          <Icon name={icon} size={18} color={colors.white} />
        </View>
        <Txt weight="bold" size={20} style={{ letterSpacing: -0.4 }}>
          {title}
        </Txt>
        <Txt size={15} color={colors.onTint} style={{ lineHeight: 21 }}>
          {text}
        </Txt>
      </View>
      {action ? (
        <View style={{ marginTop: 16 }}>
          <PillButton label={action.label} icon="back" tone="white" onPress={action.onPress} />
        </View>
      ) : null}
    </View>
  )
}

function StepButton({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: IconName
  label: string
  disabled?: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => {
        void Haptics.selectionAsync()
        onPress()
      }}
      style={({ pressed }) => [
        styles.stepButton,
        disabled && { opacity: 0.35 },
        pressed && { transform: [{ scale: 0.92 }], backgroundColor: colors.sunken },
      ]}
    >
      <Icon name={icon} size={22} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  body: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  centerText: { textAlign: 'center', marginTop: 4, lineHeight: 20 },
  big: { letterSpacing: -1.6 },
  hero: { borderRadius: 28, backgroundColor: colors.fill, padding: 18, gap: 10 },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 26,
    paddingHorizontal: 10,
    borderRadius: 13,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  bar: {
    flexDirection: 'row',
    height: 16,
    borderRadius: 8,
    overflow: 'hidden',
    gap: 2,
    backgroundColor: colors.fill,
  },
  sales: { flexDirection: 'row', gap: 8, marginTop: 2 },
  sale: {
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 15,
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  saleOn: { backgroundColor: colors.yellow },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  list: {
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 64,
  },
  rule: { borderBottomWidth: 1, borderColor: colors.sunken },
  swatch: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  pct: {
    minWidth: 58,
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 15,
    backgroundColor: colors.sunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trash: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.sunken,
  },
  youDot: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 22,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.edge,
  },
  addIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.coral,
    alignItems: 'center',
    justifyContent: 'center',
  },
  issue: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: 16,
    backgroundColor: colors.coralSoft,
  },
  done: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 16,
    backgroundColor: colors.tealSoft,
  },
  confirm: {
    gap: 6,
    padding: 14,
    borderRadius: 18,
    backgroundColor: pair('#FBEDEA', '#2A1714'),
  },
  confirmRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  small: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fine: { marginTop: 6, lineHeight: 18, textAlign: 'center' },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.line,
  },
  pctBox: { gap: 10, padding: 14, borderRadius: 22, backgroundColor: colors.surface },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chips: { flexDirection: 'row', gap: 6 },
  chip: {
    flex: 1,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: colors.chosen, borderColor: colors.chosen },
  noticeArt: { alignItems: 'center', height: 140 },
  notice: {
    gap: 8,
    padding: 18,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  noticeIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
