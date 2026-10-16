import type { PaySource } from '@kova/monad'
import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { useRef, useState } from 'react'
import { Pressable, StyleSheet, Switch, View } from 'react-native'
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated'
import { explorerTx } from '@/lib/chain'
import { formatUsd } from '@/lib/money'
import { type Route, type SpendProgress, usePrivate } from '@/lib/private'
import type { PrivateReceipt } from '@/lib/private-core'
import { type MoveProgress, shortAddress } from '@/lib/takings-core'
import { colors } from '@/lib/theme'
import { isUnnamed, useWallet } from '@/lib/wallet'
import { Avatar } from './art'
import { PrivateAvatar, when } from './EntryRow'
import { Icon } from './Icon'
import { PopIn } from './motion'
import { PillButton, Txt } from './primitives'
import { AddressChip, freshMove } from './Takings'

/**
 * Private dollars, drawn: payments people sent this wallet privately, each at a one-time address
 * only its keys can open. They count in the balance and pay like any dollars: the privacy router
 * picks where each payment comes from, so these screens only explain, and offer a choice to anyone
 * who wants one. The card is ink, like private takings: what's in it is yours alone.
 */

/** Making them public, step by step (from the Private dollars screen's ⋯). */
const progressLabel = (p: MoveProgress) =>
  p.step === 'unlocking'
    ? 'Opening your keys…'
    : p.step === 'checking'
      ? 'Checking each one…'
      : p.step === 'signing'
        ? `Signing ${p.done} of ${p.total}…`
        : p.total > 1
          ? `Making them public, ${Math.min(p.done + 1, p.total)} of ${p.total}…`
          : 'Making it public…'

const waitingOf = (receipts: PrivateReceipt[]) => receipts.filter((r) => BigInt(r.held) > 0n)

/** Who sent it, as you know them: your name for them, else the name in their memo, else their short address. */
export function useSenderName() {
  const { contacts } = useWallet()
  return (from: string | null, memoName?: string | null) => {
    const known = from
      ? contacts.find((c) => c.address.toLowerCase() === from.toLowerCase())
      : undefined
    if (known && !isUnnamed(known.name)) return known.name
    return memoName || (from ? shortAddress(from) : 'Someone')
  }
}

/** Paying with private dollars, in words: what's happening right now, never how it works. */
export const spendLabel = (s: SpendProgress | null) =>
  !s
    ? null
    : s.step === 'unlocking'
      ? 'Opening your private dollars…'
      : s.step === 'gathering'
        ? s.total && s.total > 1
          ? `Getting your private dollars ready… ${Math.min((s.done ?? 0) + 1, s.total)} of ${s.total}`
          : 'Getting your private dollars ready…'
        : s.step === 'moving'
          ? `Moving ${s.amount ? formatUsd(s.amount) : 'them'} into your balance…`
          : 'Paying…'

/**
 * Where a payment comes from, by the privacy router, worked out again as the amount or the balance
 * changes. `direct`: private dollars may pay it straight from their addresses. `privateFirst`: a
 * private send. A choice made under Details holds for this payment only, and only while it can pay.
 * While `paying`, the route holds as it was when the payment began: the balance changes under it.
 */
export function usePaymentRoute({
  amount,
  balance,
  direct,
  privateFirst = false,
  paying = false,
}: {
  amount: bigint
  balance: bigint | null
  direct: boolean
  privateFirst?: boolean
  paying?: boolean
}) {
  const p = usePrivate()
  const [choice, choose] = useState<PaySource | null>(null)
  const now = p.route({ amount, balance, direct, privateFirst, choice })
  const held = useRef(now)
  if (!paying) held.current = now
  const route = paying ? held.current : now
  // Details offers a choice only when both ways would really pay it.
  const viaBalance = p.route({ amount, balance, direct, privateFirst, choice: 'balance' }).from
  const choosable =
    direct && p.coverFor(amount) !== null && (viaBalance === 'balance' || viaBalance === 'top-up')
  return { route, choose, choosable }
}

