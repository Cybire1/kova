import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  View,
} from 'react-native'
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated'
import type { Hex } from 'viem'
import { linksFrom, type PaymentLink, recordLink } from '@/lib/chain'
import { formatUsd, toBase } from '@/lib/money'
import {
  linkKey,
  linkUrl,
  plainUsd,
  type SavedLink,
  savedLinks,
  setLinkId,
  shareMessage,
} from '@/lib/paylinks'
import { colors } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Kovi } from '@/ui/art'
import { Icon, type IconName } from '@/ui/Icon'
import { EnvelopeBadge } from '@/ui/LinkParts'
import { Header, PillButton, RoundButton, Screen, Txt } from '@/ui/primitives'

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-2)}`

function made(at: string | number) {
  const d = new Date(at)
  const today = new Date().toDateString() === d.toDateString()
  return today
    ? `Today, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : d.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

type Row =
  | { kind: 'link'; link: PaymentLink; key: Hex | null }
  /** Dollars sent to a link Kova hasn't recorded yet (no signal at the time): it's finished on the next look. */
  | { kind: 'pending'; saved: SavedLink }

/**
 * Every link you've sent: what's still waiting, what was claimed and by whom, and what you took
 * back. A waiting link can be shared again or taken back from here, because this phone kept its key.
 */
