import { StyleSheet, View } from 'react-native'
import QRCode from 'react-native-qrcode-svg'
import { palette } from '@/lib/theme'
import { KoviPeek, peekEdge } from './art'
import { Sticker } from './primitives'

/** A QR on a white sticker, with Kovi peeking over its top edge. */
export function CodeCard({ value, size = 220 }: { value: string; size?: number }) {
  return (
    <View style={{ alignItems: 'center', paddingTop: 44 }}>
      <Sticker radius={32} style={{ width: size + 48, height: size + 48 }}>
        <View style={styles.inner}>
          <QRCode
            value={value}
            size={size}
            color={palette.light.ink}
            backgroundColor={palette.light.surface}
            ecl="M"
          />
        </View>
      </Sticker>
      <View style={styles.peek} pointerEvents="none">
        <KoviPeek width={PEEK} />
      </View>
    </View>
  )
}

const PEEK = 130

const styles = StyleSheet.create({
  inner: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // The peek artwork's edge line sits on the sticker's top border.
  peek: { position: 'absolute', top: 44 - (PEEK / 2) * peekEdge + 1, right: 34 },
})