/**
 * The one calm line a payment needs when the balance and private dollars only cover it together:
 * how much moves into the balance first, and that the move shows on Monad.
 */
export function TopUpLine({ route, onInk }: { route: Route; onInk?: boolean }) {
  if (route.from !== 'top-up') return null
  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      style={styles.calm}
      accessibilityLiveRegion="polite"
    >
      <Icon name="lock" size={14} color={onInk ? colors.onInk : colors.onTint} />
      <Txt
        size={13}
        color={onInk ? colors.onInk : colors.onTint}
        style={{ flex: 1, lineHeight: 18 }}
      >
        {formatUsd(route.moving)} of your private dollars moves into your balance for this; that
        move is visible on Monad.
      </Txt>
    </Animated.View>
  )
}

/**
 * Details, folded away under a payment: where it comes from, for anyone who'd rather choose. The
 * router has already picked; opening this only shows that, and lets them pick the other way.
 */
export function PayDetails({
  amount,
  balance,
  route,
  onChoose,
  disabled,
}: {
  amount: bigint
  balance: bigint | null
  route: Route
  onChoose: (source: PaySource) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={open ? 'Hide details' : 'Details: where this comes from'}
        hitSlop={8}
        onPress={() => {
          void Haptics.selectionAsync()
          setOpen(!open)
        }}
        style={styles.details}
      >
        <Txt weight="semi" size={13} color={colors.muted}>
          Details
        </Txt>
        <Icon
          name={open ? 'chevronUp' : 'chevronDown'}
          size={14}
          color={colors.muted}
          strokeWidth={2.4}
        />
      </Pressable>
      {open ? (
        <Animated.View entering={FadeIn.duration(200)}>
          <PayFrom
            amount={amount}
            balance={balance}
            route={route}
            onChange={onChoose}
            disabled={disabled}
          />
        </Animated.View>
      ) : null}
    </View>
  )
}

/**
 * Pay from: your balance, or your private dollars. Each side says plainly what Monad will see; the
 * balance, when it's short, says that just enough private dollars move in first.
 */
function PayFrom({
  amount,
  balance,
  route,
  onChange,
  disabled,
}: {
  amount: bigint
  balance: bigint | null
  route: Route
  onChange: (source: PaySource) => void
  disabled?: boolean
}) {
  const p = usePrivate()
  const source: PaySource = route.from === 'private' ? 'private' : 'balance'
  const balanceShort = balance !== null && balance < amount
  const option = (key: PaySource, label: string, value: string) => {
    const on = source === key
    return (
      <Pressable
        accessibilityRole="radio"
        accessibilityState={{ selected: on, disabled: !!disabled }}
        accessibilityLabel={`Pay from ${label}, ${value}`}
        disabled={disabled}
        onPress={() => {
          void Haptics.selectionAsync()
          onChange(key)
        }}
        style={[styles.option, on && styles.optionOn]}
      >
        <View style={styles.optionTop}>
          <Icon
            name={key === 'private' ? 'lock' : 'home'}
            size={14}
            color={on ? colors.white : colors.ink}
            strokeWidth={2.4}
          />
          <Txt weight="semi" size={13} color={on ? colors.white : colors.ink}>
            {label}
          </Txt>
        </View>
        <Txt weight="bold" size={16} color={on ? colors.white : colors.ink} numberOfLines={1}>
          {value}
        </Txt>
      </Pressable>
    )
  }
  return (
    <View style={styles.payFrom} accessibilityRole="radiogroup">
      <Txt weight="semi" size={13} color={colors.muted} style={{ marginBottom: 8, marginLeft: 2 }}>
        Pay from
      </Txt>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {option('balance', 'Balance', balance === null ? '…' : formatUsd(balance))}
        {option('private', 'Private dollars', formatUsd(p.waiting))}
      </View>
      <Txt size={12} color={colors.onTint} style={{ marginTop: 8, lineHeight: 17 }}>
        {route.from === 'private'
          ? route.gather
            ? 'They’re in a few places, so they’re put together into one first: that ties them to each other on Monad, never to you. Then they pay, and Monad can’t tie it to your wallet.'
            : 'Paid from an address only you can open. Monad can’t tie it to your wallet, and the change stays private.'
          : balanceShort
            ? 'From your wallet, after just enough private dollars move into it. It’s public on Monad that it came from you.'
            : 'From your wallet, as usual. It’s public on Monad that it came from you.'}
      </Txt>
    </View>
  )
}

