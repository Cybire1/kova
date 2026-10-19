import { Suspense } from 'react'
import { PhoneSend } from '@/components/wallet/phone'
export default function Page() {
  return (
    <Suspense>
      <PhoneSend />
    </Suspense>
  )
}
