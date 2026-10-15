import * as Haptics from 'expo-haptics'
import * as WebBrowser from 'expo-web-browser'
import { ActivityIndicator, Pressable, Share, StyleSheet, View } from 'react-native'
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated'
import { isAddressEqual } from 'viem'
import { formatUsd } from '@/lib/money'
import { useTakings } from '@/lib/takings'
import { type MoveProgress, type PrivateSale, shortAddress } from '@/lib/takings-core'
import { colors } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Kovi } from './art'
import { when } from './EntryRow'
import { Icon } from './Icon'
import { PopIn } from './motion'
import { PillButton, Txt } from './primitives'

/**
 * Private takings, drawn: every sale at its own one-time address, shown by its short form
 * (0x067D…20a2) so you can see no two sales share one, and the one tap that brings them home.
 * The card is ink, like the shop's pass: what's in it is the shop's alone.
 */

/** Where moves land, in words: "your wallet", or the shop's own when it settles elsewhere. */
export function useHome() {
  const { settlesTo } = useTakings()
  const { profile } = useWallet()
  const yours = !settlesTo || (profile !== null && isAddressEqual(settlesTo, profile.address))
  return yours
    ? { short: 'wallet', long: 'your wallet' }
    : { short: 'shop wallet', long: `the shop’s wallet, ${shortAddress(settlesTo)}` }
}

/** The last move, while it's still news: ten minutes, or until it's put away. */
export const freshMove = <T extends { at: number }>(moved: T | null) =>
  moved && Date.now() - moved.at < 10 * 60_000 ? moved : null

const progressLabel = (p: MoveProgress, home: string) =>
  p.step === 'unlocking'
    ? 'Waiting for Face ID…'
    : p.step === 'checking'
      ? 'Checking each address…'
      : p.step === 'signing'
        ? `Signing ${p.done} of ${p.total}…`
        : `Moving to ${home}…`

/** A small "Private" tag with a padlock. */
export function PrivateBadge() {
  return (
    <View style={styles.badge}>
      <Icon name="lock" size={11} strokeWidth={2.4} />
      <Txt weight="semi" size={11}>
        Private
      </Txt>
    </View>
  )
}

/** A one-time address, shortened. Dashed when it doesn't exist yet. */
export function AddressChip({
  address,
  label,
  onInk,
  pending,
}: {
  address?: string
  label?: string
  onInk?: boolean
  pending?: boolean
}) {
  return (
    <View
      style={[
        styles.chip,
        onInk ? styles.chipInk : styles.chipPaper,
        pending && styles.chipPending,
      ]}
    >
      <Txt weight="semi" size={12} color={onInk ? colors.onInk : colors.onTint}>
        {label ?? (address ? shortAddress(address) : '')}
      </Txt>
    </View>
  )
}

/** Whether new sales are private: a pill, for the ink card or the paper around it. */
export function TakingsState({ onInk }: { onInk?: boolean }) {
  const { enabled } = useTakings()
  return (
    <View
      style={[
        styles.state,
        {
          backgroundColor: enabled
            ? colors.tealSoft
            : onInk
              ? 'rgba(255,255,255,0.14)'
              : colors.sunken,
        },
      ]}
      accessibilityLabel={enabled ? 'Private takings are on' : 'Private takings are off'}
    >
      <View
        style={[
          styles.stateDot,
          { backgroundColor: enabled ? colors.teal : onInk ? colors.onInk : colors.muted },
        ]}
      />
      <Txt weight="semi" size={12} color={enabled || !onInk ? colors.ink : colors.onInk}>
        {enabled ? 'On' : 'Off'}
      </Txt>
    </View>
  )
}

/**
 * The shop's private takings at a glance: what waits at one-time addresses, and Move to wallet.
 * It tells every state in place: keys still to open on this phone, nothing yet, moving (with
 * Face ID, then each signature), and moved, with how long it took and the move on Monadscan.
 */
