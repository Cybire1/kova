import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import QRCode from 'react-native-qrcode-svg'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as WebBrowser from 'expo-web-browser'
import { isTestnet, network, webUrl } from '@/lib/config'
import { personLink } from '@/lib/links'
import { currencyInfo, type DisplayCurrency, formatUsd } from '@/lib/money'
import { usePrivate } from '@/lib/private'
import { rateLabel, ratesLive } from '@/lib/rates'
import { endSession, SESSION_IDLE_MS, SESSION_LIMIT, TAP_LIMIT, useSessionState } from '@/lib/session'
import { useStall } from '@/lib/stall'
import { colors } from '@/lib/theme'
import { vaultSavedAt } from '@/lib/vault'
import { useWallet } from '@/lib/wallet'
import { Avatar } from '@/ui/art'
import { dockClearance } from '@/ui/Dock'
import { Icon } from '@/ui/Icon'
import { Ping } from '@/ui/motion'
import { CurrencySheet } from '@/ui/ProfileForm'
import { Sticker, Txt } from '@/ui/primitives'

/**
 * You, as a Kova pass: an identity card with your face, your address and your code, torn
 * along a perforation like a boarding pass. Below it, what you've done with Kova, then three
 * cards that each show something true rather than a setting: your money at today's rate and how
 * your keys protect you right now. Your shop is on Home, under Pay.
 */
