import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native'
import { getBusiness, getTeamKeys, type TeamKey } from '@/lib/api'
import { usd } from '@/lib/business'
import { useShop } from '@/lib/shop'
import { useStall } from '@/lib/stall'
import { colors } from '@/lib/theme'
import { Kovi } from '@/ui/art'
import { Avatar, businessStyles, Card, Problem } from '@/ui/Business'
import { Chip, Header, PillButton, Screen, Txt } from '@/ui/primitives'

/** The team: everyone who can spend the business's dollars, from Keys, with today's spending. */
export default function Team() {
  const shop = useShop()
  const { owned } = useStall()
  const [team, setTeam] = useState<{ available: boolean; data: TeamKey[] } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  useFocusEffect(
    useCallback(() => {
      if (!owned) return
      void getBusiness()
        .then((b) => getTeamKeys(b.owner_address ?? b.settlement_address))
        .then(setTeam)
        .catch((error) => setProblem(error instanceof Error ? error.message : 'Kova didn’t answer.'))
    }, [owned]),
  )

  return (
    <Screen edges={['top']}>
      <Header title="Team" subtitle={shop.name} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 48 }}>
        <Problem text={problem} />
        {!team && !problem && owned ? <ActivityIndicator color={colors.ink} style={{ marginTop: 60 }} /> : null}
        {team?.data.length ? (
          <Card>
            {team.data.map((k, i) => {
              const limit = Number(k.daily_limit ?? 0)
              const spent = Number(k.spent_today ?? 0)
              const share = limit > 0 ? Math.min(1, spent / limit) : 0
              return (
                <View key={k.id} style={[businessStyles.row, i > 0 && businessStyles.rule]}>
                  <Avatar name={k.name} />
                  <View style={{ flex: 1, gap: 4 }}>
                    <Txt weight="semi" size={15} numberOfLines={1}>
                      {k.name}
                    </Txt>
                    <Txt size={12} color={colors.muted}>
                      {limit ? `${usd(spent)} of ${usd(limit)} today` : `${usd(spent)} today`}
                    </Txt>
                    {limit ? (
                      <View style={styles.bar}>
                        <View style={[styles.fill, { width: `${Math.round(share * 100)}%`, backgroundColor: k.frozen ? colors.muted : colors.teal }]} />
                      </View>
                    ) : null}
                  </View>
                  <Chip label={k.frozen ? 'Frozen' : 'Active'} dot={k.frozen ? colors.coral : colors.tealLight} />
                </View>
              )
            })}
          </Card>
        ) : team || !owned ? (
          <View style={styles.empty}>
            <Kovi pose="key" size={130} />
            <Txt weight="bold" size={20} style={{ textAlign: 'center' }}>
              {!owned ? 'The team belongs to the owner' : team && !team.available ? 'Team keys aren’t on this server yet' : 'No one on the team yet'}
            </Txt>
            <Txt size={15} color={colors.muted} style={{ textAlign: 'center', lineHeight: 21 }}>
              Give someone a key in Keys: a daily budget, who they may pay, and a freeze that works at once. They show up here with what
              they’ve spent today.
            </Txt>
            {owned ? <PillButton label="Add a team member in Keys" icon="lock" onPress={() => router.push('/keys')} /> : null}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', gap: 12, paddingTop: 40, paddingHorizontal: 12 },
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.sunken, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
})
