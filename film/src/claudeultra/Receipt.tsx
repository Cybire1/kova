/** The merchant's own receipt, between Claude's "plan active" and the Kova ending: $119.96, •••• 3421. */
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from 'remotion'
import { FPS, presenceStyle, rise } from '../motion'

export const RECEIPT_DURATION = 2.4
const W = 960
const H = Math.round((W * 325) / 1057)

export function Receipt() {
  const t = useCurrentFrame() / FPS
  return (
    <AbsoluteFill style={{ background: '#161616' }}>
      <div style={{ position: 'absolute', left: (1080 - W) / 2, top: (1080 - H) / 2, width: W, height: H, ...presenceStyle(rise(t, 0.05, undefined, 40)) }}>
        <Img src={staticFile('claudeultra/receipt.png')} style={{ width: W, height: H, display: 'block' }} />
      </div>
    </AbsoluteFill>
  )
}