export default function Profile() {
  const { profile, activity, contacts, setCurrency, signOut } = useWallet()
  const stall = useStall()
  const insets = useSafeAreaInsets()
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [copied, setCopied] = useState(false)
  // Development only: kova://profile?scroll=end opens at the bottom, for checking the cards there.
  const { scroll } = useLocalSearchParams<{ scroll?: string }>()
  const scroller = useRef<ScrollView>(null)
  useEffect(() => {
    if (__DEV__ && scroll === 'end') setTimeout(() => scroller.current?.scrollToEnd({ animated: false }), 400)
  }, [scroll])

  const stats = useMemo(() => {
    const out = activity.filter((e) => e.kind === 'paid' || e.kind === 'sent')
    const moved = activity.reduce((sum, e) => sum + BigInt(e.amount), 0n)
    return { payments: out.length, people: contacts.length, moved }
  }, [activity, contacts])

  if (!profile) return null
  const since = new Date(profile.createdAt ?? activity.at(-1)?.at ?? Date.now())
  const link = personLink({ address: profile.address, name: profile.name, currency: profile.currency })

  const copy = async () => {
    await Clipboard.setStringAsync(profile.address)
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <ScrollView
      ref={scroller}
      style={{ flex: 1, backgroundColor: colors.paper }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: dockClearance + insets.bottom }}
    >
      <Txt weight="bold" size={32} style={{ letterSpacing: -1 }}>
        Profile
      </Txt>

      {/* The pass */}
      <View style={styles.pass}>
        <View style={styles.passTop}>
          <View style={styles.ring}>
            <Avatar name={profile.name} id={profile.address} size={54} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt weight="bold" size={22} color={colors.white} numberOfLines={1} style={{ letterSpacing: -0.4 }}>
              {profile.name}
            </Txt>
            <Txt size={13} color={colors.onInk}>
              Member since {since.toLocaleDateString([], { month: 'short', year: 'numeric' })}
            </Txt>
          </View>
        </View>

        <View style={styles.tear} pointerEvents="none">
          <View style={[styles.notch, { left: -13 }]} />
          <View style={styles.perforation} />
          <View style={[styles.notch, { right: -13 }]} />
        </View>

        <View style={styles.passBottom}>
          <View style={{ flex: 1, gap: 10 }}>
            <View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Txt size={12} color={colors.onInk}>
                  Your address on Monad
                </Txt>
                <View style={styles.network}>
                  <View style={[styles.dot, { backgroundColor: network.id === 'testnet' ? colors.yellow : colors.tealLight }]} />
                  <Txt weight="semi" size={10} color={colors.white}>
                    {network.id === 'testnet' ? 'Testnet' : 'Mainnet'}
                  </Txt>
                </View>
              </View>
              <Txt weight="semi" size={16} color={colors.white} style={{ letterSpacing: 0.4 }}>
                {profile.address.slice(0, 8)}…{profile.address.slice(-6)}
              </Txt>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Copy your address" onPress={copy} style={styles.copy}>
              <Icon name={copied ? 'check' : 'copy'} size={15} color={colors.ink} />
              <Txt weight="semi" size={13}>
                {copied ? 'Copied' : 'Copy'}
              </Txt>
            </Pressable>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Show my Kova code" onPress={() => router.push('/receive')} style={styles.qr}>
            <QRCode value={link} size={68} color={colors.ink} backgroundColor={colors.surface} ecl="L" />
          </Pressable>
        </View>
      </View>

      {/* What you've done */}
      <View style={styles.stats}>
        <Stat value={String(stats.payments)} label="Payments" />
        <Stat value={String(stats.people)} label="People" />
        <Stat value={formatUsd(stats.moved).replace(/\.\d+$/, '')} label="Moved" />
      </View>

      {/* Ramp's off-ramp runs on the web, where the same passkey opens this wallet. Mainnet only:
          on testnet there's nothing real to cash out. */}
      {isTestnet ? null : (
      <Sticker
        radius={24}
        accessibilityLabel="Cash out to your bank or card"
        onPress={() => void WebBrowser.openBrowserAsync(`${webUrl}/wallet/cash-out`)}
        style={{ height: 62, marginTop: 14 }}
      >
        <View style={styles.cashOut}>
          <View style={{ flex: 1 }}>
            <Txt weight="semi" size={16}>
              Cash out
            </Txt>
            <Txt size={13} color={colors.muted}>
              To your bank or card, with Ramp Network
            </Txt>
          </View>
          <Icon name="arrow" size={20} />
        </View>
      </Sticker>
      )}

      {/* Dollars people sent privately, waiting at one-time addresses only this wallet can open. */}
      <PrivateRow />

      {/* Paying from a phone with no data: a small pocket spent by dialling Kova's USSD code. */}
      <Sticker radius={24} accessibilityLabel="Pay by USSD, from any phone" onPress={() => router.push('/ussd')} style={{ height: 62, marginTop: 14 }}>
        <View style={[styles.cashOut, { gap: 14 }]}>
          <Icon name="keypad" size={22} />
          <View style={{ flex: 1 }}>
            <Txt weight="semi" size={16}>
              Pay by USSD
            </Txt>
            <Txt size={13} color={colors.muted}>
              From any phone, even with no data
            </Txt>
          </View>
          <Icon name="arrow" size={20} />
        </View>
      </Sticker>

      <MoneyCard
        currency={profile.currency}
        onChange={(next) => {
          void Haptics.selectionAsync()
          void setCurrency(next)
        }}
      />
      {profile.demo ? (
        <View style={styles.keys}>
          <View style={styles.keysTop}>
            <View style={styles.keyIcon}>
              <Icon name="info" size={19} color={colors.white} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt weight="bold" size={17}>
                You’re in the demo account
              </Txt>
              <Txt size={14} color={colors.muted} style={{ marginTop: 2, lineHeight: 20 }}>
                A shared test wallet with test dollars, on Monad testnet. A real Kova wallet is a passkey: remove this one
                and choose “Create my wallet”.
              </Txt>
            </View>
          </View>
        </View>
      ) : (
        <KeysCard />
      )}

      <View style={{ marginTop: 26, alignItems: 'center' }}>
        {confirmRemove ? (
          <View style={styles.confirm}>
            <Txt weight="semi" size={16}>
              Remove this wallet from the phone?
            </Txt>
            <Txt size={14} color={colors.muted} style={{ marginTop: 4, lineHeight: 20 }}>
              {profile.demo
                ? 'It’s the shared demo account: sign in again with its username and password whenever you like.'
                : stall.owned
                ? `Your money stays in the wallet, and ${stall.owned.name} keeps paying into it. Your passkey brings it back here any time: choose “I already have Kova”.`
                : 'Your money stays in the wallet. Your passkey brings it back here, or on any phone, any time: choose “I already have Kova”.'}
            </Txt>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <Pressable accessibilityRole="button" onPress={() => setConfirmRemove(false)} style={[styles.small, { backgroundColor: colors.surface }]}>
                <Txt weight="semi" size={15}>
                  Keep it
                </Txt>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={async () => {
                  await signOut()
                  router.replace('/welcome')
                }}
                style={[styles.small, { backgroundColor: colors.danger, borderColor: colors.danger }]}
              >
                <Txt weight="semi" size={15} color={colors.white}>
                  Remove wallet
                </Txt>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable accessibilityRole="button" onPress={() => setConfirmRemove(true)} hitSlop={10}>
            <Txt weight="semi" size={15} color={colors.danger}>
              Remove wallet from this phone
            </Txt>
          </Pressable>
        )}
      </View>
    </ScrollView>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Txt weight="bold" size={20} numberOfLines={1} adjustsFontSizeToFit style={{ letterSpacing: -0.5 }}>
        {value}
      </Txt>
      <Txt size={12} color={colors.muted}>
        {label}
      </Txt>
    </View>
  )
}

