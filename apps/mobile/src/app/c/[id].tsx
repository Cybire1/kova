import * as Haptics from 'expo-haptics'
import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  Share,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native'
import Animated, { FadeIn } from 'react-native-reanimated'
import { type Hex, isAddressEqual } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { getLink, type PaymentLink } from '@/lib/chain'
import { linkKeyFrom } from '@/lib/links'
import { baseToNumber, formatLocal, formatUsd, toBase } from '@/lib/money'
import { linkKey, linkUrl, plainUsd, shareMessage } from '@/lib/paylinks'
import { colors } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Kovi } from '@/ui/art'
import { Icon } from '@/ui/Icon'
import { Envelope, NoteSlip } from '@/ui/LinkParts'
import { Chip, Header, PillButton, Rise, Screen, TextLink, Txt } from '@/ui/primitives'

/** Development only: links already auto-claimed this run. */
const autoDone = new Set<string>()

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

/** The key in the # of the link that opened the app, when iOS hands Kova the whole link. */
function useKeyFromUrl(id: string | undefined) {
  const [key, setKey] = useState<Hex | null>(null)
  useEffect(() => {
    if (!id) return
    const take = (url: string | null) => {
      if (!url || !url.includes(`/c/${id}`)) return
      const found = linkKeyFrom(url.split('#')[1])
      if (found) setKey(found)
    }
    void Linking.getInitialURL().then(take)
    const sub = Linking.addEventListener('url', ({ url }) => take(url))
    return () => sub.remove()
  }, [id])
  return key
}

/**
 * A link someone sent: who, how much (and about how much in your currency), their note, and one
 * button that moves it into this wallet. Kova pays the gas; the key from the link signs it here.
 */
