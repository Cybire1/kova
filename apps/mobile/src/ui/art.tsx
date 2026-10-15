/**
 * Kova's illustrations: the generated artwork in assets/art, used as painted and placed by the
 * app. Positions below (flight routes, the receipt, the card bodies, where Kovi's feet land)
 * were measured from these exact images; re-measure if an image is regenerated.
 *
 * Kovi, a coin with a face, carries the payment story: he rides the plane when money goes
 * abroad, catches coins when it arrives, cheers on the receipt when a shop is paid and naps
 * on a frozen card. Anything that changes per payment (amounts, names, card numbers) is set
 * on top in the app's own type, never baked into the images.
 */
import { Image } from 'expo-image'
import { View } from 'react-native'
import { colors } from '@/lib/theme'
import { Wordmark } from './Logo'
import { Txt } from './primitives'

const art = {
  kovi: {
    wave: require('../../assets/art/kovi-wave.png'),
    cheer: require('../../assets/art/kovi-cheer.png'),
    catch: require('../../assets/art/kovi-catch.png'),
    key: require('../../assets/art/kovi-key.png'),
    sleep: require('../../assets/art/kovi-sleep.png'),
    ride: require('../../assets/art/kovi-ride.png'),
    oops: require('../../assets/art/kovi-oops.png'),
  },
  peek: require('../../assets/art/kovi-peek.png'),
  welcome: require('../../assets/art/scene-welcome.png'),
  send: require('../../assets/art/scene-send.png'),
  faceid: require('../../assets/art/scene-faceid.png'),
  terminal: require('../../assets/art/scene-paid-terminal.png'),
  cardActive: require('../../assets/art/card-active.png'),
  cardFrozen: require('../../assets/art/card-frozen.png'),
  plane: require('../../assets/art/plane.png'),
  snowflakes: require('../../assets/art/snowflakes.png'),
  flakes: [
    require('../../assets/art/snowflake-1.png'),
    require('../../assets/art/snowflake-2.png'),
    require('../../assets/art/snowflake-3.png'),
    require('../../assets/art/snowflake-4.png'),
    require('../../assets/art/snowflake-5.png'),
  ],
  shop: require('../../assets/art/badge-shop.png'),
  add: require('../../assets/art/badge-add.png'),
  coins: {
    $: require('../../assets/art/coin-usd.png'),
    '€': require('../../assets/art/coin-eur.png'),
    '£': require('../../assets/art/coin-gbp.png'),
    '₦': require('../../assets/art/coin-ngn.png'),
  } as Record<string, number>,
  sparkles: {
    gold: require('../../assets/art/sparkle-4.png'),
    white: require('../../assets/art/sparkle-5.png'),
    orchid: require('../../assets/art/sparkle-8.png'),
    orange: require('../../assets/art/sparkle-11.png'),
  },
  faces: [
    require('../../assets/art/avatar-1.png'),
    require('../../assets/art/avatar-2.png'),
    require('../../assets/art/avatar-3.png'),
    require('../../assets/art/avatar-4.png'),
    require('../../assets/art/avatar-5.png'),
    require('../../assets/art/avatar-6.png'),
    require('../../assets/art/avatar-7.png'),
  ],
}

function Art({ source, width, height }: { source: number; width: number; height: number }) {
  return <Image source={source} style={{ width, height }} contentFit="contain" accessible={false} />
}

export type KoviPose = keyof typeof art.kovi

/** Kovi in a square box of `size` points. Every pose is painted on the same 1024 canvas. */
export function Kovi({ pose = 'wave', size = 120 }: { pose?: KoviPose; size?: number }) {
  return <Art source={art.kovi[pose]} width={size} height={size} />
}

/** Where the bottom of Kovi's shoes sits in each pose, as a fraction of his box. */
const FEET: Record<KoviPose, number> = {
  wave: 981,
  cheer: 934,
  catch: 897,
  key: 984,
  sleep: 790,
  ride: 806,
  oops: 961,
}
export const koviFeet = (pose: KoviPose) => FEET[pose] / 1024

/** Kovi riding his paper plane, facing right so a flight path can steer him. */
export function Flyer({ size = 120 }: { size?: number }) {
  return <Art source={art.kovi.ride} width={size} height={size} />
}

/** Kovi peeking over an edge. The edge line sits `peekEdge` of the way down the image. */
export function KoviPeek({ width = 150 }: { width?: number }) {
  return <Art source={art.peek} width={width} height={width / 2} />
}
export const peekEdge = 398 / 512

export function Coin({ size = 44, symbol = '$' }: { size?: number; symbol?: string }) {
  return <Art source={art.coins[symbol] ?? art.coins.$} width={size} height={size} />
}

/** A painted sparkle. `fill` picks the nearest of the painted colours. */
export function Sparkle({ size = 28, fill = colors.yellow }: { size?: number; fill?: string }) {
  const key =
    fill === colors.white || fill === colors.surface
      ? 'white'
      : fill === colors.coral || fill === colors.coralDeep
        ? 'orange'
        : fill === colors.coralSoft && fill !== colors.yellow
          ? 'orchid'
          : 'gold'
  return <Art source={art.sparkles[key]} width={size} height={size} />
}

export function Plane({ size = 64 }: { size?: number }) {
  return <Art source={art.plane} width={size} height={size} />
}

export function Snowflakes({ width = 200 }: { width?: number }) {
  return <Art source={art.snowflakes} width={width} height={width / 4} />
}

/** One snowflake from the painted set; `i` picks which. */
export function Flake({ i = 0, size = 18 }: { i?: number; size?: number }) {
  return <Art source={art.flakes[i % art.flakes.length]} width={size} height={size} />
}

