import { useLocalSearchParams } from 'expo-router'
import { SendSheet } from '@/ui/send/SendSheet'

/**
 * Send, as a sheet over Home: who, how much, review, slide to send, sent. `from=private` is Send to
 * any wallet, from Private dollars: paid straight from them.
 */
export default function Send() {
  const { from } = useLocalSearchParams<{ from?: string }>()
  return <SendSheet fromPrivateMode={from === 'private'} />
}
