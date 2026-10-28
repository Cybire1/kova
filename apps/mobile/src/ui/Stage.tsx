import type { ReactNode } from 'react'
import { type ColorValue, View } from 'react-native'
import { colors } from '@/lib/theme'
import { Kovi, type KoviPose, koviFeet } from './art'
import { Floor } from './Floor'
import { Bob, Bounce } from './motion'

/**
 * Kovi standing on his paper-cut floor. The floor stays put while he moves, so a bounce reads
 * as a jump rather than the whole scene shifting.
 */
export function Stage({
  pose,
  size = 200,
  motion = 'bounce',
  floor = colors.surface,
  children,
}: {
  pose: KoviPose
  size?: number
  motion?: 'bounce' | 'bob' | 'still'
  floor?: ColorValue
  children?: ReactNode
}) {
  const floorW = size * 0.86
  const floorH = floorW * 0.2
  const feet = koviFeet(pose)
  const kovi = <Kovi pose={pose} size={size} />
  return (
    <View style={{ width: size, height: size * feet + floorH * 0.55, alignItems: 'center' }}>
      <View
        style={{ position: 'absolute', top: size * feet - floorH * 0.5, left: (size - floorW) / 2 }}
      >
        <Floor width={floorW} top={floor} />
      </View>
      {motion === 'bounce' ? <Bounce>{kovi}</Bounce> : motion === 'bob' ? <Bob>{kovi}</Bob> : kovi}
      {children}
    </View>
  )
}