export function TakingsCard({
  onOpen,
  plain,
}: {
  /** Opens every private sale, from the card's title row. */
  onOpen?: () => void
  /** Without its title row, on the screen that's titled already. */
  plain?: boolean
}) {
  const t = useTakings()
  const home = useHome()
  const waiting = t.sales.filter((s) => !s.moved)
  const moved = freshMove(t.moved)
  const done = moved !== null && !t.progress && waiting.length === 0
  const needsKeys = !t.keysHere && (t.enabled || t.unopened > 0)
  const lead = plain ? { marginTop: 0 } : null

  return (
    <Animated.View layout={LinearTransition} style={styles.card}>
      {plain ? null : (
        <Pressable
          accessibilityRole={onOpen ? 'button' : undefined}
          accessibilityLabel={onOpen ? 'Private takings. See every private sale' : undefined}
          disabled={!onOpen}
          onPress={onOpen}
          style={styles.cardHead}
        >
          <View style={styles.lockDisc}>
            <Icon name="lock" size={17} color={colors.white} strokeWidth={2.3} />
          </View>
          <Txt weight="semi" size={15} color={colors.white} style={{ flex: 1 }}>
            Private takings
          </Txt>
          <TakingsState onInk />
          {onOpen ? <Icon name="arrow" size={18} color={colors.onInk} /> : null}
        </Pressable>
      )}

      {done && moved ? (
        <Animated.View entering={FadeIn.duration(260)}>
          <PopIn style={[styles.movedTag, lead]}>
            <Icon name="check" size={13} color={colors.ink} strokeWidth={2.6} />
            <Txt weight="semi" size={12}>
              {moved.count ? 'Moved' : 'Nothing to move'}
            </Txt>
          </PopIn>
          {moved.count ? (
            <>
              <Txt
                weight="bold"
                size={44}
                color={colors.white}
                style={styles.amount}
                accessibilityLabel={`Moved ${formatUsd(moved.amount)} to ${home.long} in ${(moved.ms / 1000).toFixed(1)} seconds`}
              >
                {formatUsd(moved.amount)}
              </Txt>
              <Txt size={15} color={colors.onInk}>
                to {home.long} in {(moved.ms / 1000).toFixed(1)} s, from {moved.count}{' '}
                {moved.count === 1 ? 'address' : 'addresses'}
              </Txt>
            </>
          ) : (
            <Txt size={15} color={colors.onInk} style={{ marginTop: 10, lineHeight: 21 }}>
              Those addresses were already empty. Everything there had been moved.
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
              onPress={t.clearMoved}
              style={({ pressed }) => [styles.doneButton, pressed && { opacity: 0.8 }]}
            >
              <Txt weight="semi" size={14}>
                Done
              </Txt>
            </Pressable>
          </View>
        </Animated.View>
      ) : needsKeys ? (
        <View>
          <Txt
            weight="bold"
            size={24}
            color={colors.white}
            style={[{ marginTop: 14, letterSpacing: -0.6 }, lead]}
          >
            {t.unopened
              ? `${t.unopened} private ${t.unopened === 1 ? 'sale' : 'sales'} to open`
              : 'Keys not on this phone'}
          </Txt>
          <Txt size={14} color={colors.onInk} style={{ marginTop: 4, lineHeight: 20 }}>
            Only your shop’s keys can find its private sales and move them. Your wallet makes them
            again with one signature, and they stay on this phone.
          </Txt>
          <View style={{ marginTop: 14 }}>
            <PillButton
              label={t.working === 'open' ? 'Opening…' : 'Open private takings'}
              icon="face"
              tone="white"
              loading={t.working === 'open'}
              onPress={() => void t.openHere()}
            />
          </View>
        </View>
      ) : waiting.length || t.progress ? (
        <View>
          <Txt
            weight="bold"
            size={44}
            color={colors.white}
            style={[styles.amount, lead]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {formatUsd(t.waiting)}
          </Txt>
          <Txt size={15} color={colors.onInk}>
            waiting at {t.waitingCount} one-time {t.waitingCount === 1 ? 'address' : 'addresses'}
          </Txt>
          <View style={styles.chips}>
            {waiting.slice(0, 2).map((s) => (
              <AddressChip key={s.stealth_address} address={s.stealth_address} onInk />
            ))}
            {waiting.length > 2 ? (
              <AddressChip label={`+${waiting.length - 2} more`} onInk />
            ) : null}
          </View>
          {moved?.count ? (
            <Txt weight="medium" size={13} color={colors.tealLight} style={{ marginTop: 12 }}>
              Moved {formatUsd(moved.amount)} in {(moved.ms / 1000).toFixed(1)} s.{' '}
              {moved.failed ? `${moved.failed} didn’t: ${moved.reason}` : ''}
            </Txt>
          ) : null}
          <View style={{ marginTop: 16 }}>
            <PillButton
              label={t.progress ? progressLabel(t.progress, home.long) : `Move to ${home.short}`}
              icon="receive"
              tone="white"
              loading={Boolean(t.progress)}
              onPress={() => void t.move()}
            />
          </View>
          <Txt size={12} color={colors.onInk} style={styles.foot}>
            Kova pays the gas. Each address signs its own move.
          </Txt>
        </View>
      ) : (
        <View>
          <Txt weight="bold" size={44} color={colors.white} style={[styles.amount, lead]}>
            {formatUsd(0n)}
          </Txt>
          <Txt size={15} color={colors.onInk} style={{ lineHeight: 21 }}>
            {!t.enabled
              ? 'Nothing waiting. Turn private takings on in Shop.'
              : t.otherKeys
                ? 'Nothing waiting that this phone can open.'
                : 'Your next sale goes to its own address, made for that sale alone.'}
          </Txt>
          {t.enabled && !t.otherKeys ? (
            <View style={styles.chips}>
              <AddressChip label="Next sale" onInk pending />
              <AddressChip label="The one after" onInk pending />
            </View>
          ) : null}
        </View>
      )}

      {t.enabled && t.otherKeys && !t.progress ? (
        // Kova pays new sales through a meta-address this phone's keys didn't make (another wallet
        // turned it on): those sales would never show here, so say so, and offer this phone's keys.
        <View style={styles.other}>
          <Txt weight="medium" size={13} color={colors.white} style={{ lineHeight: 18 }}>
            New sales are going to keys this phone doesn’t hold, so it can’t see them. Use this
            phone’s keys for sales from now on.
          </Txt>
          <Pressable
            accessibilityRole="button"
            disabled={t.working !== null}
            onPress={() => void t.turnOn()}
            style={({ pressed }) => [styles.otherButton, pressed && { opacity: 0.8 }]}
          >
            {t.working === 'on' ? (
              <ActivityIndicator size="small" color={colors.ink} />
            ) : (
              <Icon name="lock" size={14} strokeWidth={2.4} />
            )}
            <Txt weight="semi" size={13}>
              Use this phone’s keys
            </Txt>
          </Pressable>
        </View>
      ) : null}

      {t.problem &&
      (t.problem.during === 'move' ||
        t.problem.during === 'open' ||
        (t.problem.during === 'on' && t.otherKeys)) ? (
        <View style={styles.problem}>
          <Icon name="info" size={16} color={colors.coralSoft} />
          <Txt weight="medium" size={13} color={colors.coralSoft} style={{ flex: 1 }}>
            {t.problem.text}
          </Txt>
        </View>
      ) : null}
    </Animated.View>
  )
}

/** Private takings are off and nothing waits: what they are, and one tap to turn them on. */
export function TakingsInvite() {
  const t = useTakings()
  return (
    <View style={styles.invite}>
      <View style={styles.inviteTop}>
        <View style={{ flex: 1 }}>
          <Txt weight="bold" size={18} style={{ letterSpacing: -0.3 }}>
            Keep your takings private
          </Txt>
          <Txt size={14} color={colors.muted} style={{ marginTop: 4, lineHeight: 20 }}>
            Every sale goes to its own address that only your shop can open. Nobody on Monad can add
            up your takings.
          </Txt>
        </View>
        <Kovi pose="key" size={74} />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Turn on private takings"
        disabled={t.working !== null}
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
          void t.turnOn()
        }}
        style={({ pressed }) => [styles.inviteButton, pressed && { transform: [{ scale: 0.97 }] }]}
      >
        {t.working === 'on' ? (
          <ActivityIndicator color={colors.white} size="small" />
        ) : (
          <Icon name="lock" size={16} color={colors.white} />
        )}
        <Txt weight="semi" size={15} color={colors.white}>
          {t.working === 'on' ? 'Turning on…' : 'Turn on'}
        </Txt>
      </Pressable>
      {t.problem?.during === 'on' ? (
        <Txt weight="medium" size={13} color={colors.danger} style={{ marginTop: 8 }}>
          {t.problem.text}
        </Txt>
      ) : null}
    </View>
  )
}

/** One private sale: what it was, the address it alone was paid to, and whether it's home yet. */
export function PrivateSaleRow({ sale, last }: { sale: PrivateSale; last?: boolean }) {
  const home = useHome()
  const at = sale.paid_at ? Date.parse(sale.paid_at) : null
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${formatUsd(sale.base)} private sale to ${shortAddress(sale.stealth_address)}, ${sale.moved ? `in ${home.long}` : 'waiting'}. View on Monadscan`}
      onPress={() => void WebBrowser.openBrowserAsync(sale.explorer_url)}
      style={({ pressed }) => [styles.sale, !last && styles.saleRule, pressed && { opacity: 0.65 }]}
    >
      <View
        style={[
          styles.saleIcon,
          { backgroundColor: sale.moved ? colors.tealSoft : colors.coralSoft },
        ]}
      >
        <Icon name={sale.moved ? 'check' : 'lock'} size={17} strokeWidth={2.3} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={styles.saleTop}>
          <Txt weight="semi" size={16}>
            {formatUsd(sale.base)}
          </Txt>
          <PrivateBadge />
        </View>
        <Txt size={13} color={colors.muted} numberOfLines={1}>
          {shortAddress(sale.stealth_address)}
          {at ? `, ${when(at)}` : ''}
        </Txt>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Txt weight="semi" size={13} color={sale.moved ? colors.positive : colors.coralDeep}>
          {sale.moved ? 'Moved' : 'Waiting'}
        </Txt>
        <Icon name="web" size={15} color={colors.muted} />
      </View>
    </Pressable>
  )
}

/** The message an accountant receives with the link. */
export const booksMessage = (shopName: string, link: string) =>
  `Books for ${shopName.trim() || 'my shop'} on Kova. It’s read-only: it shows every sale and can’t move money. ${link}`

/**
 * The accountant's view: a read-only page of every private sale, made from the viewing key. It can
 * find every sale and move none of them, and that's said plainly before it's shared.
 */
export function AccountantCard({ shopName }: { shopName: string }) {
  const t = useTakings()
  const link = t.booksLink(shopName)
  return (
    <View style={styles.books}>
      <View style={styles.booksTop}>
        <View style={styles.booksIcon}>
          <Icon name="eye" size={20} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt weight="semi" size={16}>
            An accountant view
          </Txt>
          <Txt size={13} color={colors.muted} style={{ lineHeight: 18 }}>
            A page with every private sale, for whoever does your books.
          </Txt>
        </View>
      </View>
      <View style={styles.booksNote}>
        <Icon name="info" size={16} color={colors.onTint} />
        <Txt weight="medium" size={13} color={colors.onTint} style={{ flex: 1, lineHeight: 18 }}>
          Shows every sale. Can’t move money. Share it only with your accountant.
        </Txt>
      </View>
      <View style={{ marginTop: 12 }}>
        <PillButton
          label="Share an accountant view"
          icon="share"
          disabled={!link}
          onPress={() => {
            if (link) void Share.share({ message: booksMessage(shopName, link) })
          }}
        />
      </View>
      {link ? null : (
        <Txt size={12} color={colors.muted} style={{ marginTop: 8, textAlign: 'center' }}>
          Open private takings on this phone first.
        </Txt>
      )}
    </View>
  )
}

/**
 * How it stays private, with the shop's own sales when there are some: each one into an address
 * of its own, all of them home to one wallet that nobody can tie back to them.
 */
export function SalesFlow({ sales }: { sales: PrivateSale[] }) {
  const home = useHome()
  const shown: { key: string; amount: string; address: string | null }[] = sales.length
    ? sales.slice(0, 3).map((s) => ({
        key: s.stealth_address,
        amount: formatUsd(s.base),
        address: s.stealth_address,
      }))
    : [
        { key: 'a', amount: 'Sale', address: null },
        { key: 'b', amount: 'Sale', address: null },
        { key: 'c', amount: 'Sale', address: null },
      ]
  return (
    <View
      style={styles.flow}
      accessible
      accessibilityLabel={`Each sale is paid to its own address, then moved to ${home.long}`}
    >
      <View style={{ flex: 1, gap: 8 }}>
        {shown.map((s) => (
          <View key={s.key} style={styles.flowRow}>
            <View style={styles.flowSale}>
              <Txt weight="semi" size={12} numberOfLines={1} adjustsFontSizeToFit>
                {s.amount}
              </Txt>
            </View>
            <View style={styles.flowDash} />
            <AddressChip
              address={s.address ?? undefined}
              label={s.address ? undefined : 'its own address'}
              pending={!s.address}
            />
            <View style={styles.flowReach} />
          </View>
        ))}
      </View>
      <View style={styles.bracket} />
      <View style={styles.flowArrow} />
      <View style={styles.flowWallet}>
        <Icon name="home" size={16} color={colors.white} />
        <Txt weight="semi" size={12} color={colors.white} style={{ textAlign: 'center' }}>
          {home.short === 'wallet' ? 'Your wallet' : 'Shop wallet'}
        </Txt>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 20,
    paddingHorizontal: 7,
    borderRadius: 10,
    backgroundColor: colors.sunken,
  },
  chip: {
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 14,
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  chipInk: { borderColor: 'rgba(255,255,255,0.28)' },
  chipPaper: { borderColor: colors.ink, backgroundColor: colors.surface },
  chipPending: { borderStyle: 'dashed' },
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
  state: {
    height: 26,
    paddingHorizontal: 10,
    borderRadius: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stateDot: { width: 7, height: 7, borderRadius: 4 },
  amount: { marginTop: 12, letterSpacing: -1.6, lineHeight: 50 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
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
  other: {
    marginTop: 14,
    padding: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(212,101,88,0.28)',
    gap: 10,
  },
  otherButton: {
    alignSelf: 'flex-start',
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 17,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  invite: {
    borderRadius: 26,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    padding: 16,
    paddingBottom: 14,
  },
  inviteTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  inviteButton: {
    marginTop: 12,
    alignSelf: 'flex-start',
    height: 42,
    paddingHorizontal: 18,
    borderRadius: 21,
    backgroundColor: colors.ink,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sale: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  saleRule: { borderBottomWidth: 1, borderColor: colors.sunken },
  saleIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saleTop: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  books: {
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    padding: 14,
  },
  booksTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  booksIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.tealSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  booksNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 12,
    padding: 10,
    borderRadius: 14,
    backgroundColor: colors.tealSoft,
  },
  flow: { flexDirection: 'row', alignItems: 'center' },
  flowRow: { flexDirection: 'row', alignItems: 'center' },
  flowSale: {
    width: 62,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.coralSoft,
    borderWidth: 1.5,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  flowDash: { width: 10, height: 2, backgroundColor: colors.ink },
  flowReach: { flex: 1, minWidth: 8, height: 2, backgroundColor: colors.ink },
  bracket: {
    width: 2,
    alignSelf: 'stretch',
    marginVertical: 13,
    borderRadius: 1,
    backgroundColor: colors.ink,
  },
  flowArrow: { width: 14, height: 2, backgroundColor: colors.ink },
  flowWallet: {
    width: 68,
    height: 64,
    borderRadius: 18,
    backgroundColor: colors.teal,
    borderWidth: 2,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 4,
  },
})
