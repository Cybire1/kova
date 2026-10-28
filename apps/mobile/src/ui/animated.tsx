import { forwardRef } from 'react'
import { type ColorValue, useColorScheme } from 'react-native'
import Reanimated from 'react-native-reanimated'

/**
 * Reanimated, with colours it can read. Kova's colours are iOS dynamic colours (lib/theme.ts) so
 * plain views follow light and dark by themselves, but Reanimated 4.1 parses every animated view's
 * style itself and rejects them. So an animated view gets each colour as the plain one it is in
 * the current appearance, and draws again when the appearance changes. Use it as you would
 * Reanimated's default export: `import Animated from '@/ui/animated'`.
 */

type Look = 'light' | 'dark'

/** A dynamic colour as the plain colour it is in `look`; anything else as it is. */
export function plain(value: ColorValue, look: Look): ColorValue
export function plain(value: unknown, look: Look): unknown
export function plain(value: unknown, look: Look): unknown {
  if (value && typeof value === 'object' && 'dynamic' in value) {
    const { light, dark } = (value as { dynamic: { light: unknown; dark: unknown } }).dynamic
    return look === 'dark' ? dark : light
  }
  return value
}

/** The appearance the colours resolve against right now. */
export function useLook(): Look {
  return useColorScheme() === 'dark' ? 'dark' : 'light'
}

function plainStyle(style: unknown, look: Look): unknown {
  if (Array.isArray(style)) return style.map((s) => plainStyle(s, look))
  if (!style || typeof style !== 'object') return style
  // An animated style (useAnimatedStyle) is Reanimated's own handle: it stays as it is.
  if ('viewDescriptors' in style) return style
  let out: Record<string, unknown> | null = null
  for (const [key, value] of Object.entries(style)) {
    const next = plain(value, look)
    if (next !== value) {
      out ??= { ...(style as Record<string, unknown>) }
      out[key] = next
    }
  }
  return out ?? style
}

const View = forwardRef<unknown, { style?: unknown }>(function View(props, ref) {
  const look = useLook()
  return (
    <Reanimated.View
      {...(props as object)}
      ref={ref as never}
      style={plainStyle(props.style, look) as never}
    />
  )
}) as unknown as typeof Reanimated.View

const Animated = { ...Reanimated, View }

export default Animated
