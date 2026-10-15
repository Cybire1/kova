import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native'
import { type Business, getBusiness, getTeamKeys, type TeamKey } from '@/lib/api'
import { monthName, usd } from '@/lib/business'
import { useShop } from '@/lib/shop'
import { useStall } from '@/lib/stall'
import { colors } from '@/lib/theme'
import { Kovi } from '@/ui/art'
import { Card, Problem } from '@/ui/Business'
import { Icon, type IconName } from '@/ui/Icon'
import { Header, Rise, Screen, Txt } from '@/ui/primitives'

/**
 * Kova for Business at a glance: what went out this month (payroll, privately, and suppliers),
 * what the team spent today, and the way into each.
 */
export default function BusinessHome() {
  const shop = useShop()
  const { owned } = useStall()
  const [summary, setSummary] = useState<Business | null>(null)
  const [team, setTeam] = useState<TeamKey[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      const b = await getBusiness()
      setSummary(b)
      setTeam((await getTeamKeys(b.owner_address ?? b.settlement_address)).data)
      setProblem(null)
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Kova didn’t answer. Try again.')
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      if (owned) void load()
    }, [owned, load]),
  )

  const payroll = Number(summary?.payroll.paid_this_month ?? 0)
  const suppliers = Number(summary?.suppliers.paid_this_month ?? 0)
  const teamToday = team.reduce((sum, k) => sum + Number(k.spent_today ?? 0), 0)

  return (
    <Screen edges={['top']}>
      <Header title="Business" subtitle={shop.name} />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.ink}
            onRefresh={async () => {
              setRefreshing(true)
              await load()
              setRefreshing(false)
            }}
          />
        }
      >
        {!owned ? (
          <View style={styles.empty}>
            <Kovi pose="key" size={130} />
            <Txt size={15} color={colors.muted} style={{ textAlign: 'center', lineHeight: 21 }}>
              Payroll and suppliers belong to the shop’s owner. Open them on the phone whose wallet
              owns {shop.name}.
            </Txt>
          </View>
        ) : !summary && !problem ? (
          <ActivityIndicator color={colors.ink} style={{ marginTop: 60 }} />
        ) : (
          <>
            <Problem text={problem} />
            <Rise>
              <View style={styles.hero}>
                <View style={{ flex: 1 }}>
                  <Txt weight="semi" size={15} color="#DCEBEA">
                    Paid out in {monthName()}
                  </Txt>
                  <Txt
                    weight="bold"
                    size={44}
                    color={colors.white}
                    style={{ letterSpacing: -1.5, marginTop: 2 }}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                  >
                    {usd(payroll + suppliers)}
                  </Txt>
                  <Txt size={14} color="#DCEBEA" style={{ marginTop: 6, lineHeight: 19 }}>
                    {usd(payroll)} payroll, privately · {usd(suppliers)} to suppliers
                  </Txt>
                </View>
                <Kovi pose="key" size={92} />
              </View>
            </Rise>

            <View style={{ gap: 12, marginTop: 16 }}>
              <Tile
                icon="lock"
                tint={colors.tealSoft}
                title="Payroll"
                amount={usd(payroll)}
                sub={`paid privately this month · ${summary?.payroll.people ?? 0} ${summary?.payroll.people === 1 ? 'person' : 'people'}`}
                onPress={() => router.push('/terminal/payroll')}
              />
              <Tile
                icon="web"
                tint={colors.coralSoft}
                title="Suppliers"
                amount={usd(suppliers)}
                sub={`paid this month · ${summary?.suppliers.count ?? 0} ${summary?.suppliers.count === 1 ? 'supplier' : 'suppliers'}`}
                onPress={() => router.push('/terminal/suppliers')}
              />
              <Tile
                icon="user"
                tint={colors.sunken}
                title="Team"
                amount={usd(teamToday)}
                sub={`spent today · ${team.length} ${team.length === 1 ? 'key' : 'keys'}`}
                onPress={() => router.push('/terminal/team')}
              />
            </View>

            <Card style={{ marginTop: 22, padding: 16 }}>
              <Txt weight="bold" size={17}>
                How payroll stays private
              </Txt>
              {[
                'Each person’s pay goes to an address made for that payment alone, from their own key.',
                'Monad shows the business paying addresses nobody can tie to your people.',
                `They find it with their own keys, with a sealed note from ${shop.name}.`,
              ].map((line, i) => (
                <View key={line} style={styles.step}>
                  <Txt weight="bold" size={14} color={colors.tealDeep}>
                    {i + 1}
                  </Txt>
                  <Txt size={14} color={colors.onTint} style={{ flex: 1, lineHeight: 20 }}>
                    {line}
                  </Txt>
                </View>
              ))}
            </Card>
          </>
        )}
      </ScrollView>
    </Screen>
  )
}

function Tile({
  icon,
  tint,
  title,
  amount,
  sub,
  onPress,
}: {
  icon: IconName
  tint: string
  title: string
  amount: string
  sub: string
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${amount} ${sub}`}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed && { opacity: 0.8 }]}
    >
      <View style={[styles.tileIcon, { backgroundColor: tint }]}>
        <Icon name={icon} size={20} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt weight="semi" size={15}>
          {title}
        </Txt>
        <Txt weight="bold" size={24} style={{ letterSpacing: -0.6 }}>
          {amount}
        </Txt>
        <Txt size={13} color={colors.muted}>
          {sub}
        </Txt>
      </View>
      <Icon name="arrow" size={20} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', gap: 12, paddingTop: 60, paddingHorizontal: 12 },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 18,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.teal,
  },
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
  },
  tileIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  step: { flexDirection: 'row', gap: 10, marginTop: 10 },
})
