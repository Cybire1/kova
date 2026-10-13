import { NairaTopUp } from '@/components/wallet/naira'

/** Add money in naira; Paystack sends the payer back here with ?reference=… */
export default async function NairaTopUpPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await props.searchParams
  const raw = params.reference ?? params.trxref
  const reference = typeof raw === 'string' && /^kova_[0-9a-f]{32}$/.test(raw) ? raw : null
  return <NairaTopUp reference={reference} />
}
