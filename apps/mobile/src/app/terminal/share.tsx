import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { useLocalSearchParams } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { useState } from 'react'
import {
  type ColorValue,
  Linking,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native'
import QRCode from 'react-native-qrcode-svg'
import { posterLinkFor, stallLinkFor, tableLinkFor } from '@/lib/api'
import { useStall } from '@/lib/stall'
import { colors, palette } from '@/lib/theme'
import { Awning } from '@/ui/Awning'
import { Kovi } from '@/ui/art'
import { Icon, type IconName } from '@/ui/Icon'
import { Header, Screen, Txt } from '@/ui/primitives'

const coin = require('../../../assets/art/coin-usd.png')

/**
 * The stall's code, big enough to scan across a counter, with the other ways to spread it:
 * the link, WhatsApp, and a poster to print for the table. A stall with tables has a code for
 * each one too, so an order says which table to bring it to.
 */
export default function ShareStall() {
  const { width } = useWindowDimensions()
  const { stall } = useStall()
  const params = useLocalSearchParams<{ table?: string }>()
  const [copied, setCopied] = useState(false)
  const [picked, setPicked] = useState<number>(() => Number(params.table) || 0)

  if (!stall)
    return (
      <Screen bg={colors.paper}>
        <Header backIcon="close" />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Kovi pose="oops" size={120} />
        </View>
      </Screen>
    )

  const tables = stall.table_count ?? 0
  // 0 is the counter's code; 1 to N, a table's.
  const table = picked > 0 && picked <= tables ? String(picked) : null
  const link = table ? tableLinkFor(stall.slug, table) : stallLinkFor(stall.slug)
  const message = table
    ? `Table ${table} at ${stall.name}: scan to order and we’ll bring it over. ${link}`
    : `Order from ${stall.name} and pay in dollars with Kova: ${link}`
  const card = Math.min(width - 48, 340)
  const qr = card - 84

  return (
    <Screen bg={colors.paper} edges={['bottom']}>
      <View style={{ paddingTop: 8 }}>
        <Header title={tables ? 'Your codes' : 'Share your stall'} backIcon="close" />
      </View>
      {tables ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.picker}
          style={{ flexGrow: 0 }}
        >
          {Array.from({ length: tables + 1 }, (_, n) => n).map((i) => {
            const on = i === (table ? picked : 0)
            return (
              <Pressable
                key={i}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={i ? `Table ${i}` : 'Counter'}
                onPress={() => {
                  void Haptics.selectionAsync()
                  setPicked(i)
                  setCopied(false)
                }}
                style={[styles.pick, on && styles.pickOn]}
              >
                <Txt weight="semi" size={14} color={on ? colors.onChosen : colors.ink}>
                  {i ? `Table ${i}` : 'Counter'}
                </Txt>
              </Pressable>
            )
          })}
        </ScrollView>
      ) : null}
      <ScrollView contentContainerStyle={styles.body}>
        <View style={[styles.card, { width: card }]}>
          <Awning
            width={card}
            height={54}
            stripe={card / 11}
            tone={stall.open ? 'coral' : 'teal'}
          />
          {table ? (
            <View style={styles.tableBadge}>
              <Txt weight="semi" size={10} color={colors.white} style={{ letterSpacing: 0.6 }}>
                TABLE
              </Txt>
              <Txt weight="bold" size={22} color={colors.white} style={{ lineHeight: 24 }}>
                {table}
              </Txt>
            </View>
          ) : null}
          <View style={styles.cardBody}>
            <Txt
              weight="bold"
              size={24}
              style={{ textAlign: 'center', letterSpacing: -0.6 }}
              numberOfLines={2}
            >
              {stall.name}
            </Txt>
            <Txt size={14} color={colors.muted} style={{ textAlign: 'center', marginTop: 2 }}>
              {table
                ? 'Scan to order. We bring it to your table.'
                : 'Scan to order. Pay in dollars.'}
            </Txt>
            <View style={styles.qr}>
              <QRCode
                value={link}
                size={qr}
                color={palette.light.ink}
                backgroundColor={palette.light.white}
                ecl="H"
                logo={coin}
                logoSize={qr * 0.2}
                logoBackgroundColor={palette.light.white}
                logoMargin={4}
                logoBorderRadius={qr}
              />
            </View>
            {stall.open ? null : (
              <Txt
                weight="semi"
                size={13}
                color={colors.coralDeep}
                style={{ textAlign: 'center', marginTop: 10 }}
              >
                Your stall is closed. Open it so people can order.
              </Txt>
            )}
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Copy the link"
          onPress={async () => {
            await Clipboard.setStringAsync(link)
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
          style={styles.link}
        >
          <Icon name={copied ? 'check' : 'copy'} size={16} />
          <Txt weight="semi" size={14} numberOfLines={1} style={{ flexShrink: 1 }}>
            {copied ? 'Link copied' : link.replace(/^https?:\/\//, '')}
          </Txt>
        </Pressable>

        <View style={styles.actions}>
          <Action
            icon="whatsapp"
            label="Send on WhatsApp"
            tone={colors.coral}
            // wa.me opens the WhatsApp app when it's installed, and WhatsApp's site when it isn't.
            onPress={() =>
              void Linking.openURL(`https://wa.me/?text=${encodeURIComponent(message)}`)
            }
          />
          <Action
            icon="share"
            label="Share another way"
            tone={colors.surface}
            onPress={() => void Share.share({ message })}
          />
          <Action
            icon="print"
            label={table ? 'Print the stall poster' : 'Print a table poster'}
            tone={colors.tealSoft}
            onPress={() => void WebBrowser.openBrowserAsync(posterLinkFor(stall.slug))}
          />
        </View>
      </ScrollView>
    </Screen>
  )
}

function Action({
  icon,
  label,
  tone,
  onPress,
}: {
  icon: IconName
  label: string
  tone: ColorValue
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        onPress()
      }}
      style={({ pressed }) => [
        styles.action,
        { backgroundColor: tone },
        pressed && { transform: [{ scale: 0.98 }] },
      ]}
    >
      <Icon name={icon} size={20} />
      <Txt weight="semi" size={16} style={{ flex: 1 }}>
        {label}
      </Txt>
      <Icon name="arrow" size={20} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  body: { alignItems: 'center', paddingHorizontal: 24, paddingBottom: 24, paddingTop: 8 },
  picker: { gap: 8, paddingHorizontal: 20, paddingTop: 4, paddingBottom: 10 },
  pick: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.line,
    justifyContent: 'center',
  },
  pickOn: { backgroundColor: colors.chosen },
  tableBadge: {
    position: 'absolute',
    top: 16,
    right: 16,
    minWidth: 54,
    height: 54,
    paddingHorizontal: 6,
    borderRadius: 27,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    borderRadius: 30,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  cardBody: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 22, alignItems: 'center' },
  qr: {
    marginTop: 16,
    padding: 12,
    borderRadius: 22,
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: colors.line,
  },
  link: {
    marginTop: 14,
    maxWidth: '100%',
    height: 38,
    paddingHorizontal: 14,
    borderRadius: 19,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actions: { alignSelf: 'stretch', gap: 10, marginTop: 18 },
  action: {
    height: 52,
    paddingHorizontal: 18,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
})
