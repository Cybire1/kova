import { useLocalSearchParams } from 'expo-router'
import { View } from 'react-native'
import { getAddress, isAddress } from 'viem'
import { colors } from '@/lib/theme'
import { Txt } from '@/ui/primitives'
import { SendSheet } from '@/ui/send/SendSheet'

/**
 * Send to someone already known: a person on Home, a scanned code, or a Kova link. The same sheet,
 * starting at the amount (or at the review, when the link says how much).
 */
export default function SendTo() {
  const params = useLocalSearchParams<{
    to: string
    name?: string
    cur?: string
    amount?: string
    note?: string
    rename?: string
    autosend?: string
    private?: string
  }>()
  if (!params.to || !isAddress(params.to))
    return (
      <View style={{ padding: 24, paddingBottom: 48, backgroundColor: colors.paper }}>
        <Txt weight="semi" size={18}>
          That address doesn’t look right.
        </Txt>
      </View>
    )
  return (
    <SendSheet
      payee={{
        address: getAddress(params.to),
        name: params.name || undefined,
        currency: params.cur || undefined,
        amount: params.amount || undefined,
        note: params.note || undefined,
        rename: params.rename === '1',
        autoSend: __DEV__ && params.autosend === '1',
        privately: __DEV__ && params.private === '1',
      }}
    />
  )
}
