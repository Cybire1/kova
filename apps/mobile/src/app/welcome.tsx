import { router } from 'expo-router'
import { StyleSheet, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors } from '@/lib/theme'
import { Flyer, PlanetScene, welcomeScene } from '@/ui/art'
import { LogoMark, Wordmark } from '@/ui/Logo'
import { Flight } from '@/ui/motion'
import { PillButton, Rise, TextLink, Txt } from '@/ui/primitives'

/**
 * The first thing anyone sees: Kovi flies money from a shop to a home, across a little
 * planet, on the same dotted route the scene draws.
 */
export default function Welcome() {
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const sceneTop = insets.top + 40
  const sceneH = Math.min(width * welcomeScene.aspect, height * 0.42)
  const sceneW = sceneH / welcomeScene.aspect
  const sceneLeft = (width - sceneW) / 2
  const panelTop = sceneTop + sceneH - 24

  // The dotted route painted in the scene, in screen coordinates.
  const route = welcomeScene.route(sceneW, sceneTop)
  const shift = (p: { x: number; y: number }) => ({ x: p.x + sceneLeft, y: p.y })

  return (
    <View style={styles.screen}>
      <View style={[styles.wordmark, { top: insets.top + 10 }]}>
        <LogoMark size={40} />
        <Wordmark height={26} />
      </View>
      <View style={{ position: 'absolute', top: sceneTop, left: sceneLeft }}>
        <PlanetScene width={sceneW} />
      </View>
      <Flight
        from={shift(route.from)}
        via={shift(route.via)}
        to={shift(route.to)}
        size={130}
        duration={7000}
      >
        <Flyer size={130} />
      </Flight>

      <View style={[styles.panel, { top: panelTop, paddingBottom: insets.bottom + 24 }]}>
        <Rise delay={120}>
          <Txt weight="bold" size={46} style={styles.title}>
            Tap. Paid.{'\n'}Anywhere.
          </Txt>
          <Txt size={17} color={colors.onTint} style={styles.body}>
            Pay, send and get paid in any currency. It lands in seconds, anywhere in the world.
          </Txt>
        </Rise>
        <View style={styles.actions}>
          <PillButton label="Create my wallet" onPress={() => router.push('/setup')} />
          <View style={styles.links}>
            <TextLink label="I already have Kova" onPress={() => router.push('/restore')} />
            <TextLink label="I run a shop" onPress={() => router.push('/terminal/setup')} />
          </View>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  wordmark: { position: 'absolute', left: 20, flexDirection: 'row', alignItems: 'center', gap: 8 },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.coralSoft,
    borderTopLeftRadius: 44,
    borderTopRightRadius: 44,
    borderTopWidth: 2,
    borderColor: colors.ink,
    paddingHorizontal: 28,
    paddingTop: 36,
    justifyContent: 'space-between',
  },
  title: { lineHeight: 48, letterSpacing: -1.6 },
  body: { lineHeight: 25, marginTop: 14 },
  actions: { gap: 18 },
  links: { flexDirection: 'row', justifyContent: 'center', gap: 28 },
})
