/**
 * The numbers flyer in the mainnet flyer's look ("Kova is open", the Design canvas of 11 Oct): teal
 * ground, a cream shop sign with a thick ink border and a hard ink shadow, hung from a gold pin and
 * swung a little, Kovi peeking over its top. The sign now says how many times Kova has been paid.
 * Landscape for X (1600 x 900). Numbers are props from the live API; they count wallets, not people.
 */
import type React from 'react'
import { useEffect, useState } from 'react'
import { AbsoluteFill, continueRender, delayRender, Img, staticFile } from 'remotion'
import { fontsReady } from '../theme'

const INK = '#0B1A1D'
const CARD = '#F1EFEA'
const GOLD = '#E8C15A'
const CORAL = '#D46558'

export interface SignProps {
  payments: number
  wallets: number
  shops: number
  volume: string
  ground: string
  swing: number
}

const chip: React.CSSProperties = {
  boxSizing: 'border-box',
  padding: '18px 22px 16px',
  borderRadius: 22,
  background: CARD,
  border: `5px solid ${INK}`,
}

function Chip({ value, label, color = INK }: { value: string; label: string; color?: string }) {
  return (
    <div style={chip}>
      <div style={{ fontSize: 46, fontWeight: 800, letterSpacing: -1.5, lineHeight: 1, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: '#3D4C4F', marginTop: 8 }}>{label}</div>
    </div>
  )
}

export function StatsSign({ payments = 230, wallets = 108, shops = 18, volume = '1651.70', ground = '#A9C9C9', swing = 2 }: Partial<SignProps>) {
  const [handle] = useState(() => delayRender('fonts'))
  useEffect(() => {
    fontsReady.then(() => continueRender(handle))
  }, [handle])
  const dollars = `$${Number(volume).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  return (
    <AbsoluteFill style={{ background: ground, fontFamily: 'Manrope', color: INK, overflow: 'hidden' }}>
      <Img src={staticFile('art/kova-logo.png')} style={{ position: 'absolute', left: 96, top: 92, height: 56 }} />
      <h1 style={{ position: 'absolute', left: 98, top: 196, width: 640, margin: 0, fontSize: 92, lineHeight: 0.95, letterSpacing: -4, fontWeight: 800 }}>
        {wallets} wallets.
        <br />
        {shops} shops.
      </h1>
      <div style={{ position: 'absolute', left: 98, top: 420, width: 600, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 26 }}>
        <Chip value={dollars} label="test dollars paid" />
        <Chip value="$0.00" label="card fees" color={CORAL} />
      </div>
      <p style={{ position: 'absolute', left: 98, top: 612, width: 600, margin: 0, fontSize: 30, lineHeight: 1.3, fontWeight: 700 }}>
        Tap to pay. Paid in about a second.
        <br />
        Testnet numbers. Kova is live on mainnet.
      </p>
      <div style={{ position: 'absolute', left: 96, bottom: 96, display: 'flex', alignItems: 'center', height: 86, padding: '0 38px', borderRadius: 43, background: INK, color: CARD, fontSize: 38, fontWeight: 800, letterSpacing: -1 }}>
        mykova.app/try
      </div>

      <div style={{ position: 'absolute', left: 760, top: 0, width: 760, height: 900, transformOrigin: '380px 60px', transform: `rotate(${swing}deg)` }}>
        <svg width={760} height={320} viewBox="0 0 760 320" style={{ position: 'absolute', left: 0, top: 0 }}>
          <path d="M380 60 L150 290 M380 60 L610 290" stroke={INK} strokeWidth={6} strokeLinecap="round" fill="none" />
          <circle cx={380} cy={60} r={15} fill={GOLD} stroke={INK} strokeWidth={6} />
        </svg>
        <Img src={staticFile('art/kovi-peek-sign.png')} style={{ position: 'absolute', left: 380, top: 86, width: 300 }} />
        <div style={{ position: 'absolute', left: 60, top: 278, width: 640, height: 480, boxSizing: 'border-box', padding: '44px 48px 40px', borderRadius: 34, background: CARD, border: `7px solid ${INK}`, boxShadow: `16px 16px 0 ${INK}`, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: 10, paddingLeft: 10 }}>KOVA GOT PAID</div>
          <div style={{ fontSize: 200, lineHeight: 0.86, fontWeight: 800, letterSpacing: -10, color: CORAL, marginTop: 14 }}>{payments}</div>
          <div style={{ width: '100%', borderTop: `5px dashed ${INK}`, margin: '28px 0 24px', opacity: 0.85 }} />
          <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: -1.2 }}>times on Monad</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: '#3D4C4F', marginTop: 8 }}>about a second each</div>
        </div>
      </div>
    </AbsoluteFill>
  )
}
