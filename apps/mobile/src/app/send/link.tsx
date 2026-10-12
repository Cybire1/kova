import { useLocalSearchParams } from 'expo-router'
import { LinkSheet } from '@/ui/send/LinkSheet'

/**
 * Send as a link, as a sheet over Home like Send: how much, a note, slide, share. `amount` and
 * `note` start it at the review; in development `autosend=1` slides by itself, for screenshots.
 */
export default function SendLink() {
  const params = useLocalSearchParams<{ amount?: string; note?: string; autosend?: string }>()
  const amount = params.amount && /^\d+(\.\d{1,2})?$/.test(params.amount) ? params.amount : undefined
  return <LinkSheet start={{ amount, note: params.note || undefined, autoSend: __DEV__ && params.autosend === '1' }} />
}
