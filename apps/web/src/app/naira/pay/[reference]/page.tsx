import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { NairaTransfer } from '@/components/wallet/naira'

export const metadata: Metadata = {
  title: 'Pay by bank transfer · Kova',
  robots: { index: false },
}

/** A PAJ top-up's page: the bank account opened for this payment, followed until the dollars land. */
export default async function NairaPayPage(props: { params: Promise<{ reference: string }> }) {
  const { reference } = await props.params
  if (!/^kova_[0-9a-f]{32}$/.test(reference)) notFound()
  return <NairaTransfer reference={reference} />
}