/** Kova's Announcement of a private payment on Monad (ERC-5564): a link once it's posted, "Announcing…" a moment before. */
export function Announced({ url, at, onInk }: { url: string | null; at: number; onInk?: boolean }) {
  const fresh = Date.now() - at < 3 * 60_000
  if (!url && !fresh) return null
  const color = onInk ? colors.white : colors.ink
  return url ? (
    <Pressable
      accessibilityRole="link"
      hitSlop={8}
      onPress={() => void WebBrowser.openBrowserAsync(url)}
      style={styles.announced}
    >
      <Icon name="check" size={14} color={color} strokeWidth={2.6} />
      <Txt weight="semi" size={13} color={color} style={{ textDecorationLine: 'underline' }}>
        Announced on Monad
      </Txt>
    </Pressable>
  ) : (
    <View style={styles.announced}>
      <Icon name="clock" size={14} color={onInk ? colors.onInk : colors.muted} />
      <Txt size={13} color={onInk ? colors.onInk : colors.muted}>
        Announcing on Monad…
      </Txt>
    </View>
  )
}

/**
 * The private dollars at a glance: how much of your balance is private, and who it's from. Nothing
 * to do here: they pay like any dollars. It tells every state in place: keys not on this phone yet,
 * nothing yet, being made public (from the screen's ⋯), and made public, with the move on Monadscan.
 */
