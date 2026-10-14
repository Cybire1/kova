import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import { useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
import type { Address } from 'viem'
import { apiUrl, shareWebUrl } from '@/lib/config'
import {
  freeze,
  inviteSomeone,
  leftLine,
  limitLine,
  newAgent,
  removeKey,
  type SpendKey,
  switchOn,
} from '@/lib/spend-keys'
import { colors } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Icon, type IconName } from '@/ui/Icon'
import {
  Approval,
  copyAndTell,
  Field,
  KeyIcon,
  styles as keyStyles,
  Mini,
  Received,
  shareLink,
  useKeys,
} from '@/ui/Keys'
import { Header, Screen, Txt } from '@/ui/primitives'

/**
 * Keys: everything that spends your dollars gets its own key. An allowance on Mum's phone, a
 * budget for someone at your till, an AI agent's key, your Kova Card: each linked to your wallet
 * through Kova's card contract on Monad, which caps its day and stops it while frozen.
 */

type Kind = 'allowance' | 'team' | 'agent'
const groups: {
  kind: Kind
  title: string
  icon: IconName
  tone: string
  empty: string
  add: string
}[] = [
  {
    kind: 'allowance',
    title: 'Allowances',
    icon: 'sparkle',
    tone: colors.coralSoft,
    empty: 'Give someone dollars to spend, a day or a week at a time.',
    add: 'Give one',
  },
  {
    kind: 'team',
    title: 'Your team',
    icon: 'user',
    tone: colors.tealSoft,
    empty: 'Give someone at your shop a budget of their own.',
    add: 'Add someone',
  },
  {
    kind: 'agent',
    title: 'AI agents',
    icon: 'bolt',
    tone: colors.tealSoft,
    empty: 'Let Claude or any AI agent pay, within limits you set.',
    add: 'New agent key',
  },
]

const statusLine = (key: SpendKey) => {
  if (key.status === 'invited') return 'Invite sent. Waiting for them to accept.'
  if (key.status === 'accepted')
    return key.kind === 'agent'
      ? 'Ready to switch on.'
      : `${key.holder_name ?? 'They'} accepted. Switch it on.`
  if (key.status === 'frozen') return `Frozen · ${limitLine(key)}`
  return `${leftLine(key)} · ${limitLine(key)}`
}

