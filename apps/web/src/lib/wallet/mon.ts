'use client'

import {
  type ChainDepositActivity,
  conversionActivity,
  monCardDismissalKey,
  monClient,
  monConversionKey,
  type PendingMonConversion,
} from '@kova/monad'
import { useCallback, useEffect, useState } from 'react'
import { useWallet } from '@/components/wallet/provider'

export async function monApi<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    cache: 'no-store',
    ...(body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error ?? 'Kova didn’t answer. Try again.')
  return result as T
}

export function useMonConversion() {
  const { profile, refresh, monBalance } = useWallet()
  const wallet = profile?.address
  const [saved, setSaved] = useState<PendingMonConversion | null>(null)
  const [activity, setActivity] = useState<ChainDepositActivity | null>(null)
  const [trackingProblem, setTrackingProblem] = useState(false)
  const [reverted, setReverted] = useState(false)
  const [loadedWallet, setLoadedWallet] = useState<string | undefined>()
  const [dismissed, setDismissed] = useState<{ wallet: string; balance: bigint } | null>(null)
  const pending = saved?.wallet.toLowerCase() === wallet?.toLowerCase() ? saved : null

  useEffect(() => {
    setActivity(null)
    setReverted(false)
    setDismissed(null)
    if (!wallet) {
      setSaved(null)
      setLoadedWallet(undefined)
      return
    }
    try {
      setSaved(JSON.parse(localStorage.getItem(monConversionKey(wallet)) ?? 'null'))
    } catch {
      setSaved(null)
    }
    try {
      const balance = localStorage.getItem(monCardDismissalKey(wallet))
      if (balance !== null) setDismissed({ wallet, balance: BigInt(balance) })
    } catch {}
    setLoadedWallet(wallet)
  }, [wallet])

  const remember = useCallback(
    async (value: PendingMonConversion | null) => {
      if (!wallet) throw new Error('Open your wallet first.')
      if (value) localStorage.setItem(monConversionKey(wallet), JSON.stringify(value))
      else localStorage.removeItem(monConversionKey(wallet))
      setSaved(value)
      setActivity(null)
      setReverted(false)
    },
    [wallet],
  )

  const dismissCard = useCallback(
    async (balance = monBalance) => {
      if (!wallet || balance === null) return
      setDismissed({ wallet, balance })
      try {
        localStorage.setItem(monCardDismissalKey(wallet), balance.toString())
      } catch {}
    },
    [wallet, monBalance],
  )

  const completeCard = useCallback(async () => {
    if (!wallet || !pending) return
    // Read the remainder after settlement; an old pre-swap balance could hide later deposits.
    const remainder = await monClient.getBalance({ address: wallet })
    await refresh()
    const latest = JSON.parse(
      localStorage.getItem(monConversionKey(wallet)) ?? 'null',
    ) as PendingMonConversion | null
    if (latest?.requestId !== pending.requestId || latest.startedAt !== pending.startedAt) return
    await dismissCard(remainder)
    await remember(null)
  }, [wallet, pending, refresh, dismissCard, remember])

  useEffect(() => {
    if (!wallet || !pending) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const look = async () => {
      try {
        const result = await monApi<{ data: ChainDepositActivity[] }>(
          `/api/wallet/${wallet}/chain-deposits`,
        )
        if (!active) return
        const found = conversionActivity(pending, result.data)
        if (found) setActivity(found)
        setTrackingProblem(false)
        if (found?.status === 'success' || found?.status === 'refund') void refresh()
        if (pending.hash) {
          const receipt = await monClient
            .getTransactionReceipt({ hash: pending.hash })
            .catch(() => null)
          if (active && receipt?.status === 'reverted') setReverted(true)
        }
      } catch {
        if (active) setTrackingProblem(true)
      }
      if (active) timer = setTimeout(look, 8000)
    }
    void look()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [wallet, pending, refresh])
  return {
    pending,
    activity,
    trackingProblem,
    reverted,
    remember,
    ready: loadedWallet === wallet,
    dismissedAt: dismissed && dismissed.wallet === wallet ? dismissed.balance : null,
    dismissCard,
    completeCard,
  }
}
