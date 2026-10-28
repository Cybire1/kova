import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import { useState } from 'react'
import {
  type ColorValue,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native'
import { FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { Order, OrderStatus } from '@/lib/api'
import { useOrders } from '@/lib/orders'
import { useStall } from '@/lib/stall'
import { colors } from '@/lib/theme'
import Animated from '@/ui/animated'
import { Avatar, Kovi } from '@/ui/art'
import { Icon } from '@/ui/Icon'
import { Ping } from '@/ui/motion'
import { Txt } from '@/ui/primitives'
import { shopDockClearance } from '@/ui/ShopDock'
import { useWide } from '@/ui/ShopRail'
import { dollars } from '@/ui/StallParts'
import { WalletBack } from '@/ui/WalletBack'

type Filter = 'hand' | 'waiting' | 'done'

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
function ago(iso: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  return hours < 24
    ? `${hours} h ago`
    : new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' })
}

/**
 * What people ordered from the stall, as tickets. Paid ones wait at the top with the buyer's
 * name, what they chose and any note, until someone taps Handed over.
 */
export default function Orders() {
  const wide = useWide()
  return wide ? <Board /> : <OrderList />
}

const COLUMNS: {
  status: OrderStatus
  title: string
  next: OrderStatus
  action: string
  tone: ColorValue
}[] = [
  { status: 'new', title: 'New', next: 'preparing', action: 'Start', tone: colors.coral },
  { status: 'preparing', title: 'Preparing', next: 'ready', action: 'Ready', tone: colors.yellow },
  {
    status: 'ready',
    title: 'Ready',
    next: 'collected',
    action: 'Handed over',
    tone: colors.tealSoft,
  },
]

/**
 * The counter board on a wide screen: every paid order, online or at the counter, moving left to
 * right from New to Preparing to Ready, and off the board when it's handed over.
 */
function Board() {
  const insets = useSafeAreaInsets()
  const orders = useOrders()
  const waiting = orders.waiting.length
  return (
    <View style={{ flex: 1, backgroundColor: colors.paper, paddingTop: insets.top + 16 }}>
      <View
        style={{ flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 28, gap: 16 }}
      >
        <View style={{ flex: 1 }}>
          <Txt weight="bold" size={30} style={{ letterSpacing: -0.7 }}>
            Orders
          </Txt>
          <Txt size={14} color={colors.muted}>
            From your online shop and the counter, in one queue.
          </Txt>
        </View>
        {waiting ? (
          <View style={styles.waitChip}>
            <View style={styles.waitDot} />
            <Txt weight="semi" size={13}>
              {waiting} waiting for payment
            </Txt>
          </View>
        ) : null}
      </View>
      <View style={{ flex: 1, flexDirection: 'row', gap: 16, padding: 20 }}>
        {COLUMNS.map((col) => {
          const list = orders.toHand.filter((o) => (o.status ?? 'new') === col.status)
          return (
            <View key={col.status} style={styles.column}>
              <View style={styles.columnHead}>
                <View style={[styles.columnDot, { backgroundColor: col.tone }]} />
                <Txt weight="bold" size={18} style={{ flex: 1 }}>
                  {col.title}
                </Txt>
                <Txt weight="bold" size={16} color={colors.muted}>
                  {list.length}
                </Txt>
              </View>
              <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: insets.bottom + 20 }}>
                {list.map((order) => (
                  <Animated.View
                    key={order.id}
                    entering={FadeInDown}
                    exiting={FadeOut}
                    layout={LinearTransition}
                  >
                    <Ticket
                      order={order}
                      action={col.action}
                      onHandOver={() => void orders.advance(order, col.next)}
                    />
                  </Animated.View>
                ))}
                {list.length === 0 ? (
                  <Txt
                    size={14}
                    color={colors.muted}
                    style={{ textAlign: 'center', paddingVertical: 24 }}
                  >
                    {col.status === 'new' ? 'New orders land here.' : 'Nothing here.'}
                  </Txt>
                ) : null}
              </ScrollView>
            </View>
          )
        })}
      </View>
    </View>
  )
}

