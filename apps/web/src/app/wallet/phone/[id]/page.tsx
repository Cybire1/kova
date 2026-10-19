import { PhonePaymentScreen } from '@/components/wallet/phone'
export const metadata = {
  title: 'Your Kova phone payment',
  robots: { index: false, follow: false },
}
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <PhonePaymentScreen id={(await params).id} />
}