export default function Claim() {
  const params = useLocalSearchParams<{ id: string; key?: string; autoclaim?: string }>()
  const { status, profile, claimFromLink, takeBack } = useWallet()
  const { width } = useWindowDimensions()
  const fromUrl = useKeyFromUrl(params.id)
  const [kept, setKept] = useState<Hex | null>(null)
  const key = linkKeyFrom(params.key) ?? fromUrl ?? kept

  const [link, setLink] = useState<PaymentLink | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [busy, setBusy] = useState<'claim' | 'back' | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const load = useCallback(async () => {
    setFailed(null)
    try {
      setLink(await getLink(params.id))
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      setFailed(/no such link/i.test(message) ? 'missing' : message || 'Kova is unreachable.')
    }
  }, [params.id])
  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => {
    if (link?.phone_payment) router.replace({ pathname: '/phone/[id]', params: { id: link.id } })
  }, [link])

  // Your own link: this phone kept its key, so it can be shared again.
  useEffect(() => {
    if (link && profile && isAddressEqual(link.sender_address, profile.address))
      void linkKey(link.link_address).then(setKept)
  }, [link, profile])

  // Development only: `autoclaim=1` presses the main button (claim, or take back your own link) once.
  const primary = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (!__DEV__ || params.autoclaim !== '1' || link?.status !== 'open' || autoDone.has(link.id))
      return
    const timer = setTimeout(() => {
      if (autoDone.has(link.id)) return
      autoDone.add(link.id)
      primary.current?.()
    }, 2500)
    return () => clearTimeout(timer)
  }, [link, params.autoclaim])

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'))

  if (failed)
    return (
      <Screen>
        <Header backIcon="close" onBack={close} />
        <View style={styles.center}>
          <Kovi pose="oops" size={170} />
          <Txt weight="bold" size={26} style={styles.title}>
            {failed === 'missing' ? 'This link doesn’t exist' : 'Couldn’t open the link'}
          </Txt>
          <Txt size={15} color={colors.muted} style={styles.body}>
            {failed === 'missing'
              ? 'Check that the whole link was copied, or ask whoever sent it to share it again.'
              : `${failed} Check your connection and try again.`}
          </Txt>
        </View>
        <View style={styles.footer}>
          {failed === 'missing' ? (
            <PillButton label="Done" icon="check" onPress={close} />
          ) : (
            <PillButton label="Try again" icon="arrow" onPress={() => void load()} />
          )}
        </View>
      </Screen>
    )

  if (!link || status === 'loading')
    return (
      <Screen bg={colors.tealSoft}>
        <Header backIcon="close" onBack={close} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.ink} />
          <Txt weight="medium" size={16} style={{ marginTop: 12 }}>
            Opening the link
          </Txt>
        </View>
      </Screen>
    )

  const base = toBase(link.amount)
  const sender = link.sender_name?.trim() || short(link.sender_address)
  const first = sender.startsWith('0x') ? sender : sender.split(' ')[0]
  const mine = !!profile && isAddressEqual(link.sender_address, profile.address)
  const local =
    profile && profile.currency !== 'USD' ? formatLocal(baseToNumber(base), profile.currency) : null
  const claimedByMe =
    !!profile && !!link.claimed_by && isAddressEqual(link.claimed_by, profile.address)
  // The key must be this link's: a mangled copy is caught here, before anything is signed.
  const keyFits = !!key && isAddressEqual(privateKeyToAccount(key).address, link.link_address)

  const claim = async () => {
    if (!key) return
    setBusy('claim')
    setProblem(null)
    try {
      const done = await claimFromLink(link, key)
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      router.replace({
        pathname: '/received',
        params: {
          amount: done.entry.amount,
          name: first,
          via: 'link',
          ...(link.note ? { note: link.note } : {}),
        },
      })
    } catch (error) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      setProblem(error instanceof Error ? error.message : 'The dollars didn’t move.')
      setBusy(null)
      void load()
    }
  }

  const back = async () => {
    setBusy('back')
    setProblem(null)
    try {
      setLink(await takeBack(link))
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    } catch (error) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      setProblem(error instanceof Error ? error.message : 'The dollars didn’t move.')
    } finally {
      setBusy(null)
    }
  }

  primary.current = mine
    ? () => void back()
    : keyFits && status === 'ready'
      ? () => void claim()
      : null

  // What the screen says, by where the link stands.
  const open = link.status === 'open'
  const tone = open ? 'coral' : link.status === 'claimed' && claimedByMe ? 'teal' : 'muted'
  const headline = !open
    ? link.status === 'returned'
      ? mine
        ? 'You took this link back'
        : `${first} took this one back`
      : claimedByMe
        ? 'You claimed this link'
        : mine
          ? 'Your link was claimed'
          : 'Someone already claimed this'
    : mine
      ? 'Your link'
      : `${first} sent you`
  const line = !open
    ? link.status === 'returned'
      ? mine
        ? 'The dollars are back in your balance.'
        : 'The dollars went back to them. Ask them to send it again.'
      : claimedByMe
        ? 'It’s in your balance.'
        : mine
          ? `Claimed by ${short(link.claimed_by ?? '')}.`
          : 'A link can only be claimed once.'
    : mine
      ? 'It waits for whoever you sent it to. Not claimed? Take it back.'
      : local
        ? `About ${local}, yours to claim`
        : 'Yours to claim'

  return (
    <Screen bg={open && !mine ? colors.tealSoft : colors.paper}>
      <Header
        backIcon="close"
        onBack={close}
        right={
          <Chip
            label={
              open
                ? mine
                  ? 'Waiting'
                  : 'Waiting for you'
                : link.status === 'returned'
                  ? 'Taken back'
                  : 'Claimed'
            }
            dot={open ? colors.coral : colors.tealLight}
          />
        }
      />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View style={{ alignItems: 'center', marginTop: 18 }}>
          <Envelope
            width={Math.min(260, width - 110)}
            amount={formatUsd(base)}
            caption={open ? (mine ? 'Not claimed yet' : `From ${first}`) : undefined}
            open={open || (claimedByMe && link.status === 'claimed')}
            delay={250}
            tone={tone}
          />
        </View>
        <Rise style={styles.copy} delay={120}>
          <Txt weight="medium" size={20}>
            {headline}
          </Txt>
          <Txt
            weight="bold"
            size={56}
            style={{ letterSpacing: -2.2, opacity: open ? 1 : 0.5 }}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {formatUsd(base)}
          </Txt>
          <Txt size={16} color={colors.onTint} style={{ textAlign: 'center' }}>
            {line}
          </Txt>
        </Rise>
        {link.note ? (
          <View style={{ marginTop: 18 }}>
            <NoteSlip text={link.note} caption={mine ? 'Your note on the link' : `From ${first}`} />
          </View>
        ) : null}
        {open && !mine && !keyFits ? (
          <View style={styles.warn}>
            <Icon name="info" size={18} color={colors.danger} />
            <Txt
              weight="medium"
              size={14}
              color={colors.danger}
              style={{ flex: 1, lineHeight: 19 }}
            >
              This link is missing the part that claims it. Open the whole link from {first}’s
              message.
            </Txt>
          </View>
        ) : null}
        {problem ? (
          <Animated.View entering={FadeIn} style={styles.warn}>
            <Icon name="info" size={18} color={colors.danger} />
            <Txt
              weight="medium"
              size={14}
              color={colors.danger}
              style={{ flex: 1, lineHeight: 19 }}
            >
              {problem}
            </Txt>
          </Animated.View>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        {open && !mine && status === 'none' ? (
          <>
            <PillButton
              label="Make a Kova wallet to claim it"
              icon="arrow"
              onPress={() => router.replace('/welcome')}
            />
            <Txt size={13} color={colors.onTint} style={styles.small}>
              It takes a minute. Then open this link again.
            </Txt>
          </>
        ) : open && !mine && key && keyFits ? (
          <>
            <PillButton
              label={busy ? 'Claiming' : `Claim ${plainUsd(base)}`}
              icon="receive"
              loading={busy === 'claim'}
              onPress={() => void claim()}
            />
            <Txt size={13} color={colors.onTint} style={styles.small}>
              Lands in your Kova balance in about a second. No fee.
            </Txt>
          </>
        ) : open && mine ? (
          <View style={{ gap: 10 }}>
            {key ? (
              <PillButton
                label="Share it again"
                icon="share"
                onPress={() =>
                  void Share.share({
                    message: shareMessage(
                      profile?.name ?? '',
                      base,
                      linkUrl(link.id, key),
                      link.note,
                    ),
                  })
                }
              />
            ) : null}
            <PillButton
              label="Take it back"
              icon="receive"
              tone="white"
              loading={busy === 'back'}
              onPress={() => void back()}
            />
          </View>
        ) : claimedByMe || (mine && link.status === 'returned') ? (
          <PillButton
            label="See your activity"
            icon="arrow"
            onPress={() => router.replace('/(tabs)/activity')}
          />
        ) : (
          <PillButton label="Done" icon="check" onPress={close} />
        )}
        {mine && !open ? (
          <View style={{ alignItems: 'center', marginTop: 12 }}>
            <TextLink label="Your links" onPress={() => router.replace('/links')} />
          </View>
        ) : null}
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  title: { marginTop: 10, textAlign: 'center', letterSpacing: -0.6 },
  body: { marginTop: 6, textAlign: 'center', lineHeight: 21 },
  copy: { alignItems: 'center', paddingHorizontal: 24, marginTop: 14 },
  warn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginTop: 18,
    padding: 12,
    borderRadius: 16,
    backgroundColor: colors.coralSoft,
  },
  footer: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  small: { textAlign: 'center', marginTop: 10 },
})
