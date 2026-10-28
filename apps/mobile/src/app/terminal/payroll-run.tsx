import { useLocalSearchParams } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native'
import { getPayrollRun, type PayrollRun } from '@/lib/api'
import { shortAddress, usd, whenLabel } from '@/lib/business'
import { useShop } from '@/lib/shop'
import { colors } from '@/lib/theme'
import { businessStyles, Card, LineIcon, Problem } from '@/ui/Business'
import { Header, Screen, Txt } from '@/ui/primitives'

/** One payroll's receipt: who got what, and the one-time address each payment went to. */
export default function PayrollRunReceipt() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const shop = useShop()
  const [run, setRun] = useState<PayrollRun | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    void getPayrollRun(id)
      .then(setRun)
      .catch((error) => setProblem(error instanceof Error ? error.message : 'Kova didn’t answer.'))
  }, [id])

  return (
    <Screen edges={['top']}>
      <Header
        title={run?.label ?? 'Payroll'}
        subtitle={run ? whenLabel(run.created_at) : undefined}
      />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 48 }}
      >
        <Problem text={problem} />
        {!run && !problem ? (
          <ActivityIndicator color={colors.ink} style={{ marginTop: 60 }} />
        ) : null}
        {run ? (
          <>
            <View style={{ alignItems: 'center', paddingVertical: 18 }}>
              <Txt weight="semi" size={15} color={colors.muted}>
                Paid privately
              </Txt>
              <Txt weight="bold" size={48} style={{ letterSpacing: -1.6 }}>
                {usd(run.paid_total)}
              </Txt>
              <Txt size={14} color={colors.muted}>
                {run.paid} of {run.people} {run.people === 1 ? 'person' : 'people'}
                {run.failed ? ` · ${run.failed} didn’t go through` : ''}
              </Txt>
            </View>
            <Card>
              {run.payments.map((p, i) => (
                <View key={p.id} style={[businessStyles.row, i > 0 && businessStyles.rule]}>
                  <LineIcon state={p.status} />
                  <View style={{ flex: 1 }}>
                    <Txt weight="semi" size={15} numberOfLines={1}>
                      {p.name}
                    </Txt>
                    <Txt
                      size={12}
                      color={p.status === 'failed' ? colors.coralDeep : colors.muted}
                      numberOfLines={2}
                    >
                      {p.status === 'paid' && p.stealth_address
                        ? `To one-time address ${shortAddress(p.stealth_address)}`
                        : p.status === 'failed'
                          ? (p.failure ?? 'Didn’t go through')
                          : 'Waiting'}
                    </Txt>
                    {p.explorer_url ? (
                      <Pressable
                        onPress={() => void WebBrowser.openBrowserAsync(p.explorer_url as string)}
                      >
                        <Txt weight="semi" size={13} color={colors.tealDeep}>
                          See proof
                        </Txt>
                      </Pressable>
                    ) : null}
                  </View>
                  <Txt weight="bold" size={15}>
                    {usd(p.amount)}
                  </Txt>
                </View>
              ))}
            </Card>
            <Txt size={13} color={colors.muted} style={{ marginTop: 14, lineHeight: 19 }}>
              To everyone else, {shop.name} pays these one-time addresses. Who they belong to is in
              this book and in each person’s own wallet, nowhere else.
            </Txt>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  )
}