export default function Links() {
  const { profile, takeBack } = useWallet()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [working, setWorking] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!profile) return
    setProblem(null)
    const local = await savedLinks()
    // Links whose dollars left but which Kova never heard about: record them now.
    for (const saved of local.filter((l) => !l.id)) {
      try {
        const link = await recordLink({
          link_address: saved.address,
          sender_address: profile.address,
          ...(profile.name ? { sender_name: profile.name } : {}),
          ...(saved.note ? { note: saved.note } : {}),
          display_currency: profile.currency,
        })
        await setLinkId(saved.address, link.id)
        saved.id = link.id
      } catch {
        // Still on its way, or no signal: shown as pending, tried again next time.
      }
    }
    try {
      const remote = await linksFrom(profile.address)
      const withKeys = await Promise.all(
        remote.map(async (link) => ({
          kind: 'link' as const,
          link,
          key: link.status === 'open' ? await linkKey(link.link_address) : null,
        })),
      )
      const known = new Set(remote.map((l) => l.link_address.toLowerCase()))
      const pending = local
        .filter((l) => !known.has(l.address.toLowerCase()) && !l.id)
        .map((saved) => ({ kind: 'pending' as const, saved }))
      setRows([...pending, ...withKeys])
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Kova is unreachable.')
      setRows((prev) => prev ?? [])
    }
  }, [profile])

  useEffect(() => {
    void load()
  }, [load])

  const refresh = async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const summary = useMemo(() => {
    let waiting = 0n
    let open = 0
    let claimed = 0
    for (const r of rows ?? []) {
      if (r.kind === 'pending') {
        waiting += BigInt(r.saved.amount)
        open += 1
      } else if (r.link.status === 'open') {
        waiting += toBase(r.link.amount)
        open += 1
      } else if (r.link.status === 'claimed') claimed += 1
    }
    return { waiting, open, claimed }
  }, [rows])

  const confirmBack = (link: PaymentLink) => {
    void Haptics.selectionAsync()
    Alert.alert(
      `Take back ${plainUsd(toBase(link.amount))}?`,
      'The link stops working and the dollars come back to your balance.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Take it back',
          style: 'destructive',
          onPress: () => {
            setWorking(link.id)
            void takeBack(link)
              .then((back) => {
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
                setRows(
                  (prev) =>
                    prev?.map((r) =>
                      r.kind === 'link' && r.link.id === back.id
                        ? { kind: 'link', link: back, key: null }
                        : r,
                    ) ?? null,
                )
              })
              .catch((error) => {
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
                setProblem(error instanceof Error ? error.message : 'The dollars didn’t move.')
                void load()
              })
              .finally(() => setWorking(null))
          },
        },
      ],
    )
  }

  const shareAgain = (link: PaymentLink, key: Hex) =>
    void Share.share({
      message: shareMessage(
        profile?.name ?? '',
        toBase(link.amount),
        linkUrl(link.id, key),
        link.note,
      ),
    })

  const waiting = rows?.filter((r) => r.kind === 'pending' || r.link.status === 'open') ?? []
  const done = rows?.filter((r) => r.kind === 'link' && r.link.status !== 'open') ?? []

  return (
    <Screen edges={['top']}>
      <Header
        title="Your links"
        right={
          <RoundButton icon="plus" label="New link" onPress={() => router.push('/send/link')} />
        }
      />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={colors.ink}
          />
        }
      >
        {rows === null ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.ink} />
          </View>
        ) : rows.length === 0 ? (
          <Animated.View entering={FadeIn} style={styles.empty}>
            <Kovi pose="wave" size={150} />
            <Txt weight="bold" size={24} style={{ marginTop: 6, letterSpacing: -0.6 }}>
              No links yet
            </Txt>
            <Txt
              size={15}
              color={colors.muted}
              style={{ textAlign: 'center', marginTop: 6, lineHeight: 21 }}
            >
              Send dollars to anyone with a link, even if they don’t have Kova. They tap it and
              claim them.
            </Txt>
            <View style={{ alignSelf: 'stretch', marginTop: 22 }}>
              <PillButton
                label="Send as a link"
                icon="send"
                onPress={() => router.push('/send/link')}
              />
            </View>
            {problem ? (
              <Txt
                weight="medium"
                size={14}
                color={colors.danger}
                style={{ marginTop: 14, textAlign: 'center' }}
              >
                {problem}
              </Txt>
            ) : null}
          </Animated.View>
        ) : (
          <>
            <View style={styles.summary}>
              <Txt weight="medium" size={14} color={colors.onInk}>
                Waiting to be claimed
              </Txt>
              <Txt weight="bold" size={40} color={colors.white} style={{ letterSpacing: -1.4 }}>
                {formatUsd(summary.waiting)}
              </Txt>
              <View style={styles.summaryRow}>
                <Stat dot={colors.coral} label={`${summary.open} waiting`} />
                <Stat dot={colors.tealLight} label={`${summary.claimed} claimed`} />
              </View>
            </View>

            {problem ? (
              <View style={styles.problem}>
                <Icon name="info" size={18} color={colors.danger} />
                <Txt weight="medium" size={14} color={colors.danger} style={{ flex: 1 }}>
                  {problem}
                </Txt>
              </View>
            ) : null}

            {waiting.length ? (
              <Txt weight="semi" size={14} color={colors.muted} style={styles.section}>
                Waiting
              </Txt>
            ) : null}
            {waiting.map((r) =>
              r.kind === 'pending' ? (
                <View key={r.saved.address} style={styles.card}>
                  <View style={styles.cardTop}>
                    <EnvelopeBadge tone="coral" />
                    <View style={{ flex: 1 }}>
                      <Txt weight="bold" size={20}>
                        {formatUsd(BigInt(r.saved.amount))}
                      </Txt>
                      <Txt size={13} color={colors.muted} numberOfLines={1}>
                        {r.saved.note ?? 'No note'} · {made(r.saved.at)}
                      </Txt>
                    </View>
                    <Status label="Saving" fill={colors.sunken} />
                  </View>
                  <Txt size={13} color={colors.onTint} style={{ marginTop: 10 }}>
                    The dollars are in the link. Pull down to finish saving it, then share it.
                  </Txt>
                </View>
              ) : (
                <LinkCard
                  key={r.link.id}
                  link={r.link}
                  onOpen={() =>
                    router.push({
                      pathname: '/c/[id]',
                      params: { id: r.link.id, ...(r.key ? { key: r.key } : {}) },
                    })
                  }
                  actions={
                    <View style={styles.actions}>
                      {r.key ? (
                        <SmallButton
                          icon="share"
                          label="Share again"
                          onPress={() => shareAgain(r.link, r.key as Hex)}
                        />
                      ) : null}
                      {r.key ? (
                        <SmallButton
                          icon="receive"
                          label="Take it back"
                          busy={working === r.link.id}
                          onPress={() => confirmBack(r.link)}
                        />
                      ) : (
                        <Txt size={13} color={colors.muted} style={{ flex: 1 }}>
                          Made on another device. Open the link there to take it back.
                        </Txt>
                      )}
                    </View>
                  }
                />
              ),
            )}

            {done.length ? (
              <Txt weight="semi" size={14} color={colors.muted} style={styles.section}>
                Done
              </Txt>
            ) : null}
            {done.map((r) =>
              r.kind === 'link' ? (
                <LinkCard
                  key={r.link.id}
                  link={r.link}
                  onOpen={() => router.push({ pathname: '/c/[id]', params: { id: r.link.id } })}
                />
              ) : null,
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  )
}

function LinkCard({
  link,
  actions,
  onOpen,
}: {
  link: PaymentLink
  actions?: ReactNode
  onOpen: () => void
}) {
  const open = link.status === 'open'
  const back = link.status === 'returned'
  return (
    <Animated.View
      layout={LinearTransition}
      style={[styles.card, !open && { backgroundColor: colors.paper }]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${formatUsd(toBase(link.amount))} link, ${link.status}`}
        onPress={onOpen}
        style={styles.cardTop}
      >
        <EnvelopeBadge tone={open ? 'coral' : back ? 'muted' : 'teal'} />
        <View style={{ flex: 1 }}>
          <Txt
            weight="bold"
            size={20}
            color={open ? colors.ink : colors.onTint}
            style={back ? { textDecorationLine: 'line-through' } : null}
          >
            {formatUsd(toBase(link.amount))}
          </Txt>
          <Txt size={13} color={colors.muted} numberOfLines={1}>
            {link.note ?? 'No note'} · {made(link.created_at)}
          </Txt>
        </View>
        <Status
          label={
            open ? 'Waiting' : back ? 'Taken back' : `Claimed by ${short(link.claimed_by ?? '')}`
          }
          fill={open ? colors.coralSoft : back ? colors.sunken : colors.tealSoft}
        />
      </Pressable>
      {actions}
    </Animated.View>
  )
}

function Status({ label, fill }: { label: string; fill: string }) {
  return (
    <View style={[styles.status, { backgroundColor: fill }]}>
      <Txt weight="semi" size={12}>
        {label}
      </Txt>
    </View>
  )
}

function Stat({ dot, label }: { dot: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} />
      <Txt weight="medium" size={13} color={colors.onInk}>
        {label}
      </Txt>
    </View>
  )
}

function SmallButton({
  icon,
  label,
  onPress,
  busy,
}: {
  icon: IconName
  label: string
  onPress: () => void
  busy?: boolean
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [styles.small, pressed && { transform: [{ scale: 0.96 }] }]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={colors.ink} />
      ) : (
        <Icon name={icon} size={16} />
      )}
      <Txt weight="semi" size={14}>
        {busy ? 'Taking it back' : label}
      </Txt>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  loading: { paddingTop: 80, alignItems: 'center' },
  empty: { alignItems: 'center', paddingTop: 40, paddingHorizontal: 8 },
  summary: { marginTop: 10, borderRadius: 28, backgroundColor: colors.ink, padding: 18, gap: 2 },
  summaryRow: { flexDirection: 'row', gap: 16, marginTop: 8 },
  problem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
    padding: 12,
    borderRadius: 16,
    backgroundColor: colors.coralSoft,
  },
  section: { marginTop: 22, marginBottom: 8, marginLeft: 4 },
  card: {
    marginBottom: 10,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    padding: 12,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  status: {
    height: 26,
    paddingHorizontal: 10,
    borderRadius: 13,
    justifyContent: 'center',
    maxWidth: 150,
  },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12, alignItems: 'center' },
  small: {
    flex: 1,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    borderColor: colors.ink,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
})
