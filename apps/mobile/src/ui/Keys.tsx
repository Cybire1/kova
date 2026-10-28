import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, Share, StyleSheet, TextInput, View } from 'react-native'
import { type Address, getAddress, isAddress } from 'viem'
import {
  answer,
  type KeyPayment,
  type KeysList,
  leftLine,
  limitLine,
  listKeys,
  type SpendKey,
  spendFrom,
} from '@/lib/spend-keys'
import { colors, fonts } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Icon, type IconName } from '@/ui/Icon'
import { Txt } from '@/ui/primitives'

/**
 * Keys, as Home and the Keys screen show them: an agent's payment waiting for your yes, and the
 * allowances or budgets someone gave you, each spendable straight from their wallet.
 */

export const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`

/** The wallet's keys, kept fresh every few seconds while the screen is up. */
export function useKeys() {
  const { profile } = useWallet()
  const [list, setList] = useState<KeysList | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const load = useCallback(async () => {
    if (!profile) return
    try {
      setList(await listKeys(profile.address as Address))
      setProblem(null)
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Kova is unreachable.')
    }
  }, [profile])
  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), 8_000)
    return () => clearInterval(timer)
  }, [load])
  return { list, problem, load }
}

export function KeyIcon({ name, tone = colors.tealSoft }: { name: IconName; tone?: string }) {
  return (
    <View style={[styles.icon, { backgroundColor: tone }]}>
      <Icon name={name} size={18} color={colors.ink} />
    </View>
  )
}

export function Mini({
  label,
  onPress,
  ink,
  busy,
  icon,
}: {
  label: string
  onPress: () => void
  ink?: boolean
  busy?: boolean
  icon?: IconName
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.mini,
        ink && styles.miniInk,
        (pressed || busy) && { opacity: 0.6 },
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={ink ? colors.white : colors.ink} />
      ) : icon ? (
        <Icon name={icon} size={14} color={ink ? colors.white : colors.ink} />
      ) : null}
      <Txt weight="bold" size={14} color={ink ? colors.white : colors.ink}>
        {label}
      </Txt>
    </Pressable>
  )
}

export function Field({
  label,
  value,
  onChange,
  placeholder,
  money,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  money?: boolean
}) {
  return (
    <View style={styles.field}>
      <Txt weight="bold" size={13} color={colors.muted}>
        {label}
      </Txt>
      <TextInput
        value={value}
        onChangeText={(v) => onChange(money ? v.replace(/[^0-9.]/g, '') : v)}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        keyboardType={money ? 'decimal-pad' : 'default'}
        autoCapitalize={money ? 'none' : 'words'}
        autoCorrect={false}
        style={styles.input}
        accessibilityLabel={label}
      />
    </View>
  )
}

export function Approval({ payment, onDone }: { payment: KeyPayment; onDone: () => void }) {
  const { profile, signMessage } = useWallet()
  const [busy, setBusy] = useState<'approve' | 'decline' | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  if (!profile) return null
  const go = (decision: 'approve' | 'decline') => {
    setBusy(decision)
    setProblem(null)
    answer(profile.address as Address, payment, decision, signMessage)
      .then(() => {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        onDone()
      })
      .catch((e: unknown) => setProblem(e instanceof Error ? e.message : 'That didn’t go through.'))
      .finally(() => setBusy(null))
  }
  return (
    <View style={[styles.row, styles.approval]}>
      <KeyIcon name="bolt" tone={colors.coralSoft} />
      <View style={styles.rowText}>
        <Txt weight="bold" size={16}>
          {payment.key_name ?? 'An agent'} wants to pay ${payment.amount}
        </Txt>
        <Txt size={13} color={colors.onTint}>
          To {payment.description ?? short(payment.to)}
        </Txt>
        {problem ? (
          <Txt size={13} color={colors.danger}>
            {problem}
          </Txt>
        ) : null}
      </View>
      <View style={styles.actions}>
        <Mini label="No" busy={busy === 'decline'} onPress={() => go('decline')} />
        <Mini label="Pay" ink busy={busy === 'approve'} onPress={() => go('approve')} />
      </View>
    </View>
  )
}

export function Received({ spendKey, onDone }: { spendKey: SpendKey; onDone?: () => void }) {
  const { profile, signMessage } = useWallet()
  const [open, setOpen] = useState(false)
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<KeyPayment | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  if (!profile) return null
  const from = spendKey.owner_name ?? short(spendKey.owner)
  const pay = () => {
    setBusy(true)
    setProblem(null)
    const charge = /\bpi_[0-9a-z]{26}\b/.exec(to)?.[0]
    spendFrom(
      spendKey,
      profile.address as Address,
      charge ? { charge } : { to: getAddress(to), amount },
      signMessage,
    )
      .then((paid) => {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        setDone(paid)
        onDone?.()
      })
      .catch((e: unknown) => setProblem(e instanceof Error ? e.message : 'That didn’t go through.'))
      .finally(() => setBusy(false))
  }
  return (
    <View style={[styles.allowance, spendKey.frozen && { backgroundColor: '#6F8384' }]}>
      <View style={styles.allowanceTop}>
        <View style={[styles.icon, { backgroundColor: 'rgba(255,255,255,0.22)' }]}>
          <Icon name="sparkle" size={18} color={colors.white} />
        </View>
        <View style={styles.rowText}>
          <Txt size={13} color="rgba(255,255,255,0.8)">
            {spendKey.kind === 'team' ? `Budget from ${from}` : `From ${from}`}
          </Txt>
          <Txt weight="bold" size={19} color={colors.white}>
            {spendKey.frozen ? 'Frozen for now' : leftLine(spendKey)}
          </Txt>
          <Txt size={13} color="rgba(255,255,255,0.8)">
            {limitLine(spendKey)}
          </Txt>
        </View>
        {spendKey.frozen ? null : (
          <Mini label={open ? 'Close' : 'Spend'} onPress={() => setOpen(!open)} />
        )}
      </View>
      {open ? (
        done ? (
          <Txt weight="bold" size={15} color={colors.white} style={{ marginTop: 12 }}>
            Paid ${done.amount}.
          </Txt>
        ) : (
          <View style={styles.form}>
            <Field
              label="Pay"
              value={to}
              onChange={(v) => setTo(v.trim())}
              placeholder="0x… their address, or a shop’s pay link"
            />
            <Field label="How much" value={amount} onChange={setAmount} placeholder="0.00" money />
            {problem ? (
              <Txt size={13} color={colors.danger}>
                {problem}
              </Txt>
            ) : null}
            <Mini
              label={
                busy
                  ? 'Paying…'
                  : `Pay from ${from}’s ${spendKey.kind === 'team' ? 'budget' : 'allowance'}`
              }
              ink
              busy={busy}
              onPress={() =>
                /\bpi_[0-9a-z]{26}\b/.test(to) || (isAddress(to) && amount)
                  ? pay()
                  : setProblem('Add who to pay and how much, or paste a shop’s pay link.')
              }
            />
          </View>
        )
      ) : null}
    </View>
  )
}

/** On Home: anything waiting for your yes, and allowances you were given. */
export function KeysOnHome() {
  const { list, load } = useKeys()
  if (!list || (list.approvals.length === 0 && list.received.length === 0)) return null
  return (
    <View style={{ gap: 10 }}>
      {list.approvals.slice(0, 2).map((p) => (
        <Approval key={p.id} payment={p} onDone={load} />
      ))}
      {list.received.map((k) => (
        <Received key={k.id} spendKey={k} onDone={load} />
      ))}
    </View>
  )
}

export async function copyAndTell(text: string) {
  await Clipboard.setStringAsync(text)
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
}

export async function shareLink(message: string, url: string) {
  await Share.share({ message: `${message} ${url}`, url }).catch(() => {})
}

export const styles = StyleSheet.create({
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  mini: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
  },
  miniInk: { backgroundColor: colors.ink },
  field: { gap: 4 },
  input: {
    height: 46,
    paddingHorizontal: 16,
    borderWidth: 2,
    borderColor: colors.ink,
    borderRadius: 23,
    backgroundColor: colors.white,
    fontFamily: fonts.semi,
    fontSize: 16,
    color: colors.ink,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderWidth: 2,
    borderColor: colors.ink,
    borderRadius: 22,
    backgroundColor: colors.surface,
  },
  approval: { borderColor: colors.coral, backgroundColor: '#FBEDEA' },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  actions: { flexDirection: 'row', gap: 6 },
  allowance: { padding: 14, borderRadius: 24, backgroundColor: colors.tealDeep },
  allowanceTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  form: { gap: 10, marginTop: 12, padding: 12, borderRadius: 18, backgroundColor: colors.surface },
})