function OrderList() {
  const insets = useSafeAreaInsets()
  const orders = useOrders()
  const { owned } = useStall()
  const [filter, setFilter] = useState<Filter>('hand')
  const [refreshing, setRefreshing] = useState(false)

  const lists: Record<Filter, Order[]> = {
    hand: orders.toHand,
    waiting: orders.waiting,
    done: orders.done,
  }
  const shown = lists[filter]
  const tabs: { id: Filter; label: string; count?: number }[] = [
    { id: 'hand', label: 'To hand over', count: orders.toHand.length },
    { id: 'waiting', label: 'Waiting', count: orders.waiting.length },
    { id: 'done', label: 'Done' },
  ]

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.paper }}
      contentContainerStyle={{
        paddingTop: insets.top + 8,
        paddingHorizontal: 20,
        paddingBottom: shopDockClearance + insets.bottom,
      }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true)
            await orders.refresh()
            setRefreshing(false)
          }}
        />
      }
    >
      <View style={{ marginBottom: 10 }}>
        <WalletBack />
      </View>
      <View style={styles.titleRow}>
        <Txt weight="bold" size={32} style={{ letterSpacing: -1 }}>
          Orders
        </Txt>
        <View style={styles.live} accessibilityLabel="Updating live">
          <View style={styles.liveDot}>
            <Ping size={10} color={colors.teal} />
          </View>
          <Txt weight="semi" size={13} color={colors.onTint}>
            Live
          </Txt>
        </View>
      </View>

      <View style={styles.filters} accessibilityRole="tablist">
        {tabs.map((t) => {
          const on = t.id === filter
          return (
            <Pressable
              key={t.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              onPress={() => {
                void Haptics.selectionAsync()
                setFilter(t.id)
              }}
              style={[styles.filter, on && styles.filterOn]}
            >
              <Txt weight="semi" size={14} color={on ? colors.onChosen : colors.ink}>
                {t.label}
              </Txt>
              {t.count ? (
                <View
                  style={[
                    styles.filterCount,
                    { backgroundColor: on ? colors.coral : colors.sunken },
                  ]}
                >
                  <Txt weight="bold" size={12} color={colors.ink}>
                    {t.count}
                  </Txt>
                </View>
              ) : null}
            </Pressable>
          )
        })}
      </View>

      {orders.ready && shown.length === 0 ? (
        <Empty filter={filter} owner={Boolean(owned)} />
      ) : (
        shown.map((order) => (
          <Animated.View
            key={order.id}
            entering={FadeInDown.springify().damping(18)}
            exiting={FadeOut.duration(180)}
            layout={LinearTransition.springify().damping(18)}
          >
            {filter === 'done' ? (
              <DoneRow order={order} onUndo={() => void orders.collect(order, false)} />
            ) : filter === 'hand' ? (
              // One step at a time on a phone: Ready tells the buyer's phone, Handed over clears it.
              <Ticket
                order={order}
                action={order.status === 'ready' ? 'Handed over' : 'Ready'}
                onHandOver={() =>
                  void orders.advance(order, order.status === 'ready' ? 'collected' : 'ready')
                }
                stage
              />
            ) : (
              <Ticket order={order} />
            )}
          </Animated.View>
        ))
      )}
    </ScrollView>
  )
}

