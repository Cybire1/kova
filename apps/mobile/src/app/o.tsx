import { formatAmount, type OfflinePayment, offlineCodeFrom } from '@kova/monad'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Linking, StyleSheet, View } from 'react-native'
import { isAddressEqual } from 'viem'
import { type Accepted, useOffline } from '@/lib/offline'
import { colors } from '@/lib/theme'
import { isUnnamed, useWallet } from '@/lib/wallet'
import { Kovi } from '@/ui/art'
import { Header, PillButton, Rise, Screen, Sticker, Txt } from '@/ui/primitives'

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

/** The code in the # of the link that opened the app, when iOS hands Kova the whole link. */
function useCodeFromUrl() {
  const [code, setCode] = useState<string | null>(null)
  useEffect(() => {
    const take = (url: string | null) => {
      const found = url
        ? offlineCodeFrom(url.replace(/^kova:\/\/o#/, 'https://mykova.app/o#'))
        : null
      if (found) setCode(found)
    }
    void Linking.getInitialURL().then(take)
    const sub = Linking.addEventListener('url', ({ url }) => take(url))
    return () => sub.remove()
  }, [])
  return code
}

/**
 * A payment code someone showed this phone (scanned, or opened as a link): checked right here with
 * no network. One to this wallet goes in the inbox and opens as an arrival; anything else says what
 * it is, and whose.
 */
export default function OpenCode() {
  const params = useLocalSearchParams<{ code?: string }>()
  const fromUrl = useCodeFromUrl()
  const code = params.code || fromUrl
  const { status, contacts } = useWallet()
  const { accept } = useOffline()
  const [result, setResult] = useState<Accepted | null>(null)

  useEffect(() => {
    if (!code || status === 'loading') return
    let live = true
    void accept(code).then((r) => {
      if (!live) return
      if (r.kind === 'mine')
        router.replace({ pathname: '/offline/[id]', params: { id: r.item.id, fresh: '1' } })
      else if (r.kind === 'own' && r.item)
        router.replace({ pathname: '/offline/[id]', params: { id: r.item.id } })
      else setResult(r)
    })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, status])

  const named = (address: string) => {
    const saved = contacts.find((c) => isAddressEqual(c.address, address as `0x${string}`))?.name
    return saved && !isUnnamed(saved) ? saved : null
  }
  const close = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))

  if (!result)
    return (
      <Screen bg={colors.tealSoft}>
        <Header backIcon="close" onBack={close} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.ink} />
          <Txt weight="medium" size={16} style={{ marginTop: 12 }}>
            {code ? 'Checking the signature…' : 'Waiting for the code…'}
          </Txt>
        </View>
      </Screen>
    )

  const p: OfflinePayment | null = result.kind === 'mine' ? null : result.payment
  const amount = p ? `$${formatAmount(p.authorization.value)}` : null
  const sender = p
    ? (named(p.authorization.from) ?? p.name ?? short(p.authorization.from))
    : 'Someone'
  const recipient = p ? (named(p.authorization.to) ?? short(p.authorization.to)) : ''
  const copy =
    result.kind === 'theirs'
      ? {
          pose: 'wave' as const,
          title: 'This payment isn’t for you',
          body: `${sender} signed it to ${recipient}${named(p?.authorization.to ?? '') ? ` (${short(p?.authorization.to ?? '')})` : ''}, not this wallet. Only their phone can take it.`,
        }
      : result.kind === 'own'
        ? {
            pose: 'wave' as const,
            title: 'This one’s yours',
            body: `You signed it to ${recipient}. Show it to them, or share it: it settles as soon as either phone is online.`,
          }
        : result.kind === 'invalid'
          ? {
              pose: 'oops' as const,
              title:
                result.reason === 'expired'
                  ? 'This code has run out'
                  : result.reason === 'no-wallet'
                    ? 'Make your wallet first'
                    : 'This code doesn’t check out',
              body:
                result.reason === 'bad-signature'
                  ? 'Its signature doesn’t match the wallet it says it’s from. Don’t take it as paid.'
                  : result.reason === 'expired'
                    ? `It waited longer than a week, so it can’t settle now. Ask ${sender} for a new one.`
                    : result.reason === 'too-large'
                      ? 'It’s for more than $100, more than one code can carry.'
                      : result.reason === 'zero'
                        ? 'It’s for $0.00.'
                        : result.reason === 'no-wallet'
                          ? 'A payment code goes into a Kova wallet. Make yours, then open the code again.'
                          : result.reason === 'not-a-code'
                            ? 'It isn’t a Kova payment code.'
                            : 'It’s for a dollar or a network this wallet doesn’t use.',
            }
          : { pose: 'wave' as const, title: '', body: '' }

  return (
    <Screen bg={colors.tealSoft}>
      <Header backIcon="close" onBack={close} />
      <View style={styles.center}>
        <Kovi pose={copy.pose} size={150} />
        <Rise style={{ alignItems: 'center', paddingHorizontal: 28 }}>
          <Txt
            weight="bold"
            size={28}
            style={{ letterSpacing: -0.8, textAlign: 'center', marginTop: 8 }}
          >
            {copy.title}
          </Txt>
          <Txt
            size={16}
            color={colors.onTint}
            style={{ textAlign: 'center', marginTop: 8, lineHeight: 22 }}
          >
            {copy.body}
          </Txt>
        </Rise>
        {p && amount ? (
          <Sticker radius={22} style={styles.card}>
            <View style={styles.row}>
              <Txt size={15} color={colors.muted}>
                From
              </Txt>
              <Txt weight="semi" size={15}>
                {sender}
              </Txt>
            </View>
            <View style={styles.row}>
              <Txt size={15} color={colors.muted}>
                To
              </Txt>
              <Txt weight="semi" size={15}>
                {recipient}
              </Txt>
            </View>
            <View style={styles.row}>
              <Txt size={15} color={colors.muted}>
                Amount
              </Txt>
              <Txt weight="semi" size={15}>
                {amount}
              </Txt>
            </View>
          </Sticker>
        ) : null}
      </View>
      <View style={styles.footer}>
        <PillButton label="Done" icon="check" onPress={close} />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 30 },
  card: {
    alignSelf: 'stretch',
    marginHorizontal: 20,
    marginTop: 22,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  footer: { paddingHorizontal: 20, paddingBottom: 12, paddingTop: 8 },
})
