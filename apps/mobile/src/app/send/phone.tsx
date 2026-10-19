import { useLocalSearchParams } from 'expo-router'
import { PhoneSend } from '@/ui/send/PhoneSend'
export default function Page() {
  const { phone } = useLocalSearchParams<{ phone?: string }>()
  return <PhoneSend initialPhone={phone} />
}
