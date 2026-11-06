import { useLocalSearchParams } from 'expo-router'
import { isNetworkId } from '@/lib/crosschain'
import { AnywhereSend } from '@/ui/send/anywhere/AnywhereSend'

/**
 * Send to any network: an address from another network, pasted or scanned in Send. `network`
 * starts it on that network (and if the address can't receive there, Kova stops and says so);
 * with `amount` too it opens on the boarding pass. In development `autosend=1` slides by itself,
 * for screenshots.
 */
export default function SendAnywhere() {
  const params = useLocalSearchParams<{
    address?: string
    network?: string
    amount?: string
    autosend?: string
  }>()
  const amount =
    params.amount && /^\d+(\.\d{1,2})?$/.test(params.amount) ? params.amount : undefined
  return (
    <AnywhereSend
      address={params.address ?? ''}
      preset={isNetworkId(params.network) ? params.network : undefined}
      amount={amount}
      autoSend={__DEV__ && params.autosend === '1'}
    />
  )
}
