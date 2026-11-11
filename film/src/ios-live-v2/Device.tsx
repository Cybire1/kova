import type { CSSProperties, ReactNode } from 'react'
import { Img, staticFile } from 'remotion'

/** Native frame pixels. The screen image retains its own aspect ratio. */
export const DEVICE = {
  w: 1311, h: 2708,
  screen: { x: 54, y: 44, w: 1204, h: 2620, r: 176 },
  image: { w: 1179, h: 2556 },
}

export function Device({ x, y, h, screen = 'private/sam/01-home-before.png', frame = 'ios-live-v2/device-frame.png', children, style }: {
  x: number; y: number; h: number; screen?: string | null; frame?: string; children?: ReactNode; style?: CSSProperties
}) {
  const scale = h / DEVICE.h
  const innerScale = DEVICE.screen.w / DEVICE.image.w
  const innerH = DEVICE.image.h * innerScale
  return <div style={{ position: 'absolute', left: x - DEVICE.w * scale / 2, top: y - h / 2, width: DEVICE.w * scale, height: h, ...style }}>
    <div style={{ width: DEVICE.w * scale, height: h, position: 'absolute' }}>
      <div style={{ position: 'absolute', left: 38 * scale, right: 38 * scale, top: 20 * scale, bottom: 20 * scale, borderRadius: 205 * scale, background: '#0b1a1d', boxShadow: `0 ${22 * scale}px ${32 * scale}px rgba(24,28,25,.16), 0 ${80 * scale}px ${160 * scale}px ${-60 * scale}px rgba(24,28,25,.26)` }} />
      <div style={{ position: 'absolute', left: DEVICE.screen.x * scale, top: DEVICE.screen.y * scale, width: DEVICE.screen.w * scale, height: DEVICE.screen.h * scale, borderRadius: DEVICE.screen.r * scale, overflow: 'hidden', background: screen ? '#e7e5e0' : '#0b1a1d' }}>
        {screen ? <>
          <Img src={staticFile(screen)} style={{ position: 'absolute', width: DEVICE.screen.w * scale, height: innerH * scale, left: 0, top: (DEVICE.screen.h - innerH) / 2 * scale }} />
          {/* The source capture includes its own hardware cutout. Clear only that cutout;
              the frame supplies the correctly positioned camera and sensor artwork. */}
          <div style={{ position: 'absolute', left: 392 * innerScale * scale, top: ((DEVICE.screen.h - innerH) / 2 + 25 * innerScale) * scale, width: 400 * innerScale * scale, height: 127 * innerScale * scale, background: '#e7e5e0' }} />
        </> : null}
        {children ? <div style={{ position: 'absolute', width: DEVICE.screen.w, height: DEVICE.screen.h, transform: `scale(${scale})`, transformOrigin: 'top left' }}>{children}</div> : null}
      </div>
      <Img src={staticFile(frame)} style={{ position: 'absolute', inset: 0, width: DEVICE.w * scale, height: h }} />
    </div>
  </div>
}
