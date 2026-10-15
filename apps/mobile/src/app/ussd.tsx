import { normalizePhone, pinProblem } from '@kova/monad'
import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import {
  changePocket,
  confirmCode,
  getPocket,
  type Pocket,
  setUpPocket,
  takeBack,
  turnOff,
} from '@/lib/pocket'
import { colors } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Icon } from '@/ui/Icon'
import { Chip, Header, PillButton, Rise, Screen, Sticker, TextLink, Txt } from '@/ui/primitives'

/**
 * Pay by USSD: a small pocket of your dollars you can spend from any phone, even one with no data,
 * by dialling Kova's code. Your main wallet stays yours alone; the pocket is the part Kova holds
 * for you, up to a limit you choose, and you can take it back any time.
 */

const CAPS = ['20', '50', '100']
const TOP_UPS = ['5', '10', '20', '50']

const usd = (text: string | null) => (text === null ? '—' : `$${Number(text).toFixed(2)}`)

export default function Ussd() {
  const { profile, send, signMessage, balance } = useWallet()
  const [pocket, setPocket] = useState<Pocket | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!profile) return
    try {
      setPocket(await getPocket(profile.address))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kova is unreachable.')
    }
  }, [profile])

  useEffect(() => {
    void load()
  }, [load])

  // While a payment might be landing, keep the pocket fresh.
  useEffect(() => {
    if (pocket?.status !== 'active') return
    const id = setInterval(() => void load(), 6000)
    return () => clearInterval(id)
  }, [pocket?.status, load])

  const run = async (label: string, job: () => Promise<Pocket | void>) => {
    setBusy(label)
    setError(null)
    try {
      const next = await job()
      if (next) setPocket(next)
      else await load()
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t work. Try again.')
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
    } finally {
      setBusy(null)
    }
  }

  if (!profile) return null

  return (
    <Screen bg={colors.paper}>
      <Header title="Pay by USSD" backIcon="close" />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {pocket === null ? (
          <View style={styles.loading}>
            {error ? (
              <Txt color={colors.danger}>{error}</Txt>
            ) : (
              <ActivityIndicator color={colors.ink} />
            )}
          </View>
        ) : pocket.status === 'none' ? (
          <SetUp
            busy={busy}
            error={error}
            dial={pocket.dial}
            onSubmit={(input) =>
              run('setup', () => setUpPocket(signMessage, profile.address, input))
            }
          />
        ) : pocket.status === 'pending' ? (
          <Confirm
            phone={pocket.phone}
            busy={busy}
            error={error}
            onSubmit={(code) => run('code', () => confirmCode(profile.address, code))}
            onRestart={() => setPocket({ status: 'none', dial: pocket.dial })}
          />
        ) : (
          <Live
            pocket={pocket}
            busy={busy}
            error={error}
            wallet={balance}
            onTopUp={(amount) =>
              run('topup', async () => {
                await send(
                  { address: pocket.address, name: 'USSD pocket' },
                  BigInt(amount) * 1_000_000n,
                )
              })
            }
            onTakeBack={() =>
              run('back', () => takeBack(signMessage, profile.address, pocket.balance ?? '0'))
            }
            onCap={(cap) => run('cap', () => changePocket(signMessage, profile.address, { cap }))}
            onPin={(pin) => run('pin', () => changePocket(signMessage, profile.address, { pin }))}
            onOff={() => run('off', () => turnOff(signMessage, profile.address))}
          />
        )}
      </ScrollView>
    </Screen>
  )
}

/** A feature phone showing Kova's USSD menu: what you'll see when you dial. */
function FeaturePhone({ dial }: { dial: string }) {
  return (
    <View
      style={styles.phone}
      accessibilityLabel={`A basic phone showing Kova's menu after dialling ${dial}`}
    >
      <View style={styles.speaker} />
      <View style={styles.phoneScreen}>
        <Txt weight="bold" size={13}>
          Kova
        </Txt>
        {['1 Balance', '2 Pay a till', '3 Send to a phone', '4 My payments'].map((line) => (
          <Txt key={line} weight="medium" size={12}>
            {line}
          </Txt>
        ))}
      </View>
      <View style={styles.keys}>
        {Array.from({ length: 12 }, (_, i) => (
          <View key={i} style={styles.key} />
        ))}
      </View>
    </View>
  )
}

function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) {
  const { label, style, ...rest } = props
  return (
    <View style={{ gap: 6 }}>
      <Txt weight="semi" size={14}>
        {label}
      </Txt>
      <TextInput placeholderTextColor="#8C9799" style={[styles.input, style]} {...rest} />
    </View>
  )
}

