'use client'
import { getNetwork, type PhonePayment } from '@kova/monad'
import { useEffect, useMemo, useState } from 'react'
import { phoneClient } from '@/lib/wallet/phone'
import { useWallet } from './provider'
import { Welcome } from './welcome'
export function PhoneWelcome({ id }: { id: string }) {
  const { network } = useWallet()
  const client = useMemo(() => phoneClient(getNetwork(network).chainId), [network])
  const [payment, setPayment] = useState<PhonePayment | null>(null)
  useEffect(() => {
    let live = true
    void client
      .get(id)
      .then((p) => {
        if (live) setPayment(p)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [client, id])
  if (payment && ['claimed', 'returned'].includes(payment.status))
    return (
      <section className="w-keys">
        <h1>This payment was {payment.status}</h1>
        <p>Ask the sender for a new payment if needed.</p>
      </section>
    )
  return (
    <Welcome
      invitation={
        payment
          ? {
              amount: payment.amount,
              sender: payment.sender_name || 'Someone',
              phone: payment.phone,
            }
          : undefined
      }
    />
  )
}
