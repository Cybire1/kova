import {
  type ChainDepositActivity,
  type PendingMonConversion,
  conversionActivity,
  monClient,
  monConversionKey,
  monCardDismissalKey,
} from '@kova/monad'
import { useCallback, useEffect, useState } from 'react'
import { AppState } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { chainDepositActivity } from './chain'
import { load, save, remove } from './storage'
import { useWallet } from './wallet'

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

  useFocusEffect(
    useCallback(() => {
      let active = true
      setActivity(null)
      setReverted(false)
      setSaved(null)
      setLoadedWallet(undefined)
      setDismissed(null)
      if (wallet)
        void Promise.all([
          load<PendingMonConversion | null>(monConversionKey(wallet), null),
          load<string | null>(monCardDismissalKey(wallet), null),
        ]).then(([value, balance]) => {
          if (active) {
            setSaved(value)
            if (balance !== null)
              try {
                setDismissed({ wallet, balance: BigInt(balance) })
              } catch {}
            setLoadedWallet(wallet)
          }
        })
      return () => {
        active = false
      }
    }, [wallet]),
  )

  const remember = useCallback(
    async (value: PendingMonConversion | null) => {
      if (!wallet) throw new Error('Open your wallet first.')
      if (value) await save(monConversionKey(wallet), value)
      else await remove(monConversionKey(wallet))
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
      await save(monCardDismissalKey(wallet), balance.toString()).catch(() => {})
    },
    [wallet, monBalance],
  )

  const completeCard = useCallback(async () => {
    if (!wallet || !pending) return
    const remainder = await monClient.getBalance({ address: wallet })
    await refresh()
    const latest = await load<PendingMonConversion | null>(monConversionKey(wallet), null)
    if (latest?.requestId !== pending.requestId || latest.startedAt !== pending.startedAt) return
    await dismissCard(remainder)
    await remember(null)
  }, [wallet, pending, refresh, dismissCard, remember])

  useEffect(() => {
    if (!wallet || !pending) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const look = async () => {
      if (AppState.currentState === 'active')
        try {
          const result = await chainDepositActivity(wallet)
          if (!active) return
          const found = conversionActivity(pending, result)
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