/** One order, as the kitchen reads it: who, what, any note, and one big button. */
function Ticket({
  order,
  onHandOver,
  action,
  stage,
}: {
  order: Order
  onHandOver?: () => void
  action?: string
  stage?: boolean
}) {
  const who = order.customer_name ?? 'Someone'
  const waiting = !onHandOver
  const ready = order.status === 'ready'
  return (
    <View style={styles.ticket}>
      <View style={styles.ticketTop}>
        <Avatar name={who} size={46} />
        <View style={{ flex: 1 }}>
          <Txt weight="bold" size={20} numberOfLines={1} style={{ letterSpacing: -0.4 }}>
            {who}
          </Txt>
          <Txt size={13} color={colors.muted} numberOfLines={1}>
            {order.stall ? `${order.stall.name}, ` : ''}
            {ago(order.paid_at ?? order.created_at)}
          </Txt>
        </View>
        {order.table ? (
          <View style={styles.tableTag} accessibilityLabel={`Table ${order.table}`}>
            <Txt weight="semi" size={10} color={colors.white} style={{ letterSpacing: 0.5 }}>
              TABLE
            </Txt>
            <Txt
              weight="bold"
              size={order.table.length > 3 ? 13 : 20}
              color={colors.white}
              numberOfLines={1}
              style={{ lineHeight: 22 }}
            >
              {order.table}
            </Txt>
          </View>
        ) : (
          <Txt weight="semi" size={14} color={colors.muted}>
            {time(order.paid_at ?? order.created_at)}
          </Txt>
        )}
      </View>

      <View style={styles.tear} pointerEvents="none">
        <View style={[styles.notch, { left: -12 }]} />
        <View style={styles.perforation} />
        <View style={[styles.notch, { right: -12 }]} />
      </View>

      <View style={{ paddingHorizontal: 16, gap: 6 }}>
        {order.lines.map((l) => (
          <View key={l.item_id} style={styles.lineRow}>
            <View style={styles.qtyBox}>
              <Txt weight="bold" size={15}>
                {l.quantity}
              </Txt>
            </View>
            <Txt weight="semi" size={16} style={{ flex: 1 }} numberOfLines={2}>
              {l.name}
            </Txt>
            <Txt size={15} color={colors.muted}>
              {dollars(Number(l.unit_price) * l.quantity)}
            </Txt>
          </View>
        ))}
        {order.reward ? (
          <View style={styles.reward} accessibilityLabel={`Stamp card: ${order.reward.name} free`}>
            <Icon name="sparkle" size={15} />
            <Txt weight="semi" size={14} style={{ flex: 1 }} numberOfLines={1}>
              Stamp card: {order.reward.name} free
            </Txt>
            <Txt weight="semi" size={14} color={colors.onTint}>
              −{dollars(order.reward.amount)}
            </Txt>
          </View>
        ) : null}
        {order.note ? (
          order.flags?.includes('allergy') ? (
            <View
              style={[styles.note, styles.noteFlagged]}
              accessibilityLabel={`Allergy or diet: ${order.note}`}
            >
              <View style={styles.flag}>
                <Icon name="info" size={15} color={colors.white} strokeWidth={2.4} />
                <Txt weight="bold" size={12} color={colors.white}>
                  Allergy or diet
                </Txt>
              </View>
              <Txt weight="semi" size={16} style={{ lineHeight: 22 }}>
                {order.note}
              </Txt>
            </View>
          ) : (
            <View style={styles.note}>
              <Icon name="pen" size={16} />
              <Txt weight="medium" size={15} style={{ flex: 1, lineHeight: 21 }}>
                {order.note}
              </Txt>
            </View>
          )
        ) : null}
      </View>

      <View style={styles.ticketFoot}>
        <View style={{ flex: 1, gap: 2 }}>
          {stage ? (
            <View style={styles.stageRow}>
              <View
                style={[styles.stageDot, { backgroundColor: ready ? colors.teal : colors.coral }]}
              />
              <Txt
                weight="semi"
                size={13}
                color={ready ? colors.tealDeep : colors.onTint}
                numberOfLines={1}
              >
                {ready
                  ? order.table
                    ? `Ready, take it to table ${order.table}`
                    : 'Ready, they’ve been told'
                  : order.status === 'preparing'
                    ? 'Preparing'
                    : 'New'}
              </Txt>
            </View>
          ) : null}
          {order.pay_for_me ? (
            <Txt weight="semi" size={13} color={colors.tealDeep}>
              {waiting ? 'Sent to someone else to pay' : 'Paid by someone else'}
            </Txt>
          ) : null}
          <Txt weight="bold" size={20}>
            {dollars(order.amount ?? 0)}
          </Txt>
        </View>
        {onHandOver ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={action ? `${action}: ${who}` : `Handed over to ${who}`}
            onPress={() => {
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
              onHandOver()
            }}
            style={({ pressed }) => [styles.handOver, pressed && { transform: [{ scale: 0.96 }] }]}
          >
            <Txt weight="semi" size={15} color={colors.white}>
              {action ?? 'Handed over'}
            </Txt>
            <View
              style={[styles.handDisc, stage && !ready && { backgroundColor: colors.coralSoft }]}
            >
              <Icon name={stage && !ready ? 'bell' : 'check'} size={18} strokeWidth={2.6} />
            </View>
          </Pressable>
        ) : (
          <View style={styles.waitChip}>
            <View style={styles.waitDot} />
            <Txt weight="semi" size={13}>
              Waiting for payment
            </Txt>
          </View>
        )}
      </View>
    </View>
  )
}