/** Secondary text on teal. */
const onTeal = '#DCEBEA'

/** Your currency, at today's rate, with where that rate comes from. */
function MoneyCard({ currency, onChange }: { currency: DisplayCurrency; onChange: (currency: DisplayCurrency) => void }) {
  const [picking, setPicking] = useState(false)
  const info = currencyInfo[currency]
  const rate = info.perUsd.toLocaleString('en-US', { maximumFractionDigits: info.decimals === 0 ? 2 : 4 })
  return (
    <View style={styles.money}>
      <View style={styles.moneyTop}>
        <View style={{ flex: 1 }}>
          <Txt size={13} color={onTeal}>
            Your money shows in
          </Txt>
          <Txt weight="bold" size={26} color={colors.white} style={{ letterSpacing: -0.6 }}>
            {info.symbol} {info.name}
          </Txt>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Change currency" onPress={() => setPicking(true)} style={({ pressed }) => [styles.change, pressed && { opacity: 0.8 }]}>
          <Txt weight="semi" size={14}>
            Change
          </Txt>
          <Icon name="chevronDown" size={14} />
        </Pressable>
      </View>
      <View style={styles.moneyRule} />
      {currency === 'USD' ? (
        <Txt size={14} color={onTeal}>
          Dollars, just as they are.
        </Txt>
      ) : (
        <View style={styles.rateLine}>
          <Txt weight="bold" size={19} color={colors.white}>
            $1 = {info.symbol}
            {rate}
          </Txt>
          <View style={styles.provenance}>
            <Icon name={ratesLive() ? 'check' : 'info'} size={13} color={onTeal} />
            <Txt size={12} color={onTeal}>
              {ratesLive() ? rateLabel() : 'Reference rate'}
            </Txt>
          </View>
        </View>
      )}
      <CurrencySheet
        visible={picking}
        value={currency}
        onClose={() => setPicking(false)}
        onPick={(next) => {
          onChange(next)
          setPicking(false)
        }}
      />
    </View>
  )
}

const dollars = (base: bigint) => formatUsd(base).replace(/\.00$/, '')

/**
 * How your keys protect you, live: the wallet is a passkey, and after one Face ID a short
 * session can approve small payments without asking again. This shows whether one is open, for
 * how long, how much it can still approve, the rules it keeps, and whether the vault is backed up.
 */
function KeysCard() {
  const session = useSessionState()
  const [backedUp, setBackedUp] = useState<number | null>(null)
  useEffect(() => {
    void vaultSavedAt().then(setBackedUp)
  }, [])
  const minutes = Math.floor(session.msLeft / 60_000)
  const seconds = String(Math.floor((session.msLeft % 60_000) / 1000)).padStart(2, '0')
  return (
    <View style={styles.keys}>
      <View style={styles.keysTop}>
        <View style={styles.keyIcon}>
          <Icon name="lock" size={19} color={colors.white} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt weight="bold" size={17}>
            Your wallet is a passkey
          </Txt>
          <Txt size={13} color={colors.muted} style={{ lineHeight: 18 }}>
            iCloud Keychain keeps it, and it opens this wallet on any phone you sign in on.
          </Txt>
        </View>
      </View>

      <View style={[styles.session, session.open && styles.sessionOpen]} accessibilityLiveRegion="polite">
        <View style={styles.liveDotWrap}>
          {session.open ? <Ping size={12} color={colors.teal} /> : null}
          <View style={[styles.liveDot, { backgroundColor: session.open ? colors.teal : colors.muted }]} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt weight="semi" size={15}>
            {session.open ? `Open for ${minutes}:${seconds}` : 'Locked'}
          </Txt>
          <Txt size={13} color={colors.muted}>
            {session.open ? `Pays up to ${dollars(session.canApprove)} without Face ID` : 'Face ID opens it when you pay'}
          </Txt>
        </View>
        {session.open ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Lock now"
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
              endSession()
            }}
            style={({ pressed }) => [styles.lock, pressed && { opacity: 0.7 }]}
          >
            <Icon name="lock" size={14} />
            <Txt weight="semi" size={13}>
              Lock
            </Txt>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.rules}>
        {[`${dollars(TAP_LIMIT)} a tap`, `${dollars(SESSION_LIMIT)} a session`, `${SESSION_IDLE_MS / 60_000} quiet minutes`].map((rule) => (
          <View key={rule} style={styles.rule}>
            <Txt weight="semi" size={12}>
              {rule}
            </Txt>
          </View>
        ))}
      </View>

      <View style={styles.backup}>
        <Icon name={backedUp ? 'check' : 'info'} size={15} color={backedUp ? colors.positive : colors.muted} />
        <Txt size={13} color={colors.muted} style={{ flex: 1, lineHeight: 18 }}>
          {backedUp
            ? 'Your name and contacts are backed up, sealed by your passkey. Kova can’t read them.'
            : 'Your name and contacts back up, sealed by your passkey, the next time you change them.'}
        </Txt>
      </View>
    </View>
  )
}

