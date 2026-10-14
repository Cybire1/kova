import * as Haptics from 'expo-haptics'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import type { Address } from 'viem'
import { accept, inviteInfo, type KeyInvite } from '@/lib/spend-keys'
import { colors } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Kovi } from '@/ui/art'
import { Icon, type IconName } from '@/ui/Icon'
import { short } from '@/ui/Keys'
import { Header, PillButton, Rise, Screen, Txt } from '@/ui/primitives'

/**
 * An allowance or a budget someone gave you (mykova.app/a/<code>): your wallet makes the key on
 * this phone, from its own signature, so nothing is stored and nobody else can spend with it. It
 * spends nothing until the giver switches it on with their passkey.
 */
export default function AcceptKey() {
  const { code } = useLocalSearchParams<{ code: string }>()
  const { profile, signMessage } = useWallet()
  const [invite, setInvite] = useState<KeyInvite | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [accepted, setAccepted] = useState(false)
  useEffect(() => {
    if (!code) return
    inviteInfo(code)
      .then(setInvite)
      .catch((e: unknown) => setProblem(e instanceof Error ? e.message : 'This invite isn’t open.'))
  }, [code])
  if (!profile) return null
  const from = invite ? (invite.owner_name ?? short(invite.owner)) : ''
  const what = invite ? `$${invite.limit.replace(/\.00$/, '')} a ${invite.period}` : ''
  const done = accepted || invite?.status === 'accepted' || invite?.status === 'active'

  const facts: { icon: IconName; text: string }[] = invite
    ? [
        { icon: 'lock', text: 'Your phone makes its own key. Nobody else can spend with it.' },
        { icon: 'snow', text: `${from} can freeze it any time, in one tap.` },
        {
          icon: 'clock',
          text: `Until ${new Date(invite.ends_at).toLocaleDateString([], { day: 'numeric', month: 'short' })}`,
        },
      ]
    : []

  return (
    <Screen bg={colors.tealSoft}>
      <Header
        backIcon="close"
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      />
      <ScrollView contentContainerStyle={styles.body}>
        {problem && !invite ? (
          <Txt size={16} weight="semi" color={colors.danger}>
            {problem}
          </Txt>
        ) : invite ? (
          <>
            <View style={styles.art}>
              <Kovi pose="key" size={170} />
            </View>
            <Rise>
              <Txt weight="semi" size={32} style={styles.title}>
                {from} gives you {what}
              </Txt>
              <Txt size={17} color={colors.onTint} style={styles.lead}>
                {invite.kind === 'team'
                  ? `Spend it for ${from}’s shop, up to ${what}, straight from their wallet.`
                  : `Spend it wherever Kova works, up to ${what}. The dollars stay in ${from}’s wallet until you spend them.`}
              </Txt>
            </Rise>
            <View style={styles.facts}>
              {facts.map((f) => (
                <View key={f.text} style={styles.fact}>
                  <Icon name={f.icon} size={16} />
                  <Txt size={15} style={{ flex: 1 }}>
                    {f.text}
                  </Txt>
                </View>
              ))}
            </View>
            {problem ? (
              <Txt size={14} weight="semi" color={colors.danger}>
                {problem}
              </Txt>
            ) : null}
          </>
        ) : null}
      </ScrollView>
      {invite ? (
        <View style={styles.footer}>
          {done ? (
            <>
              <Txt weight="bold" size={17} style={styles.center}>
                {invite.status === 'active' ? 'It’s on.' : 'Accepted.'}{' '}
                {invite.status === 'active'
                  ? 'It’s on your Home.'
                  : `${from} switches it on, then it shows on your Home.`}
              </Txt>
              <PillButton label="Go to Home" icon="home" onPress={() => router.replace('/')} />
            </>
          ) : invite.status !== 'invited' ? (
            <Txt size={16} color={colors.danger} style={styles.center}>
              This invite has run out. Ask {from} for a new one.
            </Txt>
          ) : (
            <PillButton
              label={busy ? 'Making your key…' : 'Accept'}
              icon="check"
              loading={busy}
              onPress={() => {
                setBusy(true)
                setProblem(null)
                accept(code as string, profile.address as Address, profile.name, signMessage)
                  .then(() => {
                    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
                    setAccepted(true)
                  })
                  .catch((e: unknown) =>
                    setProblem(e instanceof Error ? e.message : 'That didn’t go through.'),
                  )
                  .finally(() => setBusy(false))
              }}
            />
          )}
        </View>
      ) : null}
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 24, paddingBottom: 40, gap: 18 },
  art: { alignItems: 'center', marginTop: 8 },
  title: { textAlign: 'center', lineHeight: 38 },
  lead: { textAlign: 'center', marginTop: 10, lineHeight: 24 },
  facts: { gap: 0, borderRadius: 22, backgroundColor: colors.surface, paddingHorizontal: 16 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  footer: { paddingHorizontal: 24, paddingBottom: 34, gap: 12 },
  center: { textAlign: 'center' },
})
