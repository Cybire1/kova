import { type PhonePayment, type PhoneResolution, phoneInput } from '@kova/monad'
import { router } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { parseUnits } from 'viem'
import { isTestnet } from '@/lib/config'
import { formatUsd } from '@/lib/money'
import { newLinkKey, setLinkId } from '@/lib/paylinks'
import { phoneClient } from '@/lib/phone'
import { colors, fonts } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Header, PillButton, Screen, TextLink, Txt } from '../primitives'
import { SlideToSend } from './SlideToSend'

export function PhoneSend({ initialPhone = '' }: { initialPhone?: string }) {
  const { profile, balance, send, signMessage } = useWallet()
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [phone, setPhone] = useState(initialPhone)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [target, setTarget] = useState<(PhoneResolution & { phone: string }) | null>(null)
  const [pending, setPending] = useState<PhonePayment | null>(null)
  const [busy, setBusy] = useState(false)
  const working = useRef(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void phoneClient
      .info()
      .then((i) => {
        if (live) setEnabled(i.enabled)
      })
      .catch(() => {
        if (live) setEnabled(false)
      })
    return () => {
      live = false
    }
  }, [])
  const value = /^\d{1,3}(\.\d{1,2})?$/.test(amount) ? parseUnits(amount, 6) : 0n
  const valid = value >= 10_000n && value <= 200_000_000n && balance !== null && value <= balance
  async function review() {
    if (!profile || working.current || !valid) return
    const normalized = phoneInput(phone)
    if (!normalized) return setError('Include the country code, for example +2348012345678.')
    working.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await phoneClient.resolve(signMessage, profile.address, normalized)
      if (result.address?.toLowerCase() === profile.address.toLowerCase())
        throw new Error('That number is linked to your own Kova wallet.')
      setTarget({ phone: normalized, ...result })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t check the number.')
    } finally {
      working.current = false
      setBusy(false)
    }
  }
  async function pay() {
    if (!profile || !target || !valid || working.current) return
    working.current = true
    setBusy(true)
    setError(null)
    try {
      if (target.address) {
        const fresh = await phoneClient.resolve(signMessage, profile.address, target.phone)
        if (
          fresh.address?.toLowerCase() !== target.address.toLowerCase() ||
          fresh.destination !== target.destination
        )
          throw new Error('The recipient changed. Check the number again.')
        await send({ address: target.address, name: target.phone }, value, note, {
          privately: false,
        })
        router.replace('/(tabs)')
        return
      }
      const kept = await newLinkKey(value, note.trim() || null)
      const reserved = await phoneClient.reserve(
        signMessage,
        profile.address,
        {
          phone: target.phone,
          address: kept.address,
          amount,
          name: profile.name,
          note: note.trim(),
        },
        kept.key,
      )
      await setLinkId(kept.address, reserved.id)
      setPending(reserved)
      try {
        await send({ address: kept.address, name: target.phone }, value, note, { privately: false })
      } catch {
        router.replace({ pathname: '/phone/[id]', params: { id: reserved.id } })
        return
      }
      await phoneClient.confirm(signMessage, profile.address, reserved.id).catch(() => null)
      router.replace({ pathname: '/phone/[id]', params: { id: reserved.id } })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t send this payment.')
    } finally {
      working.current = false
      setBusy(false)
    }
  }
  return (
    <Screen edges={['top']}>
      <Header title="Send to a phone" />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
        {isTestnet ? <Txt weight="semi">Test dollars · simulator SMS</Txt> : null}
        {enabled === null ? (
          <Txt>Checking availability…</Txt>
        ) : !enabled ? (
          <Txt>Phone payments aren’t available on this network yet.</Txt>
        ) : !target ? (
          <>
            <Txt>
              Send to their number. If they’re new, their dollars wait while they join Kova and
              verify their phone.
            </Txt>
            <Field
              label="Phone number with country code"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              placeholder="+2348012345678"
            />
            <Field
              label="Amount in dollars"
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
            />
            <Txt>Available: {balance === null ? '…' : formatUsd(balance)}</Txt>
            <Field label="Note (optional)" value={note} onChangeText={setNote} maxLength={140} />
            <PillButton
              label={busy ? 'Checking…' : 'Review transfer'}
              disabled={busy || !valid}
              onPress={() => void review()}
            />
          </>
        ) : (
          <>
            <Txt weight="bold" size={28}>
              {formatUsd(value)} to {target.phone}
            </Txt>
            <Txt>
              {target.address
                ? target.destination === 'ussd-pocket'
                  ? 'Goes directly to their USSD balance, ready to spend by dialling Kova.'
                  : 'This number is verified. The dollars go directly to their Kova wallet.'
                : 'They verify their number and open Kova to claim. You can take the payment back until it’s claimed.'}
            </Txt>
            {!target.address ? (
              <Txt>Kova holds the waiting payment securely until it’s claimed or returned.</Txt>
            ) : null}
            <SlideToSend
              label="Slide to send"
              busy={busy}
              disabled={!valid || Boolean(pending)}
              onSend={() => void pay()}
            />
            <TextLink
              label="Change details"
              onPress={() => {
                if (!busy && !pending) setTarget(null)
              }}
            />
          </>
        )}
        {error ? (
          <Txt accessibilityRole="alert" color={colors.danger}>
            {error}
          </Txt>
        ) : null}
        {pending ? (
          <TextLink
            label="Open waiting payment"
            onPress={() => router.push({ pathname: '/phone/[id]', params: { id: pending.id } })}
          />
        ) : null}
      </ScrollView>
    </Screen>
  )
}
export function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) {
  const { label, ...rest } = props
  return (
    <View style={{ gap: 6 }}>
      <Txt weight="semi" size={14}>
        {label}
      </Txt>
      <TextInput
        {...rest}
        accessibilityLabel={label}
        autoCorrect={false}
        autoCapitalize="none"
        placeholderTextColor={colors.muted}
        style={styles.input}
      />
    </View>
  )
}
export const styles = StyleSheet.create({
  body: { padding: 20, paddingBottom: 60, gap: 20 },
  input: {
    borderWidth: 2,
    borderColor: colors.ink,
    borderRadius: 18,
    padding: 14,
    color: colors.ink,
    fontFamily: fonts.medium,
    fontSize: 16,
    backgroundColor: colors.surface,
  },
})
