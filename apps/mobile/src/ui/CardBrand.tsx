import Svg, { Circle, Path } from 'react-native-svg'

/**
 * The card network's mark on a dollar card: Mastercard's two overlapping circles, red and yellow
 * with the orange where they meet. Drawn, not an image, so it's sharp at any size. Other brands
 * show nothing rather than a guess.
 */
export function CardBrand({ brand, width = 38 }: { brand?: string; width?: number }) {
  if (brand !== 'mastercard') return null
  return (
    <Svg
      width={width}
      height={(width * 24) / 38}
      viewBox="0 0 38 24"
      accessibilityRole="image"
      accessibilityLabel="Mastercard"
    >
      <Circle cx={12} cy={12} r={12} fill="#EB001B" />
      <Circle cx={26} cy={12} r={12} fill="#F79E1B" />
      <Path d="M19 2.25A12 12 0 0 1 19 21.75A12 12 0 0 1 19 2.25Z" fill="#FF5F00" />
    </Svg>
  )
}
