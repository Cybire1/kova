import { phoneInput, type PhonePayment } from '@kova/monad'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { Linking, ScrollView } from 'react-native'
import { network, networkId, isTestnet } from '@/lib/config'
import { phoneClient } from '@/lib/phone'
import { colors } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Header, PillButton, Screen, TextLink, Txt } from '@/ui/primitives'
import { Field, styles } from '@/ui/send/PhoneSend'

export default function Page() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { profile, signMessage, refresh } = useWallet()
  const [payment, setPayment] = useState<PhonePayment | null>(null)
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [verified, setVerified] = useState(false)
  const [busy, setBusy] = useState(false)
  const working = useRef(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setCodeSent(false)
    setVerified(false)
  }, [id, profile?.address])
  useEffect(() => {
    let live = true
    const load = () => {
      void phoneClient
        .get(id)
        .then((p) => {
          if (live) setPayment(p)
        })
        .catch((e) => {
          if (live) setError(e.message)
        })
    }
    load()
    const timer = setInterval(load, 5000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [id])
  async function act(run: () => Promise<void>) {
    if (!profile || working.current) return
    working.current = true
    setBusy(true)
    setError(null)
    try {
      await run()
      setPayment(await phoneClient.get(id))
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t complete this request.')
    } finally {
      working.current = false
      setBusy(false)
    }
  }
  const mine = payment?.sender.toLowerCase() === profile?.address.toLowerCase()
  const waiting = payment && ['funding', 'open'].includes(payment.status)
  return (
    <Screen edges={['top']}>
      <Header title="Phone payment" />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {isTestnet ? <Txt weight="semi">Test dollars · simulator SMS</Txt> : null}
        {payment ? (
          payment.network !== networkId ? (
            <Txt>This payment belongs to another network. Open its original invitation.</Txt>
          ) : (
            <>
              <Txt weight="bold" size={28}>
                ${payment.amount}{' '}
                {mine ? `to ${payment.phone}` : `from ${payment.sender_name || 'a Kova user'}`}
              </Txt>
              <Txt>
                {
                  {
                    funding: 'Waiting for the funding transfer to confirm.',
                    open: 'Waiting for the recipient to verify their number and claim.',
                    claiming: 'Claim confirming…',
                    returning: 'Return confirming…',
                    claimed: 'Payment claimed.',
                    returned: 'Payment returned to sender.',
                  }[payment.status]
                }
              </Txt>
              {payment.note ? <Txt>“{payment.note}”</Txt> : null}
              {mine && waiting ? (
                <>
                  <Txt>
                    {payment.sms_sent
                      ? 'The message provider accepted the invitation.'
                      : 'The invitation hasn’t been accepted by the message provider yet.'}
                  </Txt>
                  {payment.status === 'open' ? (
                    <PillButton
                      label="Send invitation again"
                      disabled={busy}
                      onPress={() =>
                        void act(async () => {
                          const p = await phoneClient.resend(signMessage, profile!.address, id)
                          if (!p.sms_sent)
                            throw new Error(
                              'The provider hasn’t accepted the invitation. You can still return the dollars.',
                            )
                        })
                      }
                    />
                  ) : null}
                  <TextLink
                    label="Return dollars to my wallet"
                    onPress={() =>
                      void act(async () => {
                        await phoneClient.takeBack(signMessage, profile!.address, id)
                      })
                    }
                  />
                </>
              ) : null}
              {!mine && payment.status === 'open' && profile ? (
                <>
                  <Txt>Verify {payment.phone} to claim into this Kova wallet.</Txt>
                  <Field
                    label="Full phone number with country code"
                    value={phone}
                    onChangeText={setPhone}
                    keyboardType="phone-pad"
                    editable={!codeSent}
                  />
                  {codeSent && !verified ? (
                    <Field
                      label="Verification code"
                      value={code}
                      onChangeText={setCode}
                      keyboardType="number-pad"
                      maxLength={6}
                      autoComplete="sms-otp"
                    />
                  ) : null}
                  <PillButton
                    label={
                      busy
                        ? 'Please wait…'
                        : verified
                          ? 'Finish claiming'
                          : codeSent
                            ? 'Verify and claim'
                            : 'Continue to claim'
                    }
                    disabled={busy}
                    onPress={() =>
                      void act(async () => {
                        const normalized = phoneInput(phone)
                        if (!normalized) throw new Error('Include the country code.')
                        if (!codeSent) {
                          try {
                            await phoneClient.claim(signMessage, profile.address, id)
                            return
                          } catch (error) {
                            if (!(error instanceof Error) || !error.message.includes('Verify the recipient phone number with this wallet first.')) throw error
                          }
                          await phoneClient.requestCode(
                            signMessage,
                            profile.address,
                            id,
                            normalized,
                          )
                          setCodeSent(true)
                        } else if (!verified) {
                          await phoneClient.verify(
                            signMessage,
                            profile.address,
                            id,
                            normalized,
                            code,
                          )
                          setVerified(true)
                          await phoneClient.claim(signMessage, profile.address, id)
                        } else await phoneClient.claim(signMessage, profile.address, id)
                      })
                    }
                  />
                  {codeSent && !verified ? (
                    <TextLink
                      label="Request another code or change number"
                      onPress={() => {
                        if (!busy) {
                          setCodeSent(false)
                          setCode('')
                        }
                      }}
                    />
                  ) : null}
                </>
              ) : null}
              {!profile ? <Txt>Open or create your Kova wallet to claim this payment.</Txt> : null}
              {payment.tx_hash ? (
                <TextLink
                  label="View receipt"
                  onPress={() =>
                    void Linking.openURL(`${network.explorerUrl}/tx/${payment.tx_hash}`)
                  }
                />
              ) : null}
              <TextLink label="Open my wallet" onPress={() => router.replace('/(tabs)')} />
            </>
          )
        ) : (
          <Txt>Loading payment…</Txt>
        )}
        {error ? (
          <Txt accessibilityRole="alert" color={colors.danger}>
            {error}
          </Txt>
        ) : null}
      </ScrollView>
    </Screen>
  )
}
