/**
 * The numbers flyer in the mainnet flyer's look ("Kova is open", the Design canvas of 11 Oct): teal
 * ground, a cream shop sign with a thick ink border and a hard ink shadow, hung from a gold pin and
 * swung a little, Kovi peeking over its top. The sign now says how many times Kova has been paid.
 * Landscape for X (1600 x 900). Numbers are props from the live API; they count wallets, not people.
 */
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

const MUTED = '#5B6A6D'

function Stat({ value, label, color = INK }: { value: string; label: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 44, fontWeight: 700, letterSpacing: -1.5, lineHeight: 1, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 20, fontWeight: 600, color: MUTED, marginTop: 10 }}>{label}</div>
    </div>
  )
}

export function StatsSign({ payments = 230, wallets = 108, shops = 18, volume = '1651.70', ground = '#E4E4DE', swing = 2 }: Partial<SignProps>) {
  const [handle] = useState(() => delayRender('fonts'))
  useEffect(() => {
    fontsReady.then(() => continueRender(handle))
  }, [handle])
  const dollars = `$${Number(volume).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  return (
    <AbsoluteFill style={{ background: ground, fontFamily: 'Manrope', color: INK, overflow: 'hidden' }}>
      <Img src={staticFile('art/kova-logo.png')} style={{ position: 'absolute', left: 96, top: 92, height: 46 }} />
      <h1 style={{ position: 'absolute', left: 98, top: 196, width: 640, margin: 0, fontSize: 92, lineHeight: 0.95, letterSpacing: -4, fontWeight: 700 }}>
        {wallets} wallets.
        <br />
        {shops} shops.
      </h1>
      <div style={{ position: 'absolute', left: 98, top: 420, width: 560, borderTop: '2px solid rgba(11,26,29,0.14)', paddingTop: 30, display: 'flex', gap: 72 }}>
        <Stat value={dollars} label="test dollars paid" />
        <Stat value="$0.00" label="card fees" color="#A94B40" />
      </div>
      <p style={{ position: 'absolute', left: 98, top: 584, width: 560, margin: 0, fontSize: 26, lineHeight: 1.4, fontWeight: 600, color: MUTED }}>
        Tap to pay. Paid in about a second.
      </p>
      <div style={{ position: 'absolute', left: 96, bottom: 156, display: 'flex', alignItems: 'center', gap: 14, height: 64, padding: '0 8px 0 30px', borderRadius: 32, background: INK, color: CARD, fontSize: 28, fontWeight: 700, letterSpacing: -0.5 }}>
        mykova.app/try
        <span style={{ width: 48, height: 48, borderRadius: 24, background: CARD, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </span>
      </div>
      <p style={{ position: 'absolute', left: 98, bottom: 114, margin: 0, fontSize: 18, fontWeight: 600, color: MUTED }}>Testnet numbers. Kova is live on Monad mainnet.</p>

      <div style={{ position: 'absolute', left: 760, top: 0, width: 760, height: 900, transformOrigin: '380px 60px', transform: `rotate(${swing}deg)` }}>
        <svg width={760} height={320} viewBox="0 0 760 320" style={{ position: 'absolute', left: 0, top: 0 }}>
          <path d="M380 60 L150 290 M380 60 L610 290" stroke={INK} strokeWidth={6} strokeLinecap="round" fill="none" />
          <circle cx={380} cy={60} r={15} fill={GOLD} stroke={INK} strokeWidth={6} />
        </svg>
        <Img src={staticFile('art/kovi-peek-sign.png')} style={{ position: 'absolute', left: 380, top: 86, width: 300 }} />
        <div style={{ position: 'absolute', left: 60, top: 278, width: 640, height: 480, boxSizing: 'border-box', padding: '44px 48px 40px', borderRadius: 34, background: CARD, border: `7px solid ${INK}`, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
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
