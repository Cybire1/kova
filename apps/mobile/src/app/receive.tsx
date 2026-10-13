import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { useState } from 'react'
import { Pressable, Share, StyleSheet, View } from 'react-native'
import { personLink } from '@/lib/links'
import { useOffline } from '@/lib/offline'
import { colors } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { CodeCard } from '@/ui/CodeCard'
import { Icon } from '@/ui/Icon'
import { Header, PillButton, Screen, Txt } from '@/ui/primitives'

/** Your code: anyone with Kova scans it to pay you. Any Monad wallet can use the address. */
export default function Receive() {
  const { profile } = useWallet()
  const { offline } = useOffline()
  const [copied, setCopied] = useState(false)
  if (!profile) return null
  const link = personLink({ address: profile.address, name: profile.name, currency: profile.currency })

  return (
    <Screen bg={colors.tealLight}>
      <Header title="Get paid" backIcon="close" />
      <View style={styles.body}>
        <Txt weight="semi" size={30} style={{ letterSpacing: -0.6, textAlign: 'center' }}>
          Scan to pay {profile.name.split(' ')[0]}
        </Txt>
        <Txt size={16} color={colors.onTint} style={{ textAlign: 'center', marginTop: 6, lineHeight: 22 }}>
          {offline ? 'No signal? They scan this, then you scan their payment code.' : 'It lands in seconds, from anywhere.'}
        </Txt>
        <CodeCard value={link} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Copy your wallet address"
          onPress={async () => {
            await Clipboard.setStringAsync(profile.address)
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
            setCopied(true)
            setTimeout(() => setCopied(false), 1600)
          }}
          style={styles.address}
        >
          <Txt weight="medium" size={14} numberOfLines={1} style={{ flex: 1 }}>
            {profile.address.slice(0, 10)}…{profile.address.slice(-8)}
          </Txt>
          <Icon name={copied ? 'check' : 'copy'} size={18} />
          <Txt weight="semi" size={14}>
            {copied ? 'Copied' : 'Copy'}
          </Txt>
        </Pressable>
        <Txt size={13} color={colors.onTint} style={{ textAlign: 'center', marginTop: 8 }}>
          Monad address. Send only AUSD on Monad.
        </Txt>
      </View>
      <View style={styles.footer}>
        <PillButton
          label="Share my link"
          icon="share"
          onPress={() => void Share.share({ message: `Pay me on Kova: ${link}` })}
        />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  address: {
    marginTop: 22,
    height: 48,
    alignSelf: 'stretch',
    borderRadius: 24,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.ink,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  footer: { paddingHorizontal: 20, paddingBottom: 12, paddingTop: 8 },
})
