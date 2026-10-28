import { type ColorValue, DynamicColorIOS, Platform, Settings } from 'react-native'

/**
 * Kova's visual system: warm paper, one deep teal-black ink, and three colours that each
 * mean something.
 *
 * Every surface is flat, drawn with a 2px ink outline and no shadows. Teal is money at rest
 * and arriving, coral is paying and anything that spends, yellow is Kovi and the coins.
 *
 * In the dark (the phone's setting, or Appearance on You) it's the same system on black, as on
 * mykova.app: warm cream text, grey cards standing off the black with no outlines, coral and teal
 * lifted a step so they hold their contrast. Ink has three jobs, split so the dark can tell them
 * apart: text (`ink`), outlines (`line`) and dark surfaces (`fill`); in light they're all ink.
 */
const light = {
  /** The ground every screen sits on. */
  paper: '#E7E5E0',
  /** Cards, keys and inputs: a shade lighter than the ground. */
  surface: '#F1EFEA',
  /** Recessed areas: chips, input fills, frozen things. */
  sunken: '#DEDCD8',
  /** Text and icons on paper and cards. */
  ink: '#0B1A1D',
  /** Outlines: the 2px edge of cards, stickers and fields. Gone in the dark. */
  line: '#0B1A1D',
  /** An outline that is the whole control (an empty field, a dashed "new"): still there in the dark. */
  edge: '#0B1A1D',
  /** Dark surfaces: the Pay card, the dock, black pills. */
  fill: '#0B1A1D',
  /** Light text and icons on a dark surface. */
  onFill: '#F1EFEA',
  /** The chosen chip, segment, day or dot: ink, and cream in the dark so it still stands out. */
  chosen: '#0B1A1D',
  /** Text and icons on a chosen chip. */
  onChosen: '#FFFFFF',
  /** Text on bright colours (coral, teal, the coins, white), dark in either appearance. */
  dark: '#0B1A1D',
  teal: '#46878B',
  tealDeep: '#376B70',
  /** Teal grounds that carry ink text. */
  tealSoft: '#A9C9C9',
  tealLight: '#8FB9BB',
  /** The pay colour: the Pay button, its pulse, and every action that spends. */
  coral: '#D46558',
  coralDeep: '#A94B40',
  /** Coral grounds that carry ink text. */
  coralSoft: '#EBB3AA',
  /** The coin colour: Kovi, the coins, the card chip. Soft coral, a quieter echo of the pay colour. */
  yellow: '#EBB3AA',
  blush: '#E8A89C',
  /** Text and icons on ink or coral. */
  white: '#FFFFFF',
  muted: '#566568',
  /** Secondary text on tinted grounds; plain muted grey is too faint there. */
  onTint: '#1F3438',
  /** Secondary text on ink. */
  onInk: '#A7B8B9',
  positive: '#2E7268',
  danger: '#B03E32',
  /** White that lifts off a card: fields, the chosen tile, a filled stamp. Grey in the dark. */
  raised: '#FFFFFF',
  /** A faint ink wash: round buttons, pressed rows. */
  wash: 'rgba(11,26,29,0.07)',
  /** Hairlines and dividers. */
  rule: 'rgba(11,26,29,0.16)',
} as const

type Name = keyof typeof light

const dark: Record<Name, string> = {
  paper: '#000000',
  surface: '#161616',
  sunken: '#222222',
  ink: '#E9E5DD',
  line: 'transparent',
  edge: '#2E2E2E',
  fill: '#1B1B1B',
  onFill: '#E9E5DD',
  chosen: '#E9E5DD',
  onChosen: '#0B1A1D',
  dark: '#0B1A1D',
  teal: '#5FA5A9',
  tealDeep: '#4B9095',
  tealSoft: '#1B1B1B',
  tealLight: '#22302F',
  coral: '#E1705F',
  coralDeep: '#B9564A',
  coralSoft: '#2A1714',
  yellow: '#EBB3AA',
  blush: '#E8A89C',
  white: '#FFFFFF',
  muted: '#8F8B85',
  onTint: '#B3B0AA',
  onInk: '#B3B0AA',
  positive: '#5CB6A8',
  danger: '#E8705F',
  raised: '#262626',
  wash: 'rgba(236,232,223,0.1)',
  rule: 'rgba(236,232,223,0.14)',
}

/** Where Appearance on You keeps its choice (iOS user defaults, readable before any style is made). */
export const LOOK_KEY = 'KovaLook'

/**
 * Light or dark, if chosen on You; null follows the phone. Read once, as the app starts: a choice
 * draws every colour plain for that look, so nothing depends on the phone's setting (React Native
 * resolves border colours against the phone's appearance, not the screen's, so dynamic colours
 * under a chosen look would leave some edges in the other one). Changing it reloads the app.
 */
export const chosenLook: 'light' | 'dark' | null = (() => {
  if (Platform.OS !== 'ios') return null
  const saved = Settings.get(LOOK_KEY)
  return saved === 'light' || saved === 'dark' ? saved : null
})()

/** A colour in each look. Following the phone, it's an iOS dynamic colour, resolved against each
 * screen's own appearance, so module-level styles follow light and dark with no re-render. Under
 * a chosen look it's that look's plain colour; on Android, the light one. Also for the few one-off
 * colours outside the palette. */
export function pair(lightValue: string, darkValue: string): ColorValue {
  if (chosenLook) return chosenLook === 'dark' ? darkValue : lightValue
  return Platform.OS === 'ios'
    ? DynamicColorIOS({ light: lightValue, dark: darkValue })
    : lightValue
}

export const colors = Object.fromEntries(
  (Object.keys(light) as Name[]).map((name) => [name, pair(light[name], dark[name])]),
) as Record<Name, ColorValue>

/** The plain values, for the few things that need a string (QR codes, gradients) and resolve the
 * appearance themselves with `useColorScheme`. */
export const palette = { light, dark } as const

/** Ink at `alpha` (shadows of the ink on paper), or the cream at `alpha` in the dark. */
export function inkAt(alpha: number): ColorValue {
  return pair(`rgba(11,26,29,${alpha})`, `rgba(236,232,223,${alpha})`)
}

/** Manrope: a calm, open grotesk with even figures, so amounts read cleanly. */
/**
 * The whole app is drawn a step smaller than the sizes written in each screen: text by 8%,
 * icons by 12%. One place to tune how dense Kova feels.
 */
export const density = { text: 0.92, icon: 0.88 } as const

export const fonts = {
  regular: 'Manrope_400Regular',
  medium: 'Manrope_500Medium',
  semi: 'Manrope_600SemiBold',
  bold: 'Manrope_700Bold',
} as const