type Point = { x: number; y: number }
type Route = { from: Point; via: Point; to: Point }

/**
 * Welcome: a little planet with a shop and a home, and a dotted route between them. The
 * route is fitted to the painted dots, so Kovi's flight follows them.
 */
export const welcomeScene = {
  aspect: 960 / 1170,
  route(width: number, top: number): Route {
    const s = width / 1170
    return {
      from: { x: 323 * s, y: top + 471 * s },
      via: { x: 593 * s, y: top + 284 * s },
      to: { x: 863 * s, y: top + 492 * s },
    }
  },
}
export function PlanetScene({ width }: { width: number }) {
  return <Art source={art.welcome} width={width} height={width * welcomeScene.aspect} />
}

/** Send: two skylines and the dotted route between them, fitted to the painted dots. */
export const sendScene = {
  aspect: 510 / 1026,
  route(width: number, left: number, top: number): Route {
    const s = width / 1026
    return {
      from: { x: left + 150 * s, y: top + 254 * s },
      via: { x: left + 521 * s, y: top - 98 * s },
      to: { x: left + 891 * s, y: top + 265 * s },
    }
  },
}
export function CitiesScene({ width }: { width: number }) {
  return <Art source={art.send} width={width} height={width * sendScene.aspect} />
}

/** Face ID setup: Kovi inside the scan frame, holding up the key to the wallet. */
export function KeyScene({ size = 300 }: { size?: number }) {
  return <Art source={art.faceid} width={size} height={(size * 900) / 1080} />
}

/**
 * Paid: the terminal printing a receipt, with the amount set on the receipt's blank lower half.
 * `top` is the receipt's top edge, where Kovi stands.
 */
export const receipt = { top: 34 / 750, amountY: 219 / 750, left: 277 / 720, width: 165 / 720 }
export function ReceiptTerminal({ amount, width = 240 }: { amount: string; width?: number }) {
  const height = (width * 750) / 720
  return (
    <View style={{ width, height }}>
      <Art source={art.terminal} width={width} height={height} />
      <View
        style={{
          position: 'absolute',
          top: height * receipt.amountY - 16,
          left: width * receipt.left,
          width: width * receipt.width,
          alignItems: 'center',
        }}
      >
        <Txt weight="bold" size={Math.round(width / 26)} color={colors.ink}>
          PAID
        </Txt>
        <Txt
          weight="bold"
          size={Math.round(width / 18)}
          numberOfLines={1}
          adjustsFontSizeToFit
          color={colors.ink}
        >
          {amount}
        </Txt>
      </View>
    </View>
  )
}

/**
 * The Kova Card, with the wordmark and number set by the app. `width` is the card body's width.
 * Frozen, it is the frosted card with Kovi asleep on top; the painted card bodies were
 * measured so text lands on them.
 */
export function CardArt({
  width = 300,
  last4,
  frozen,
}: {
  width?: number
  last4: string
  frozen?: boolean
}) {
  if (frozen) {
    // Frosted card: body 749×355 at (225, 349) inside a 1200×760 image, Kovi and snow above.
    const bodyW = width * 0.84
    const s = bodyW / 749
    const left = (width - bodyW) / 2
    return (
      <View style={{ width, height: 720 * s }}>
        <View style={{ position: 'absolute', left: left - 225 * s, top: 0 }}>
          <Art source={art.cardFrozen} width={1200 * s} height={760 * s} />
        </View>
        <Txt
          weight="semi"
          size={Math.round(bodyW * 0.052)}
          style={{
            position: 'absolute',
            left: left + 48 * s,
            top: (704 - 78) * s,
            letterSpacing: 3,
          }}
        >
          •••• {last4}
        </Txt>
      </View>
    )
  }
  // Normal card: body 1092×638 at (54, 126) inside a 1200×900 image.
  const s = width / 1092
  return (
    <View style={{ width, height: 638 * s }}>
      <View style={{ position: 'absolute', left: -54 * s, top: -126 * s }}>
        <Art source={art.cardActive} width={1200 * s} height={900 * s} />
      </View>
      <View style={{ position: 'absolute', left: 76 * s, top: 70 * s }}>
        <Wordmark height={Math.round(width * 0.085)} coin={colors.yellow} />
      </View>
      <Txt
        weight="semi"
        size={Math.round(width * 0.058)}
        style={{
          position: 'absolute',
          left: 76 * s,
          top: 638 * s - width * 0.14,
          letterSpacing: 3,
        }}
      >
        •••• {last4}
      </Txt>
    </View>
  )
}

/** FNV-1a: spreads similar strings (like two 0x addresses) evenly across the faces. */
function hash(text: string) {
  let h = 0x811c9dc5
  for (const c of text.toLowerCase()) {
    h ^= c.charCodeAt(0)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

/**
 * A friendly face for a person. Picked from their wallet address when there is one (so the
 * same person always looks the same, whatever they are called), else from their name.
 */
export function Avatar({ name, id, size = 56 }: { name: string; id?: string; size?: number }) {
  return (
    <Art
      source={art.faces[hash(id || name || '?') % art.faces.length]}
      width={size}
      height={size}
    />
  )
}

/** A merchant's badge: a little shop front, for payments to businesses. */
export function ShopBadge({ size = 44 }: { size?: number; fill?: string }) {
  return <Art source={art.shop} width={size} height={size} />
}

/** Money added from outside, like a faucet or a top-up. */
export function AddBadge({ size = 44 }: { size?: number }) {
  return <Art source={art.add} width={size} height={size} />
}