export function PrivateCard({ onOpen, plain }: { onOpen?: () => void; plain?: boolean }) {
  const p = usePrivate()
  const senderName = useSenderName()
  const waiting = waitingOf(p.receipts)
  const moved = freshMove(p.moved)
  const done = moved !== null && !p.progress && waiting.length === 0
  const lead = plain ? { marginTop: 0 } : null

  // The people behind them, newest first, each once.
  const senders: { key: string; label: string }[] = []
  for (const r of waiting) {
    const label = r.kind === 'change' ? 'you' : senderName(r.from, r.senderName)
    if (!senders.some((s) => s.label === label)) senders.push({ key: r.id, label })
  }

  return (
    <Animated.View layout={LinearTransition} style={styles.card}>
      {plain ? null : (
        <Pressable
          accessibilityRole={onOpen ? 'button' : undefined}
          accessibilityLabel={onOpen ? 'Private dollars. See every private payment' : undefined}
          disabled={!onOpen}
          onPress={onOpen}
          style={styles.cardHead}
        >
          <View style={styles.lockDisc}>
            <Icon name="lock" size={17} color={colors.white} strokeWidth={2.3} />
          </View>
          <Txt weight="semi" size={15} color={colors.white} style={{ flex: 1 }}>
            Private dollars
          </Txt>
          {onOpen ? <Icon name="arrow" size={18} color={colors.onInk} /> : null}
        </Pressable>
      )}

      {done && moved ? (
        <Animated.View entering={FadeIn.duration(260)}>
          <PopIn style={[styles.movedTag, lead]}>
            <Icon name="check" size={13} color={colors.ink} strokeWidth={2.6} />
            <Txt weight="semi" size={12}>
              {moved.count ? 'Made public' : 'Nothing to move'}
            </Txt>
          </PopIn>
          {moved.count ? (
            <>
              <Txt
                weight="bold"
                size={44}
                color={colors.white}
                style={styles.amount}
                accessibilityLabel={`Made ${formatUsd(moved.amount)} public in ${(moved.ms / 1000).toFixed(1)} seconds`}
              >
                {formatUsd(moved.amount)}
              </Txt>
              <Txt size={15} color={colors.onInk} style={{ lineHeight: 21 }}>
                moved into your wallet in {(moved.ms / 1000).toFixed(1)} s. Still in your balance;
                The move is public on Monad.
              </Txt>
            </>
          ) : (
            <Txt size={15} color={colors.onInk} style={{ marginTop: 10, lineHeight: 21 }}>
              They had already moved: everything private was public already.
            </Txt>
          )}
          {moved.failed ? (
            <Txt weight="medium" size={13} color={colors.coralSoft} style={{ marginTop: 8 }}>
              {moved.failed} didn’t move: {moved.reason}
            </Txt>
          ) : null}
          <View style={styles.doneRow}>
            {moved.explorerUrl ? (
              <Pressable
                accessibilityRole="link"
                onPress={() => void WebBrowser.openBrowserAsync(moved.explorerUrl as string)}
                style={({ pressed }) => [styles.ghost, pressed && { opacity: 0.7 }]}
              >
                <Icon name="web" size={16} color={colors.white} />
                <Txt weight="semi" size={14} color={colors.white}>
                  View on Monadscan
                </Txt>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={p.clearMoved}
              style={({ pressed }) => [styles.doneButton, pressed && { opacity: 0.8 }]}
            >
              <Txt weight="semi" size={14}>
                Done
              </Txt>
            </Pressable>
          </View>
        </Animated.View>
      ) : !p.keysHere ? (
        <View>
          <Txt
            weight="bold"
            size={24}
            color={colors.white}
            style={[{ marginTop: 14, letterSpacing: -0.6 }, lead]}
          >
            Receive privately
          </Txt>
          <Txt size={14} color={colors.onInk} style={{ marginTop: 4, lineHeight: 20 }}>
            Let people send you dollars without the whole of Monad seeing they’re yours. Your wallet
            makes your private keys with one signature, and they stay on this phone.
          </Txt>
          <View style={{ marginTop: 14 }}>
            <PillButton
              label={p.working ? 'Setting up…' : 'Set up'}
              icon="face"
              tone="white"
              loading={p.working}
              onPress={() => void p.setUp()}
            />
          </View>
        </View>
      ) : waiting.length || p.progress ? (
        <View>
          <View style={[styles.amountRow, lead]}>
            <Txt
              weight="bold"
              size={44}
              color={colors.white}
              style={[styles.amount, { marginTop: 0 }]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {formatUsd(p.waiting)}
            </Txt>
            <View style={styles.inBalance}>
              <Icon name="check" size={12} color={colors.ink} strokeWidth={2.6} />
              <Txt weight="semi" size={12}>
                In your balance
              </Txt>
            </View>
          </View>
          <Txt size={15} color={colors.onInk} style={{ lineHeight: 21 }}>
            Only you can tell these are yours. Pay and send with them like any dollars: Kova keeps
            them private.
          </Txt>
          <View style={styles.chips}>
            {senders.slice(0, 2).map((s) => (
              <View key={s.key} style={styles.fromChip}>
                <Txt weight="semi" size={12} color={colors.onInk}>
                  From{' '}
                </Txt>
                <Txt weight="semi" size={12} color={colors.white} numberOfLines={1}>
                  {s.label}
                </Txt>
              </View>
            ))}
            {senders.length > 2 ? (
              <AddressChip label={`+${senders.length - 2} more`} onInk />
            ) : null}
          </View>
          {p.progress ? (
            <View style={styles.making}>
              <Icon name="clock" size={15} color={colors.onInk} />
              <Txt weight="medium" size={13} color={colors.onInk}>
                {progressLabel(p.progress)}
              </Txt>
            </View>
          ) : moved?.count ? (
            <Txt weight="medium" size={13} color={colors.tealLight} style={{ marginTop: 12 }}>
              Made {formatUsd(moved.amount)} public in {(moved.ms / 1000).toFixed(1)} s.{' '}
              {moved.failed ? `${moved.failed} didn’t move: ${moved.reason}` : ''}
            </Txt>
          ) : moved?.failed ? (
            <View style={styles.problem}>
              <Icon name="info" size={16} color={colors.coralSoft} />
              <Txt
                weight="medium"
                size={13}
                color={colors.coralSoft}
                style={{ flex: 1, lineHeight: 18 }}
              >
                {moved.reason}
              </Txt>
            </View>
          ) : null}
        </View>
      ) : (
        <View>
          <Txt weight="bold" size={44} color={colors.white} style={[styles.amount, lead]}>
            {formatUsd(0n)}
          </Txt>
          <Txt size={15} color={colors.onInk} style={{ lineHeight: 21 }}>
            {p.published === false
              ? 'Your keys are on this phone. Kova hasn’t got their public half yet; it tries again by itself.'
              : 'When someone sends you dollars privately, they land in your balance, and only you can tell they’re yours.'}
          </Txt>
          <View style={styles.chips}>
            <AddressChip label="Next payment" onInk pending />
            <AddressChip label="The one after" onInk pending />
          </View>
        </View>
      )}

      {p.problem && p.problem.during !== 'spend' ? (
        <View style={styles.problem}>
          <Icon name="info" size={16} color={colors.coralSoft} />
          <Txt weight="medium" size={13} color={colors.coralSoft} style={{ flex: 1 }}>
            {p.problem.text}
          </Txt>
        </View>
      ) : null}
    </Animated.View>
  )
}

/** One private payment: who sent it, their note, and whether it's still private, spent, or made public. */
export function PrivateRow({ receipt, last }: { receipt: PrivateReceipt; last?: boolean }) {
  const { activity } = useWallet()
  const senderName = useSenderName()
  const name = senderName(receipt.from, receipt.senderName)
  const waiting = BigInt(receipt.held) > 0n
  const unconfirmed = receipt.proven === 'claimed'
  const entry = activity.find(
    (e) => e.kind === 'received' && e.txHash?.toLowerCase() === receipt.txHash.toLowerCase(),
  )
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${formatUsd(BigInt(receipt.amount))} from ${name}, privately. ${waiting ? 'Private, in your balance' : receipt.movedTx ? 'Made public' : 'Spent privately'}`}
      onPress={() =>
        entry
          ? router.push({ pathname: '/receipt/[id]', params: { id: entry.id } })
          : void WebBrowser.openBrowserAsync(receipt.explorerUrl)
      }
      style={({ pressed }) => [styles.row, !last && styles.rowRule, pressed && { opacity: 0.65 }]}
    >
      <PrivateAvatar name={name} id={receipt.from ?? receipt.stealthAddress} size={40} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt weight="semi" size={16} numberOfLines={1}>
          {name}
        </Txt>
        <Txt size={13} color={colors.muted} numberOfLines={1}>
          {unconfirmed ? 'Unconfirmed sender · ' : ''}
          {receipt.note ? `“${receipt.note}”, ` : ''}
          {when(receipt.at)}
        </Txt>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 3 }}>
        <Txt weight="semi" size={16} color={colors.positive}>
          {formatUsd(BigInt(receipt.amount), { sign: true })}
        </Txt>
        <Txt weight="semi" size={12} color={colors.muted}>
          {waiting
            ? BigInt(receipt.held) < BigInt(receipt.amount)
              ? `${formatUsd(BigInt(receipt.held))} left`
              : 'Private'
            : receipt.movedTx
              ? 'Made public'
              : 'Spent'}
        </Txt>
      </View>
    </Pressable>
  )
}

/**
 * How it stays private: someone pays an address made for that payment alone, and it's yours to
 * move in. Drawn with the real sender and address when there's a payment to show.
 */
export function PrivateFlow({ receipt }: { receipt?: PrivateReceipt }) {
  const senderName = useSenderName()
  const from = receipt ? senderName(receipt.from, receipt.senderName) : 'Someone'
  return (
    <View
      style={styles.flow}
      accessible
      accessibilityLabel="Someone pays an address made for that payment alone, which only your keys can open"
    >
      <View style={styles.flowEnd}>
        <Avatar name={from} id={receipt?.from ?? undefined} size={40} />
        <Txt
          weight="semi"
          size={12}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
          style={{ maxWidth: 84 }}
        >
          {from}
        </Txt>
      </View>
      <View style={styles.flowLine} />
      <View style={styles.flowMiddle}>
        <AddressChip
          address={receipt?.stealthAddress}
          label={receipt ? undefined : 'its own address'}
          pending={!receipt}
        />
        <Txt size={11} color={colors.muted}>
          Public on Monad
        </Txt>
      </View>
      <View style={styles.flowLine} />
      <View style={styles.flowEnd}>
        <View style={styles.flowYou}>
          <Icon name="lock" size={18} color={colors.white} strokeWidth={2.3} />
        </View>
        <Txt weight="semi" size={12}>
          Only you
        </Txt>
      </View>
    </View>
  )
}

/** Whether anyone can send to this wallet privately, and the one tap that makes it so. */
export function ReceivingCard() {
  const p = usePrivate()
  const on = p.keysHere && p.published === true
  return (
    <View style={styles.receiving}>
      <View style={styles.receivingTop}>
        <View
          style={[styles.receivingIcon, { backgroundColor: on ? colors.tealSoft : colors.sunken }]}
        >
          <Icon name="lock" size={19} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt weight="semi" size={16}>
            {on
              ? 'Anyone can send to you privately'
              : p.keysHere
                ? 'Almost ready'
                : 'Not set up on this phone'}
          </Txt>
          <Txt size={13} color={colors.muted} style={{ lineHeight: 18 }}>
            {on
              ? 'Kova has your private key, signed by your wallet, so senders can check it’s really yours.'
              : p.keysHere
                ? 'Your keys are on this phone. Kova gets their public half as soon as it can be reached.'
                : 'Your wallet makes your private keys with one signature. They never leave this phone.'}
          </Txt>
        </View>
      </View>
      {p.keysHere ? null : (
        <View style={{ marginTop: 12 }}>
          <PillButton
            label={p.working ? 'Setting up…' : 'Set up'}
            icon="face"
            loading={p.working}
            onPress={() => void p.setUp()}
          />
        </View>
      )}
    </View>
  )
}

/**
 * Send privately, on the review step: off by default, remembered once chosen. On, the card turns
 * ink and says exactly what Monad will and won't show.
 */
export function SendPrivately({
  on,
  onChange,
  amount,
  first,
  disabled,
  fromPrivate,
}: {
  on: boolean
  onChange: (on: boolean) => void
  amount: bigint
  first: string
  disabled?: boolean
  /** Paid from private dollars, so Monad doesn't show who sent it either. */
  fromPrivate?: boolean
}) {
  const said = fromPrivate
    ? `On Monad, people will see ${formatUsd(amount)} move, but not who sent it or to whom.`
    : `On Monad, people will see you sent ${formatUsd(amount)}, but not to whom.`
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: on, disabled: !!disabled }}
      accessibilityLabel={`Send privately. ${on ? `On. ${said}` : 'Off.'}`}
      disabled={disabled}
      onPress={() => {
        void Haptics.selectionAsync()
        onChange(!on)
      }}
      style={[styles.send, on && styles.sendOn]}
    >
      <View style={[styles.sendLock, { backgroundColor: on ? colors.coral : colors.sunken }]}>
        <Icon name="lock" size={16} color={on ? colors.white : colors.ink} strokeWidth={2.4} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt weight="semi" size={15} color={on ? colors.white : colors.ink}>
          Send privately
        </Txt>
        <Txt size={12} color={on ? colors.onInk : colors.muted} style={{ lineHeight: 16 }}>
          {on ? said : `Hide who gets it from everyone but ${first}.`}
        </Txt>
      </View>
      <Switch
        value={on}
        disabled={disabled}
        onValueChange={(next) => {
          void Haptics.selectionAsync()
          onChange(next)
        }}
        trackColor={{ true: colors.teal, false: colors.sunken }}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
    </Pressable>
  )
}

/** Where a private send went, in the sheet's Sent step and on its receipt: the one-time address, not them. */
export function SentPrivately({
  amount,
  oneTime,
  first,
  txHash,
  at,
  fromPrivate,
}: {
  amount: bigint
  oneTime: string
  first: string
  txHash?: string
  at: number
  fromPrivate?: boolean
}) {
  const p = usePrivate()
  return (
    <View style={styles.sent}>
      <View style={styles.sentTag}>
        <Icon name="lock" size={13} color={colors.white} strokeWidth={2.4} />
        <Txt weight="semi" size={12} color={colors.white}>
          Sent privately
        </Txt>
      </View>
      <Txt size={14} color={colors.onTint} style={{ lineHeight: 20, marginTop: 8 }}>
        On Monad, {formatUsd(amount)} went to{' '}
        <Txt weight="semi" size={14}>
          {shortAddress(oneTime)}
        </Txt>
        , an address made for this payment alone. Only {first} can open it.
        {fromPrivate
          ? ' It came from your private dollars, so your wallet doesn’t show either.'
          : ''}
      </Txt>
      <View style={{ marginTop: 8 }}>
        <Announced url={p.announcementAt(oneTime)} at={at} />
      </View>
      {txHash ? (
        <Pressable
          accessibilityRole="link"
          onPress={() => void WebBrowser.openBrowserAsync(explorerTx(txHash))}
          hitSlop={8}
          style={styles.sentLink}
        >
          <Icon name="web" size={15} />
          <Txt weight="semi" size={14} style={{ textDecorationLine: 'underline' }}>
            See it on Monadscan
          </Txt>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { borderRadius: 28, backgroundColor: colors.ink, padding: 18, overflow: 'hidden' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  lockDisc: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.coral,
    alignItems: 'center',
    justifyContent: 'center',
  },
  amount: { marginTop: 12, letterSpacing: -1.6, lineHeight: 50 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  fromChip: {
    height: 28,
    maxWidth: 170,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.28)',
    flexDirection: 'row',
    alignItems: 'center',
  },
  foot: { textAlign: 'center', marginTop: 10, lineHeight: 17 },
  movedTag: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 26,
    paddingHorizontal: 10,
    marginTop: 14,
    borderRadius: 13,
    backgroundColor: colors.tealSoft,
  },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  ghost: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.4)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  doneButton: {
    height: 44,
    paddingHorizontal: 22,
    borderRadius: 22,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  problem: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginTop: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  rowRule: { borderBottomWidth: 1, borderColor: colors.sunken },
  flow: { flexDirection: 'row', alignItems: 'flex-start' },
  flowEnd: { alignItems: 'center', gap: 5, width: 84 },
  flowMiddle: { alignItems: 'center', gap: 5, paddingTop: 6 },
  flowLine: { flex: 1, height: 2, marginTop: 20, backgroundColor: colors.ink, minWidth: 8 },
  flowYou: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  receiving: {
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    padding: 14,
  },
  receivingTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  receivingIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  offer: {
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    padding: 12,
    gap: 10,
  },
  offerTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  offerLock: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  send: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    paddingVertical: 10,
    paddingLeft: 12,
    paddingRight: 10,
  },
  sendOn: { backgroundColor: colors.ink },
  sendLock: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sent: {
    alignSelf: 'stretch',
    borderRadius: 20,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    padding: 14,
  },
  sentTag: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 26,
    paddingHorizontal: 10,
    borderRadius: 13,
    backgroundColor: colors.ink,
  },
  sentLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  announced: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  payFrom: {
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    padding: 12,
    marginTop: 8,
  },
  details: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  calm: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, paddingHorizontal: 4 },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 12,
  },
  inBalance: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 26,
    paddingHorizontal: 10,
    borderRadius: 13,
    backgroundColor: colors.tealSoft,
  },
  making: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 14 },
  option: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.paper,
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 2,
  },
  optionOn: { backgroundColor: colors.ink },
  optionTop: { flexDirection: 'row', alignItems: 'center', gap: 5 },
})