/** Private dollars, one tap away: what's waiting, or whether people can send to you privately. */
function PrivateRow() {
  const p = usePrivate()
  const line =
    p.waiting > 0n
      ? `${formatUsd(p.waiting)} waiting to move in`
      : p.keysHere && p.published
        ? 'Anyone can send to you privately'
        : p.keysHere
          ? 'Almost ready to receive privately'
          : 'Let people send to you privately'
  return (
    <Sticker radius={24} accessibilityLabel={`Private dollars. ${line}`} onPress={() => router.push('/private')} style={{ height: 62, marginTop: 14 }}>
      <View style={[styles.cashOut, { gap: 14 }]}>
        <Icon name="lock" size={22} />
        <View style={{ flex: 1 }}>
          <Txt weight="semi" size={16}>
            Private dollars
          </Txt>
          <Txt size={13} color={p.waiting > 0n ? colors.coralDeep : colors.muted} numberOfLines={1}>
            {line}
          </Txt>
        </View>
        <Icon name="arrow" size={20} />
      </View>
    </Sticker>
  )
}

const styles = StyleSheet.create({
  cashOut: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18 },
  pass: { marginTop: 16, borderRadius: 28, backgroundColor: colors.ink },
  passTop: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18, paddingBottom: 16 },
  ring: { borderRadius: 31, borderWidth: 3, borderColor: colors.yellow, padding: 2 },
  network: {
    height: 20,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.1)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  tear: { height: 26, justifyContent: 'center' },
  notch: { position: 'absolute', width: 26, height: 26, borderRadius: 13, backgroundColor: colors.paper },
  perforation: { marginHorizontal: 22, borderTopWidth: 2, borderColor: 'rgba(255,255,255,0.22)', borderStyle: 'dashed' },
  passBottom: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18, paddingTop: 12 },
  copy: {
    alignSelf: 'flex-start',
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  qr: { padding: 8, borderRadius: 14, backgroundColor: colors.surface },
  stats: { flexDirection: 'row', gap: 10, marginTop: 12 },
  stat: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  money: {
    marginTop: 14,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.teal,
    padding: 16,
  },
  moneyTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  change: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
  },
  moneyRule: { height: 2, borderRadius: 1, backgroundColor: colors.tealDeep, marginVertical: 12 },
  rateLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
  provenance: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  keys: { marginTop: 12, borderRadius: 24, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.surface, padding: 16 },
  keysTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  keyIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  session: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 14,
    padding: 12,
    borderRadius: 18,
    backgroundColor: colors.sunken,
  },
  sessionOpen: { backgroundColor: '#DCEBEA' },
  liveDotWrap: { width: 12, height: 12, alignItems: 'center', justifyContent: 'center' },
  liveDot: { width: 12, height: 12, borderRadius: 6 },
  lock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
  },
  rules: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  rule: { height: 28, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1.5, borderColor: colors.ink, justifyContent: 'center' },
  backup: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 12 },
  confirm: { alignSelf: 'stretch', borderRadius: 22, borderWidth: 2, borderColor: colors.ink, padding: 16, backgroundColor: colors.surface },
  small: { flex: 1, height: 40, borderRadius: 20, borderWidth: 2, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
})