function Problem({ text }: { text: string | null }) {
  return text ? (
    <Txt size={14} color={colors.danger} style={{ marginTop: 10, lineHeight: 20 }}>
      {text}
    </Txt>
  ) : null
}

function SetUp({
  busy,
  error,
  dial,
  onSubmit,
}: {
  busy: string | null
  error: string | null
  dial: string
  onSubmit: (input: { phone: string; pin: string; cap: string }) => void
}) {
  const [phone, setPhone] = useState('')
  const [pin, setPin] = useState('')
  const [again, setAgain] = useState('')
  const [cap, setCap] = useState('50')
  const normalized = normalizePhone(phone)
  const pinIssue = pin ? pinProblem(pin) : null
  const mismatch = again.length >= pin.length && again !== '' && again !== pin
  const ready = Boolean(normalized) && pin !== '' && !pinIssue && again === pin
  return (
    <>
      <Rise>
        <View style={styles.hero}>
          <FeaturePhone dial={dial} />
          <View style={{ flex: 1, gap: 8 }}>
            <Txt weight="semi" size={26} style={{ letterSpacing: -0.6, lineHeight: 30 }}>
              Pay from any phone. Even with no data.
            </Txt>
            <Txt size={15} color={colors.onTint} style={{ lineHeight: 21 }}>
              Dial {dial}, enter your PIN, and pay a Kova till or send to a number.
            </Txt>
          </View>
        </View>
      </Rise>
      <Sticker
        radius={24}
        fill={colors.surface}
        haptic={false}
        style={{ marginTop: 18 }}
        innerStyle={{ padding: 18, gap: 8 }}
      >
        <Txt weight="semi" size={16}>
          How it works
        </Txt>
        <Txt size={14} color={colors.muted} style={{ lineHeight: 20 }}>
          USSD can’t use your passkey, so you set aside a small pocket that Kova holds for you, up
          to your limit. Your main wallet stays yours alone. Take the pocket back whenever you like.
        </Txt>
      </Sticker>
      <View style={{ gap: 14, marginTop: 20 }}>
        <Field
          label="Your phone number"
          value={phone}
          onChangeText={setPhone}
          placeholder="+254 711 000 111"
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
        />
        <Field
          label="A PIN for USSD (4 to 6 digits)"
          value={pin}
          onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 6))}
          placeholder="••••"
          keyboardType="number-pad"
          secureTextEntry
        />
        {pinIssue ? (
          <Txt size={13} color={colors.danger}>
            {pinIssue}
          </Txt>
        ) : null}
        <Field
          label="The PIN again"
          value={again}
          onChangeText={(v) => setAgain(v.replace(/\D/g, '').slice(0, 6))}
          placeholder="••••"
          keyboardType="number-pad"
          secureTextEntry
        />
        {mismatch ? (
          <Txt size={13} color={colors.danger}>
            The PINs don’t match.
          </Txt>
        ) : null}
        <View style={{ gap: 8 }}>
          <Txt weight="semi" size={14}>
            The most it holds and spends in a day
          </Txt>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {CAPS.map((c) => (
              <Pressable
                key={c}
                accessibilityRole="button"
                accessibilityState={{ selected: cap === c }}
                onPress={() => setCap(c)}
                style={[styles.choice, cap === c && styles.choiceOn]}
              >
                <Txt weight="semi" size={16} color={cap === c ? colors.white : colors.ink}>
                  ${c}
                </Txt>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
      <Problem text={error} />
      <View style={{ marginTop: 22 }}>
        <PillButton
          label="Text me a code"
          icon="send"
          disabled={!ready}
          loading={busy === 'setup'}
          onPress={() => normalized && onSubmit({ phone: normalized, pin, cap })}
        />
      </View>
    </>
  )
}

function Confirm({
  phone,
  busy,
  error,
  onSubmit,
  onRestart,
}: {
  phone: string
  busy: string | null
  error: string | null
  onSubmit: (code: string) => void
  onRestart: () => void
}) {
  const [code, setCode] = useState('')
  return (
    <Rise>
      <Txt weight="semi" size={28} style={{ letterSpacing: -0.6, marginTop: 12 }}>
        Enter the code we texted
      </Txt>
      <Txt size={15} color={colors.muted} style={{ marginTop: 6 }}>
        Sent to {phone}. It works for 10 minutes.
      </Txt>
      <TextInput
        value={code}
        onChangeText={(v) => {
          const digits = v.replace(/\D/g, '').slice(0, 6)
          setCode(digits)
          if (digits.length === 6) onSubmit(digits)
        }}
        placeholder="000000"
        placeholderTextColor="#B4B9B8"
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        autoFocus
        style={styles.code}
        accessibilityLabel="Six-digit code"
      />
      <Problem text={error} />
      <View style={{ marginTop: 22, gap: 14, alignItems: 'center' }}>
        <PillButton
          label="Confirm"
          icon="check"
          disabled={code.length !== 6}
          loading={busy === 'code'}
          onPress={() => onSubmit(code)}
        />
        <TextLink label="Use a different number" onPress={onRestart} />
      </View>
    </Rise>
  )
}

function Live({
  pocket,
  busy,
  error,
  wallet,
  onTopUp,
  onTakeBack,
  onCap,
  onPin,
  onOff,
}: {
  pocket: Extract<Pocket, { status: 'active' | 'pending' }>
  busy: string | null
  error: string | null
  wallet: bigint | null
  onTopUp: (amount: string) => void
  onTakeBack: () => void
  onCap: (cap: string) => void
  onPin: (pin: string) => void
  onOff: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [pin, setPin] = useState<string | null>(null)
  const [confirmOff, setConfirmOff] = useState(false)
  const room = Number(pocket.cap) - Number(pocket.balance ?? 0)
  const inWallet = wallet === null ? 0 : Number(wallet) / 1e6
  const pinIssue = pin ? pinProblem(pin) : null
  return (
    <>
      <Rise>
        <View style={styles.pocket}>
          <View
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <Txt weight="semi" size={14} color={colors.onTint}>
              USSD pocket · {pocket.phone}
            </Txt>
            {pocket.locked_until ? (
              <Chip label="Paused" dot={colors.danger} />
            ) : (
              <Chip label="On" dot={colors.positive} />
            )}
          </View>
          <Txt weight="semi" size={52} style={{ letterSpacing: -2, marginTop: 6 }}>
            {usd(pocket.balance)}
          </Txt>
          <Txt size={14} color={colors.onTint}>
            {usd(pocket.left_today)} left to spend today, of {usd(pocket.cap)}
          </Txt>
        </View>
      </Rise>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Copy the code to dial, ${pocket.dial}`}
        onPress={async () => {
          await Clipboard.setStringAsync(pocket.dial)
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        }}
        style={styles.dial}
      >
        <Icon name="keypad" size={20} />
        <View style={{ flex: 1 }}>
          <Txt weight="semi" size={16}>
            Dial {pocket.dial}
          </Txt>
          <Txt size={13} color={colors.muted}>
            from {pocket.phone}, then enter your PIN
          </Txt>
        </View>
        <Txt weight="semi" size={14}>
          {copied ? 'Copied' : 'Copy'}
        </Txt>
      </Pressable>

      <Txt weight="semi" size={16} style={{ marginTop: 22 }}>
        Add to the pocket
      </Txt>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
        {TOP_UPS.map((a) => {
          const off = Number(a) > room || Number(a) > inWallet || busy !== null
          return (
            <Pressable
              key={a}
              accessibilityRole="button"
              accessibilityState={{ disabled: off }}
              disabled={off}
              onPress={() => onTopUp(a)}
              style={[styles.choice, off && { opacity: 0.35 }]}
            >
              <Txt weight="semi" size={16}>
                ${a}
              </Txt>
            </Pressable>
          )
        })}
      </View>
      {busy === 'topup' ? (
        <Txt size={13} color={colors.muted} style={{ marginTop: 8 }}>
          Adding…
        </Txt>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
        <Sticker
          radius={20}
          onPress={onTakeBack}
          disabled={busy !== null || Number(pocket.balance ?? 0) <= 0}
          style={{ flex: 1, height: 50 }}
          innerStyle={styles.action}
        >
          <Txt weight="semi" size={15}>
            {busy === 'back' ? 'Moving…' : 'Back to wallet'}
          </Txt>
        </Sticker>
        <Sticker
          radius={20}
          onPress={() => setPin(pin === null ? '' : null)}
          disabled={busy !== null}
          style={{ flex: 1, height: 50 }}
          innerStyle={styles.action}
        >
          <Txt weight="semi" size={15}>
            New PIN
          </Txt>
        </Sticker>
      </View>
      {pin !== null ? (
        <View style={{ marginTop: 12, gap: 8 }}>
          <Field
            label="New PIN"
            value={pin}
            onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 6))}
            placeholder="••••"
            keyboardType="number-pad"
            secureTextEntry
            autoFocus
          />
          {pinIssue ? (
            <Txt size={13} color={colors.danger}>
              {pinIssue}
            </Txt>
          ) : null}
          <PillButton
            label="Save PIN"
            icon="lock"
            disabled={!pin || Boolean(pinIssue)}
            loading={busy === 'pin'}
            onPress={() => {
              onPin(pin)
              setPin(null)
            }}
          />
        </View>
      ) : null}

      <Txt weight="semi" size={16} style={{ marginTop: 22 }}>
        Daily limit
      </Txt>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
        {CAPS.map((c) => {
          const on = Number(pocket.cap) === Number(c)
          return (
            <Pressable
              key={c}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              disabled={on || busy !== null}
              onPress={() => onCap(c)}
              style={[styles.choice, on && styles.choiceOn]}
            >
              <Txt weight="semi" size={16} color={on ? colors.white : colors.ink}>
                ${c}
              </Txt>
            </Pressable>
          )
        })}
      </View>

      <Problem text={error} />

      <Txt weight="semi" size={16} style={{ marginTop: 24 }}>
        Paid by USSD
      </Txt>
      {pocket.spends.length === 0 ? (
        <Txt size={14} color={colors.muted} style={{ marginTop: 8 }}>
          Nothing yet. Dial {pocket.dial} to try it.
        </Txt>
      ) : (
        pocket.spends.map((s) => (
          <View key={s.reference} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Txt weight="semi" size={15}>
                {s.kind === 'withdraw'
                  ? 'Back to your wallet'
                  : s.kind === 'phone'
                    ? `To ${s.to}`
                    : s.to}
              </Txt>
              <Txt size={13} color={colors.muted}>
                {s.reference} ·{' '}
                {new Date(s.created_at).toLocaleString([], {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
                {s.status === 'failed'
                  ? ' · didn’t go through'
                  : s.status === 'pending'
                    ? ' · paying'
                    : ''}
              </Txt>
            </View>
            <Txt weight="semi" size={15} color={s.status === 'failed' ? colors.muted : colors.ink}>
              −${Number(s.amount).toFixed(2)}
            </Txt>
          </View>
        ))
      )}

      <View style={{ marginTop: 28, alignItems: 'center' }}>
        {confirmOff ? (
          <View style={{ alignItems: 'center', gap: 10 }}>
            <Txt size={14} color={colors.muted} style={{ textAlign: 'center' }}>
              The pocket’s dollars go back to your wallet, and dialling stops working.
            </Txt>
            <View style={{ flexDirection: 'row', gap: 16 }}>
              <TextLink label="Keep it" onPress={() => setConfirmOff(false)} />
              <TextLink
                label={busy === 'off' ? 'Turning off…' : 'Turn off USSD'}
                color={colors.danger}
                onPress={onOff}
              />
            </View>
          </View>
        ) : (
          <TextLink
            label="Turn off USSD"
            color={colors.danger}
            onPress={() => setConfirmOff(true)}
          />
        )}
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingBottom: 48 },
  loading: { paddingTop: 80, alignItems: 'center' },
  hero: { flexDirection: 'row', gap: 18, alignItems: 'center', marginTop: 8 },
  phone: {
    width: 112,
    borderRadius: 26,
    backgroundColor: colors.ink,
    padding: 9,
    paddingBottom: 12,
    alignItems: 'center',
    transform: [{ rotate: '-4deg' }],
  },
  speaker: { width: 30, height: 4, borderRadius: 2, backgroundColor: '#33464A', marginBottom: 7 },
  phoneScreen: {
    alignSelf: 'stretch',
    backgroundColor: colors.tealSoft,
    borderRadius: 10,
    padding: 7,
    gap: 1,
  },
  keys: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    width: 84,
    marginTop: 9,
    justifyContent: 'center',
  },
  key: { width: 23, height: 11, borderRadius: 4, backgroundColor: colors.surface },
  input: {
    height: 48,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 17,
    color: colors.ink,
  },
  choice: {
    flex: 1,
    height: 48,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceOn: { backgroundColor: colors.ink },
  code: {
    marginTop: 24,
    height: 64,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    textAlign: 'center',
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 34,
    letterSpacing: 10,
    color: colors.ink,
  },
  pocket: {
    marginTop: 8,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.tealSoft,
    padding: 20,
  },
  dial: {
    marginTop: 14,
    minHeight: 56,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  action: { alignItems: 'center', justifyContent: 'center', flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.sunken,
  },
})
