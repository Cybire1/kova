import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import * as WebBrowser from 'expo-web-browser'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { getUsAccount, openUsAccount, type UsAccount, viewUsAccount } from '@/lib/partners'
import { colors, fonts } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Icon } from '@/ui/Icon'
import { NotYet, problemOf, SandboxNote, useMoney } from '@/ui/Money'
import { Header, PillButton, Screen, TextLink, Txt } from '@/ui/primitives'
import { Stage } from '@/ui/Stage'

/**
 * Get paid from abroad: your own US account number (a Bridge virtual account). Clients pay it by
 * ACH or wire like any US bank account, and it lands here as dollars on Monad.
 */
export default function UsAccountScreen() {
  const { profile, signMessage } = useWallet()
  const { data, setData, problem, reload } = useMoney<UsAccount>(getUsAccount)
  const [name, setName] = useState(profile?.name ?? '')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const act = async (label: string, run: () => Promise<UsAccount>) => {
    setBusy(label)
    setError(null)
    try {
      setData(await run())
    } catch (e) {
      setError(problemOf(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Screen bg={colors.paper}>
      <Header title="Get paid from abroad" />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {!data ? (
          <Txt size={15} color={colors.muted} style={{ marginTop: 40, textAlign: 'center' }}>
            {problem ?? 'Opening…'}
          </Txt>
        ) : !data.live ? (
          <NotYet
            pose="catch"
            title="Your own US account number"
            lead="Clients and platforms abroad pay it like any US bank account, and it lands here as dollars you can keep, spend or send."
            facts={[
              ['They pay by', 'ACH or wire, from any US bank'],
              ['It lands as', 'Dollars in this wallet'],
              ['In your name', 'After a quick identity check'],
              ['Partner', 'Bridge, a Stripe company'],
            ]}
            feature="us_account"
            requested={data.requested}
            onRequested={() => setData({ ...data, requested: true })}
          />
        ) : data.status === 'none' ? (
          <View>
            <View style={styles.art}>
              <Stage pose="catch" size={130} />
            </View>
            <Txt weight="semi" size={30} style={styles.title}>
              Your own US account number
            </Txt>
            <Txt size={16} color={colors.onTint} style={styles.lead}>
              Bridge checks who you are first, as every bank does. It takes a few minutes.
            </Txt>
            {data.sandbox ? (
              <SandboxNote text="Bridge sandbox: a test account, no money moves" />
            ) : null}
            <Txt weight="semi" size={13} color={colors.muted} style={styles.label}>
              Your full name
            </Txt>
            <TextInput
              value={name}
              onChangeText={setName}
              style={styles.input}
              autoComplete="name"
              textContentType="name"
            />
            <Txt weight="semi" size={13} color={colors.muted} style={styles.label}>
              Email
            </Txt>
            <TextInput
              value={email}
              onChangeText={setEmail}
              style={styles.input}
              autoComplete="email"
              keyboardType="email-address"
              autoCapitalize="none"
              textContentType="emailAddress"
            />
            {error ? (
              <Txt weight="medium" size={14} color={colors.danger} style={{ marginTop: 10 }}>
                {error}
              </Txt>
            ) : null}
            <View style={{ marginTop: 20 }}>
              <PillButton
                label={busy ? 'Starting…' : 'Continue to verification'}
                loading={busy !== null}
                disabled={!profile || name.trim().length < 2 || !email.includes('@')}
                onPress={() =>
                  profile &&
                  act('open', () =>
                    openUsAccount(profile.address, signMessage, {
                      full_name: name.trim(),
                      email: email.trim(),
                    }),
                  )
                }
              />
            </View>
          </View>
        ) : data.status === 'kyc' ? (
          <View>
            <View style={styles.art}>
              <Stage pose="key" size={130} />
            </View>
            <Txt weight="semi" size={30} style={styles.title}>
              Finish with Bridge
            </Txt>
            <Txt size={16} color={colors.onTint} style={styles.lead}>
              Bridge is checking it’s you
              {data.kyc_status ? ` (${data.kyc_status.replaceAll('_', ' ')})` : ''}. Your account
              number appears here the moment it’s approved.
            </Txt>
            {data.kyc_link ? (
              <View style={{ marginTop: 22 }}>
                <PillButton
                  label="Verify with Bridge"
                  icon="web"
                  onPress={async () => {
                    await WebBrowser.openBrowserAsync(data.kyc_link as string)
                    void reload()
                  }}
                />
              </View>
            ) : null}
            <View style={{ alignItems: 'center', marginTop: 14 }}>
              <TextLink label="I’ve finished: check again" onPress={() => void reload()} />
            </View>
          </View>
        ) : (
          <View>
            <Txt weight="bold" size={12} color={colors.tealDeep} style={styles.eyebrow}>
              YOUR US ACCOUNT
            </Txt>
            <Txt weight="semi" size={30} style={styles.title}>
              Paid in dollars, from anywhere
            </Txt>
            {data.sandbox ? (
              <SandboxNote text="Bridge sandbox: a test account, no money moves" />
            ) : null}
            {data.details ? (
              <View style={styles.bank}>
                {(
                  [
                    ['Bank', data.details.bank_name],
                    ['Account number', data.details.account_number],
                    ['Routing number', data.details.routing_number],
                    ['Name on the account', data.details.beneficiary_name],
                  ] as const
                ).map(([k, v], i) =>
                  v ? <BankRow key={k} label={k} value={v} first={i === 0} /> : null,
                )}
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                style={[styles.bank, { padding: 18 }]}
                disabled={busy !== null}
                onPress={() =>
                  profile && act('view', () => viewUsAccount(profile.address, signMessage))
                }
              >
                <Txt size={13} color={colors.muted}>
                  Account ending {data.last_four ?? '····'}
                </Txt>
                <Txt weight="semi" size={17} style={{ marginTop: 2 }}>
                  {busy ? 'Opening…' : 'Show the details'}
                </Txt>
              </Pressable>
            )}
            {error ? (
              <Txt weight="medium" size={14} color={colors.danger} style={{ marginTop: 10 }}>
                {error}
              </Txt>
            ) : null}
            <Txt
              size={13}
              color={colors.muted}
              style={{ marginTop: 14, lineHeight: 19, textAlign: 'center' }}
            >
              ACH takes 1 to 3 business days and wires arrive the same day. Either way it lands here
              as dollars.
            </Txt>
          </View>
        )}
      </ScrollView>
    </Screen>
  )
}

function BankRow({ label, value, first }: { label: string; value: string; first: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <View style={[styles.bankRow, !first && styles.rule]}>
      <View style={{ flex: 1 }}>
        <Txt size={12} color={colors.muted}>
          {label}
        </Txt>
        <Txt weight="semi" size={17} selectable>
          {value}
        </Txt>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Copy ${label.toLowerCase()}`}
        onPress={async () => {
          await Clipboard.setStringAsync(value)
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
        style={styles.copy}
      >
        <Icon name={copied ? 'check' : 'copy'} size={14} />
        <Txt weight="semi" size={12}>
          {copied ? 'Copied' : 'Copy'}
        </Txt>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  body: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 32 },
  art: { alignItems: 'center', height: 140 },
  title: { letterSpacing: -0.8, textAlign: 'center' },
  lead: { lineHeight: 23, marginTop: 8, textAlign: 'center' },
  eyebrow: { letterSpacing: 1.4, textAlign: 'center', marginTop: 8, marginBottom: 6 },
  label: { marginTop: 18, marginBottom: 6, marginLeft: 4 },
  input: {
    height: 54,
    paddingHorizontal: 16,
    borderWidth: 2,
    borderColor: colors.ink,
    borderRadius: 18,
    backgroundColor: colors.surface,
    fontFamily: fonts.semi,
    fontSize: 17,
    color: colors.ink,
  },
  bank: {
    marginTop: 18,
    paddingHorizontal: 16,
    borderWidth: 2,
    borderColor: colors.ink,
    borderRadius: 22,
    backgroundColor: colors.surface,
  },
  bankRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  rule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(11,26,29,0.18)' },
  copy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 2,
    borderColor: colors.ink,
    borderRadius: 999,
    backgroundColor: colors.paper,
  },
})