export default function Keys() {
  const { profile, signTypedData, signMessage } = useWallet()
  const { list, problem, load } = useKeys()
  const [making, setMaking] = useState<Kind | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [token, setToken] = useState<{ name: string; line: string } | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  if (!profile) return null
  const owner = profile.address as Address

  const act = async (id: string, run: () => Promise<unknown>) => {
    setBusy(id)
    setError(null)
    try {
      await run()
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t go through.')
    } finally {
      setBusy(null)
    }
  }

  const turnOn = (key: SpendKey) =>
    act(key.id, async () => {
      const on = await switchOn(owner, key, signTypedData)
      if (on.token)
        setToken({
          name: key.name,
          line: `claude mcp add --transport http kova ${apiUrl.replace(/\/$/, '')}/mcp --header "Authorization: Bearer ${on.token}"`,
        })
    })

  return (
    <Screen>
      <Header title="Keys" />
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true)
              void load().finally(() => setRefreshing(false))
            }}
          />
        }
      >
        <Txt size={16} color={colors.onTint} style={styles.lead}>
          Everything that spends your dollars gets its own key. Monad enforces each limit, and one
          tap freezes any key.
        </Txt>

        {error || problem ? (
          <Txt size={14} weight="semi" color={colors.danger}>
            {error ?? problem}
          </Txt>
        ) : null}

        {token ? (
          <View style={[keyStyles.form, styles.token]}>
            <Txt weight="bold" size={17}>
              {token.name}’s key is on
            </Txt>
            <Txt size={14} color={colors.onTint}>
              Kova shows the token once. In Claude Code, this one line connects it.
            </Txt>
            <View style={styles.code}>
              <Txt size={13} color={colors.surface} selectable>
                {token.line}
              </Txt>
            </View>
            <View style={keyStyles.actions}>
              <Mini label="Copy" icon="copy" ink onPress={() => void copyAndTell(token.line)} />
              <Mini label="Done" onPress={() => setToken(null)} />
            </View>
          </View>
        ) : null}

        {list && list.approvals.length > 0 ? (
          <View style={styles.section}>
            <Txt weight="bold" size={20}>
              Waiting for you
            </Txt>
            {list.approvals.map((p) => (
              <Approval key={p.id} payment={p} onDone={load} />
            ))}
          </View>
        ) : null}

        {list && list.received.length > 0 ? (
          <View style={styles.section}>
            <Txt weight="bold" size={20}>
              Given to you
            </Txt>
            {list.received.map((k) => (
              <Received key={k.id} spendKey={k} onDone={load} />
            ))}
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/(tabs)/card')}
          style={({ pressed }) => [keyStyles.row, pressed && { opacity: 0.7 }]}
        >
          <KeyIcon name="card" tone={colors.coralSoft} />
          <View style={keyStyles.rowText}>
            <Txt weight="bold" size={16}>
              Kova Card
            </Txt>
            <Txt size={13} color={colors.muted}>
              Tap to pay at any Kova till, with a daily limit you set
            </Txt>
          </View>
          <Icon name="arrow" size={18} />
        </Pressable>

        {groups.map((group) => {
          const keys = list?.data.filter((k) => k.kind === group.kind) ?? []
          return (
            <View key={group.kind} style={styles.section}>
              <View style={styles.sectionHead}>
                <Txt weight="bold" size={20}>
                  {group.title}
                </Txt>
                <Mini
                  label={group.add}
                  icon="plus"
                  ink
                  onPress={() => setMaking(making === group.kind ? null : group.kind)}
                />
              </View>
              {making === group.kind ? (
                group.kind === 'agent' ? (
                  <AgentForm
                    owner={owner}
                    onMade={(made) => {
                      setMaking(null)
                      void turnOn(made)
                    }}
                  />
                ) : (
                  <InviteForm
                    owner={owner}
                    ownerName={profile.name}
                    kind={group.kind}
                    onMade={load}
                  />
                )
              ) : null}
              {list && keys.length === 0 && making !== group.kind ? (
                <Txt size={14} color={colors.muted}>
                  {group.empty}
                </Txt>
              ) : null}
              {keys.map((k) => (
                <View key={k.id} style={[keyStyles.row, k.status === 'frozen' && styles.frozen]}>
                  <KeyIcon name={group.icon} tone={group.tone} />
                  <View style={keyStyles.rowText}>
                    <Txt weight="bold" size={16}>
                      {k.name}
                    </Txt>
                    <Txt size={13} color={colors.muted}>
                      {statusLine(k)}
                    </Txt>
                    {k.kind === 'agent' && k.rules ? (
                      <Txt size={13} color={colors.muted}>
                        Up to ${k.rules.per_payment} a payment · asks above ${k.rules.ask_above}
                      </Txt>
                    ) : null}
                  </View>
                  <View style={keyStyles.actions}>
                    {k.status === 'accepted' ? (
                      <Mini
                        label="Switch on"
                        ink
                        busy={busy === k.id}
                        onPress={() => void turnOn(k)}
                      />
                    ) : null}
                    {k.status === 'active' || k.status === 'frozen' ? (
                      <Mini
                        label={k.status === 'frozen' ? 'Unfreeze' : 'Freeze'}
                        icon="snow"
                        ink={k.status === 'frozen'}
                        busy={busy === k.id}
                        onPress={() =>
                          void act(k.id, () =>
                            freeze(owner, k, k.status !== 'frozen', signTypedData),
                          )
                        }
                      />
                    ) : null}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${k.name}`}
                      onPress={() =>
                        void act(`rm-${k.id}`, () =>
                          removeKey(owner, k, signTypedData, signMessage),
                        )
                      }
                      style={styles.trash}
                    >
                      <Icon name="trash" size={16} />
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          )
        })}

        <Txt size={13} color={colors.muted} style={styles.fine}>
          Keys spend through Kova’s card contract on Monad: it holds each key’s daily limit and
          whether it’s frozen, and every payment needs the key’s signature and Kova’s. Kova never
          holds your dollars.
        </Txt>
      </ScrollView>
    </Screen>
  )
}

function InviteForm({
  owner,
  ownerName,
  kind,
  onMade,
}: {
  owner: Address
  ownerName: string
  kind: 'allowance' | 'team'
  onMade: () => void
}) {
  const [name, setName] = useState('')
  const [limit, setLimit] = useState(kind === 'team' ? '20' : '30')
  const [period, setPeriod] = useState<'day' | 'week'>(kind === 'team' ? 'day' : 'week')
  const [link, setLink] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  if (link)
    return (
      <View style={keyStyles.form}>
        <Txt weight="bold" size={17}>
          Send this link to {name}
        </Txt>
        <Txt size={14} color={colors.onTint}>
          Whoever opens it first accepts it on their own phone. Then you switch it on here.
        </Txt>
        <View style={styles.code}>
          <Txt size={13} color={colors.surface} selectable>
            {link}
          </Txt>
        </View>
        <View style={keyStyles.actions}>
          <Mini
            label="Share"
            icon="share"
            ink
            onPress={() =>
              void shareLink(
                `${ownerName || 'Someone'} gave you ${kind === 'team' ? 'a budget' : 'an allowance'} on Kova`,
                link,
              )
            }
          />
          <Mini label="Copy" icon="copy" onPress={() => void copyAndTell(link)} />
        </View>
      </View>
    )
  return (
    <View style={keyStyles.form}>
      <Field
        label="Who’s it for?"
        value={name}
        onChange={setName}
        placeholder={kind === 'team' ? 'Tobi at the till' : 'Mum'}
      />
      <View style={styles.twoUp}>
        <View style={{ flex: 1 }}>
          <Field label="Up to" value={limit} onChange={setLimit} money />
        </View>
        <View style={styles.periods}>
          {(['day', 'week'] as const).map((p) => (
            <Pressable
              key={p}
              accessibilityRole="button"
              accessibilityState={{ selected: period === p }}
              onPress={() => setPeriod(p)}
              style={[styles.period, period === p && styles.periodOn]}
            >
              <Txt weight="bold" size={14} color={period === p ? colors.white : colors.ink}>
                a {p}
              </Txt>
            </Pressable>
          ))}
        </View>
      </View>
      {problem ? (
        <Txt size={13} color={colors.danger}>
          {problem}
        </Txt>
      ) : null}
      <Mini
        label={busy ? 'Making the link…' : 'Make the invite link'}
        icon="share"
        ink
        busy={busy}
        onPress={() => {
          if (!name.trim() || !limit) return setProblem('Say who it’s for and how much.')
          setBusy(true)
          setProblem(null)
          inviteSomeone(owner, {
            kind,
            name,
            limit,
            period,
            days: kind === 'team' ? 90 : 30,
            ownerName,
          })
            .then((made) => {
              setLink(`${shareWebUrl.replace(/\/$/, '')}/a/${made.code}`)
              onMade()
            })
            .catch((e: unknown) => setProblem(e instanceof Error ? e.message : 'That didn’t work.'))
            .finally(() => setBusy(false))
        }}
      />
    </View>
  )
}

function AgentForm({ owner, onMade }: { owner: Address; onMade: (key: SpendKey) => void }) {
  const [name, setName] = useState('Claude')
  const [limit, setLimit] = useState('20')
  const [perPayment, setPerPayment] = useState('5')
  const [askAbove, setAskAbove] = useState('1')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  return (
    <View style={keyStyles.form}>
      <Field label="Name" value={name} onChange={setName} />
      <View style={styles.twoUp}>
        <View style={{ flex: 1 }}>
          <Field label="Up to, a day" value={limit} onChange={setLimit} money />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Most a payment" value={perPayment} onChange={setPerPayment} money />
        </View>
      </View>
      <Field label="Ask me above" value={askAbove} onChange={setAskAbove} money />
      {problem ? (
        <Txt size={13} color={colors.danger}>
          {problem}
        </Txt>
      ) : null}
      <Mini
        label={busy ? 'Making the key…' : 'Make it and switch it on'}
        icon="bolt"
        ink
        busy={busy}
        onPress={() => {
          setBusy(true)
          setProblem(null)
          newAgent(owner, { name, limit, period: 'day', perPayment, askAbove, days: 30 })
            .then(onMade)
            .catch((e: unknown) => setProblem(e instanceof Error ? e.message : 'That didn’t work.'))
            .finally(() => setBusy(false))
        }}
      />
      <Txt size={12} color={colors.muted}>
        Face ID signs the key’s limit onto Monad. Kova pays the network fee.
      </Txt>
    </View>
  )
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingBottom: 60, gap: 14 },
  lead: { lineHeight: 22 },
  section: { gap: 10, marginTop: 8 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  frozen: { opacity: 0.7, borderStyle: 'dashed' },
  trash: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.sunken,
  },
  code: { padding: 12, borderRadius: 14, backgroundColor: colors.ink },
  token: { borderWidth: 2, borderColor: colors.tealDeep, backgroundColor: '#E5EFEF' },
  twoUp: { flexDirection: 'row', gap: 10, alignItems: 'flex-end' },
  periods: { flexDirection: 'row', gap: 6 },
  period: {
    height: 46,
    paddingHorizontal: 14,
    borderRadius: 23,
    borderWidth: 2,
    borderColor: colors.ink,
    justifyContent: 'center',
  },
  periodOn: { backgroundColor: colors.ink },
  fine: { marginTop: 10, lineHeight: 18 },
})
