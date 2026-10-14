import * as Haptics from 'expo-haptics'
import * as WebBrowser from 'expo-web-browser'
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { StyleSheet, useWindowDimensions, View } from 'react-native'
import { naira } from '@/lib/api'
import { topUpLink } from '@/lib/chain'
import { chainDeposits, isTestnet } from '@/lib/config'
import { formatUsd } from '@/lib/money'
import { colors } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Icon } from '@/ui/Icon'
import { CoinRain } from '@/ui/motion'
import { Stage } from '@/ui/Stage'
import { Header, PillButton, Rise, Screen, Sticker, Txt } from '@/ui/primitives'

/**
 * Adding money. On testnet, Kova sends $5 of test AUSD a day from its own testnet treasury. On mainnet this is where
 * card and bank on-ramps go; Kova itself never holds or converts the money (D-012).
 */
export default function AddMoney() {
  const { addMoney, balance, profile, refresh } = useWallet()
  const { width } = useWindowDimensions()
  const [stage, setStage] = useState<'ready' | 'adding' | 'done' | 'problem'>('ready')
  const [problem, setProblem] = useState<string | null>(null)

  const [cardNote, setCardNote] = useState<string | null>(null)
  // Naira through Paystack: on wherever this server has it, testnet included (Paystack's test mode).
  const [nairaOn, setNairaOn] = useState(false)
  useEffect(() => {
    void naira.info().then((info) => setNairaOn(info.enabled))
  }, [])

  /** Ramp's hosted checkout, in the in-app browser; it sends AUSD on Monad to this wallet. */
  const cardOrBank = async () => {
    if (!profile) return
    void Haptics.selectionAsync()
    try {
      const top = await topUpLink(profile.address, profile.currency, 'kova://add-money')
      if (!top.live || !top.url) return setCardNote('Opens on Monad mainnet: buys AUSD straight into this wallet')
      await WebBrowser.openBrowserAsync(top.url)
      void refresh()
    } catch (error) {
      setCardNote(error instanceof Error ? error.message : 'Kova didn’t answer. Try again.')
    }
  }

  const add = async () => {
    setStage('adding')
    try {
      await addMoney()
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setStage('done')
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Kova didn’t answer. Try again.')
      setStage('problem')
    }
  }

  return (
    <Screen bg={colors.tealLight}>
      <Header title="Add money" backIcon="close" />
      <View style={{ height: stage === 'done' ? 300 : 210 }}>
        {stage === 'adding' || stage === 'done' ? <CoinRain width={width} height={300} /> : null}
        <View style={{ position: 'absolute', left: width / 2 - (stage === 'done' ? 95 : 75), top: stage === 'done' ? 90 : 40 }}>
          <Stage pose={stage === 'done' ? 'cheer' : 'catch'} size={stage === 'done' ? 190 : 150} />
        </View>
      </View>
      <Rise style={styles.copy}>
        {stage === 'done' ? (
          <>
            <Txt weight="bold" size={48} style={{ letterSpacing: -1.5 }}>
              Money’s in.
            </Txt>
            <Txt size={17} color={colors.onTint} style={styles.body}>
              Your balance is {balance === null ? '…' : formatUsd(balance)}. Go pay a shop or send some to a friend.
            </Txt>
          </>
        ) : isTestnet ? (
          <>
            <Txt weight="semi" size={34} style={{ letterSpacing: -1 }}>
              Free test dollars
            </Txt>
            <Txt size={17} color={colors.onTint} style={styles.body}>
              Kova is on Monad’s test network: $5 of test dollars a day to try every payment for real. Kova pays the gas.
            </Txt>
          </>
        ) : (
          <>
            <Txt weight="semi" size={34} style={{ letterSpacing: -1 }}>
              Add money
            </Txt>
            <Txt size={17} color={colors.onTint} style={styles.body}>
              Bring dollars from any chain, or send AUSD on Monad to your address. Card and bank top-ups are coming.
            </Txt>
          </>
        )}
        {problem ? (
          <Txt weight="medium" size={15} color={colors.danger} style={{ marginTop: 8 }}>
            {problem}
          </Txt>
        ) : null}
      </Rise>
      {/* Card or bank (Ramp) buys AUSD on Monad mainnet; on testnet it would be a dead end. */}
      {stage !== 'done' && (!isTestnet || chainDeposits || nairaOn) ? (
        <View style={{ paddingHorizontal: 20, marginTop: 20 }}>
          {nairaOn ? (
          <Sticker radius={24} onPress={() => router.push('/add-naira')} accessibilityLabel="From your bank, in naira" style={{ height: 66, marginBottom: 12 }}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Txt weight="semi" size={16}>
                  From your bank, in naira
                </Txt>
                <Txt size={13} color={colors.muted}>
                  Bank transfer, card or USSD, with Paystack
                </Txt>
              </View>
              <Icon name="arrow" size={20} />
            </View>
          </Sticker>
          ) : null}
          {isTestnet ? null : (
          <Sticker radius={24} onPress={() => void cardOrBank()} accessibilityLabel="Card or bank" style={{ height: 66, marginBottom: 12 }}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Txt weight="semi" size={16}>
                  Card or bank
                </Txt>
                <Txt size={13} color={colors.muted}>
                  {cardNote ?? 'Card, Apple Pay or bank, with Ramp Network'}
                </Txt>
              </View>
              <Icon name="card" size={20} />
            </View>
          </Sticker>
          )}
          {chainDeposits ? (
          <Sticker radius={24} onPress={() => router.push('/from-chain')} accessibilityLabel="From another chain" style={{ height: 66 }}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Txt weight="semi" size={16}>
                  From another chain
                </Txt>
                <Txt size={13} color={colors.muted}>
                  USDC, USDT, ETH, SOL or BTC, from 30+ chains
                </Txt>
              </View>
              <Icon name="arrow" size={20} />
            </View>
          </Sticker>
          ) : null}
        </View>
      ) : null}
      <View style={styles.footer}>
        {stage === 'done' ? (
          <PillButton label="Back to home" icon="home" onPress={() => router.back()} />
        ) : isTestnet ? (
          <PillButton label="Add $5 test dollars" icon="plus" loading={stage === 'adding'} onPress={add} />
        ) : (
          <PillButton label="Show my address" icon="receive" onPress={() => router.replace('/receive')} />
        )}
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  copy: { paddingHorizontal: 28 },
  body: { lineHeight: 25, marginTop: 10 },
  row: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18 },
  footer: { paddingHorizontal: 20, paddingBottom: 12, marginTop: 'auto' },
})
