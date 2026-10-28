/**
 * The Kova Card's face: one of the six Kova card designs (rendered from the design canvas by
 * film/scripts/card-faces.mjs), with the holder's name written live where the design puts it,
 * and frost with a lock when the card is frozen.
 */
import { type ColorValue, Image, Pressable, ScrollView, View } from 'react-native'
import { colors } from '@/lib/theme'
import faces from '../../assets/cards/faces.json'
import { Icon } from './Icon'
import { Txt } from './primitives'

export const CARD_DESIGNS = ['main', 'coral', 'metal', 'drop', 'night', 'open'] as const
export type CardDesign = (typeof CARD_DESIGNS)[number]

export const DESIGN_NAMES: Record<CardDesign, string> = {
  main: 'The shop',
  coral: 'Hot Coral',
  metal: 'Ink metal',
  drop: 'Kovi’s Day',
  night: 'Chalkboard',
  open: 'OPEN Singapore',
}

const IMAGES: Record<CardDesign, number> = {
  main: require('../../assets/cards/main.png'),
  coral: require('../../assets/cards/coral.png'),
  metal: require('../../assets/cards/metal.png'),
  drop: require('../../assets/cards/drop.png'),
  night: require('../../assets/cards/night.png'),
  open: require('../../assets/cards/open.png'),
}

type Slot = {
  x: number
  y: number
  w: number
  h: number
  size: number
  weight: string
  color: ColorValue
  letterSpacing: number
}
type Face = { w: number; h: number; name: Slot | null }

/** The face fits a box: portrait designs stand inside it, landscape ones fill its width. */
export function cardSize(design: CardDesign, boxW: number, boxH = boxW * 0.9) {
  const f = (faces as Record<CardDesign, Face>)[design]
  const k = Math.min(boxW / f.w, boxH / f.h)
  return { width: f.w * k, height: f.h * k, k }
}

export function CardFace({
  design = 'main',
  boxW,
  boxH,
  name,
  frozen,
}: {
  design?: CardDesign
  boxW: number
  boxH?: number
  name?: string
  frozen?: boolean
}) {
  const f = (faces as Record<CardDesign, Face>)[design]
  const { width, height, k } = cardSize(design, boxW, boxH)
  const slot = f.name
  return (
    <View
      style={{ width, height, borderRadius: 40 * k, overflow: 'hidden' }}
      accessibilityRole="image"
      accessibilityLabel={`Kova Card, ${DESIGN_NAMES[design]}${frozen ? ', frozen' : ''}`}
    >
      <Image source={IMAGES[design]} style={{ width, height }} />
      {slot && name ? (
        <Txt
          weight="bold"
          exact
          numberOfLines={1}
          adjustsFontSizeToFit
          size={slot.size * k}
          color={slot.color}
          style={{
            position: 'absolute',
            left: slot.x * k,
            top: slot.y * k,
            maxWidth: (f.w - slot.x - 40) * k,
            letterSpacing: slot.letterSpacing * k,
          }}
        >
          {name.toUpperCase()}
        </Txt>
      ) : null}
      {frozen ? (
        <View
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: 'rgba(214, 232, 244, 0.72)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              backgroundColor: colors.fill,
              borderRadius: 999,
              paddingHorizontal: 16,
              paddingVertical: 8,
            }}
          >
            <Icon name="snow" size={16} color={colors.white} />
            <Txt weight="bold" size={15} color={colors.white}>
              Frozen
            </Txt>
          </View>
        </View>
      ) : null}
    </View>
  )
}

/** Six small faces to choose from. */
export function CardDesignPicker({
  value,
  onChange,
}: {
  value: CardDesign
  onChange: (d: CardDesign) => void
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 10, paddingHorizontal: 24 }}
    >
      {CARD_DESIGNS.map((d) => {
        const on = d === value
        return (
          <Pressable
            key={d}
            onPress={() => onChange(d)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={DESIGN_NAMES[d]}
            style={{
              alignItems: 'center',
              gap: 4,
              padding: 4,
              borderRadius: 12,
              borderWidth: 2,
              borderColor: on ? colors.ink : 'transparent',
            }}
          >
            <View style={{ width: 84, height: 54, alignItems: 'center', justifyContent: 'center' }}>
              <CardFace design={d} boxW={84} boxH={54} />
            </View>
            <Txt size={11} weight={on ? 'bold' : 'medium'} color={on ? colors.ink : colors.muted}>
              {DESIGN_NAMES[d]}
            </Txt>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}