function DoneRow({ order, onUndo }: { order: Order; onUndo: () => void }) {
  const who = order.customer_name ?? 'Someone'
  return (
    <View style={styles.done}>
      <Avatar name={who} size={40} />
      <View style={{ flex: 1 }}>
        <Txt weight="semi" size={15} numberOfLines={1}>
          {who}, {dollars(order.amount ?? 0)}
          {order.table ? (
            <Txt size={15} color={colors.muted}>{`, table ${order.table}`}</Txt>
          ) : null}
        </Txt>
        <Txt size={13} color={colors.muted} numberOfLines={1}>
          {order.lines
            .map((l) => (l.quantity > 1 ? `${l.quantity} × ${l.name}` : l.name))
            .join(', ')}
        </Txt>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Not handed over to ${who} yet`}
        hitSlop={10}
        onPress={onUndo}
      >
        <Txt weight="semi" size={14} style={{ textDecorationLine: 'underline' }}>
          Undo
        </Txt>
      </Pressable>
    </View>
  )
}

function Empty({ filter, owner }: { filter: Filter; owner: boolean }) {
  const copy = {
    hand: {
      title: 'Nothing to hand over',
      body: 'Paid orders from your stall land here with the buyer’s name, what they chose and any note.',
    },
    waiting: {
      title: 'No one is mid-order',
      body: 'Orders placed but not paid yet show here, including ones sent to someone else to pay.',
    },
    done: {
      title: 'Nothing handed over yet',
      body: 'Orders you mark as handed over today collect here.',
    },
  }[filter]
  return (
    <View style={styles.empty}>
      <Kovi pose={filter === 'hand' ? 'sleep' : 'wave'} size={130} />
      <Txt weight="semi" size={20} style={{ marginTop: 6 }}>
        {copy.title}
      </Txt>
      <Txt
        size={15}
        color={colors.muted}
        style={{ textAlign: 'center', marginTop: 4, lineHeight: 21 }}
      >
        {copy.body}
      </Txt>
      {owner && filter === 'hand' ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/terminal/share')}
          style={styles.emptyButton}
        >
          <Icon name="share" size={18} />
          <Txt weight="semi" size={15}>
            Share your stall
          </Txt>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  column: { flex: 1, backgroundColor: colors.sunken, borderRadius: 26, padding: 12 },
  columnHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 12,
  },
  columnDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: colors.line },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  live: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 15,
    backgroundColor: colors.surface,
  },
  liveDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.teal },
  filters: { flexDirection: 'row', gap: 8, marginTop: 14, marginBottom: 14 },
  filter: {
    height: 38,
    paddingHorizontal: 14,
    borderRadius: 19,
    borderWidth: 2,
    borderColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  filterOn: { backgroundColor: colors.chosen },
  filterCount: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ticket: {
    marginBottom: 14,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  ticketTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    paddingBottom: 10,
  },
  tear: { height: 22, justifyContent: 'center' },
  notch: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.paper,
    borderWidth: 2,
    borderColor: colors.line,
  },
  perforation: {
    marginHorizontal: 18,
    borderTopWidth: 2,
    borderColor: colors.sunken,
    borderStyle: 'dashed',
  },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  qtyBox: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: colors.tealSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
    padding: 12,
    borderRadius: 16,
    backgroundColor: colors.sunken,
  },
  /** Jev read an allergy or a diet in the note: it gets the pay colour and a label, so nobody misses it. */
  noteFlagged: {
    flexDirection: 'column',
    gap: 8,
    backgroundColor: colors.coralSoft,
    borderWidth: 2,
    borderColor: colors.coral,
  },
  flag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    height: 24,
    paddingHorizontal: 9,
    borderRadius: 12,
    backgroundColor: colors.coralDeep,
  },
  ticketFoot: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, paddingTop: 14 },
  handOver: {
    height: 52,
    paddingLeft: 18,
    paddingRight: 6,
    borderRadius: 26,
    backgroundColor: colors.fill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  handDisc: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.tealSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tableTag: {
    minWidth: 52,
    maxWidth: 110,
    height: 50,
    paddingHorizontal: 8,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.coral,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reward: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
    paddingHorizontal: 12,
    height: 38,
    borderRadius: 14,
    backgroundColor: colors.tealSoft,
  },
  stageRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stageDot: { width: 8, height: 8, borderRadius: 4 },
  waitChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 17,
    backgroundColor: colors.sunken,
  },
  waitDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.coral },
  done: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: colors.sunken,
  },
  empty: { alignItems: 'center', paddingTop: 30, paddingHorizontal: 12 },
  emptyButton: {
    marginTop: 16,
    height: 46,
    paddingHorizontal: 18,
    borderRadius: 23,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
})
