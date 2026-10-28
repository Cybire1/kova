import * as Haptics from 'expo-haptics'
import { Pressable, StyleSheet, View } from 'react-native'
import type { Key } from '@/lib/money'
import { colors } from '@/lib/theme'
import { Icon } from './Icon'
import { Txt } from './primitives'

const rows: Key[][] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', 'del'],
]

/** Round outlined keys that give a little when pressed. */
export function Keypad({
  onKey,
  decimals = true,
  size = 62,
}: {
  onKey: (key: Key) => void
  decimals?: boolean
  size?: number
}) {
  return (
    <View style={styles.grid}>
      {rows.map((row) => (
        <View key={row.join('')} style={styles.row}>
          {row.map((key) => {
            if (key === '.' && !decimals) return <View key={key} style={{ width: size + 4 }} />
            const del = key === 'del'
            return (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityLabel={del ? 'Delete' : key === '.' ? 'Decimal point' : key}
                onPress={() => {
                  void Haptics.selectionAsync()
                  onKey(key)
                }}
                style={{ width: size + 4, height: size + 4 }}
              >
                {({ pressed }) =>
                  del ? (
                    <View
                      style={[
                        styles.key,
                        {
                          width: size,
                          height: size,
                          borderWidth: 0,
                          backgroundColor: 'transparent',
                        },
                      ]}
                    >
                      <Icon name="del" size={28} />
                    </View>
                  ) : (
                    <>
                      <View
                        style={[
                          styles.key,
                          { width: size, height: size, borderRadius: size / 2 },
                          pressed && {
                            transform: [{ scale: 0.94 }],
                            backgroundColor: colors.sunken,
                          },
                        ]}
                      >
                        <Txt weight="medium" size={30}>
                          {key}
                        </Txt>
                      </View>
                    </>
                  )
                }
              </Pressable>
            )
          })}
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  grid: { gap: 12, paddingHorizontal: 30 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  key: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
