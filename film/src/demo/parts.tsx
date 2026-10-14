/**
 * Scene parts shared by the demo (DemoFilm2) and the Agora cut (agora/AgoraFilm), so the two films
 * stay in step: a phone playing a real screen recording (or holding one real frame), the words for a
 * scene, a live Monadscan page, a real terminal recording, and the end cards.
 */
import { loadFont } from '@remotion/fonts'
import { AbsoluteFill, Freeze, Img, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from 'remotion'
import { FPS } from '../motion'

export const C = { paper: '#E7E5E0', surface: '#F1EFEA', ink: '#0B1A1D', coral: '#D46558', teal: '#2F6669', muted: '#4A5A5C' }

export const manrope = Promise.all(
  [
    ['500', 'Manrope_500Medium'],
    ['600', 'Manrope_600SemiBold'],
    ['700', 'Manrope_700Bold'],
    ['800', 'Manrope_800ExtraBold'],
  ].map(([weight, file]) => loadFont({ family: 'Manrope', url: staticFile(`fonts/${file}.ttf`), weight })),
)

export const s = (seconds: number) => Math.round(seconds * FPS)

/** A phone: the screen recording at its own pixel size (394x854), in a dark bezel. `hold` keeps one real frame. */
export function Phone({ src, x, label, startFrom = 0, hold, rate = 1 }: { src: string; x: number; label?: string; startFrom?: number; hold?: number; rate?: number }) {
  const video = <OffthreadVideo src={staticFile(`demo/${src}.mp4`)} startFrom={s(startFrom)} playbackRate={rate} muted style={{ width: 394, height: 854, display: 'block' }} />
  return (
    <div style={{ position: 'absolute', left: x, top: 78, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
      <div style={{ background: C.ink, borderRadius: 66, padding: 12, boxShadow: '0 30px 60px rgba(11,26,29,0.22)' }}>
        <div style={{ width: 394, height: 854, borderRadius: 54, overflow: 'hidden', background: C.surface }}>
          {hold === undefined ? video : <Freeze frame={s(hold)}>{video}</Freeze>}
        </div>
      </div>
      {label ? <div style={{ fontFamily: 'Manrope', fontWeight: 700, fontSize: 26, color: C.muted, letterSpacing: 0.5 }}>{label}</div> : null}
    </div>
  )
}

/** The words for the scene: what it shows, the line being said, and the real numbers it produced. */
export function Panel({ eyebrow, text, chips = [], left, width }: { eyebrow: string; text: string; chips?: string[]; left: number; width: number }) {
  const frame = useCurrentFrame()
  const fade = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: 'clamp' })
  return (
    <div style={{ position: 'absolute', left, top: 0, bottom: 0, width, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 28, opacity: fade, fontFamily: 'Manrope' }}>
      <div style={{ fontWeight: 800, fontSize: 26, letterSpacing: 3, textTransform: 'uppercase', color: C.teal }}>{eyebrow}</div>
      <div style={{ fontWeight: 700, fontSize: 48, lineHeight: 1.22, color: C.ink, letterSpacing: -0.5 }}>{text}</div>
      {chips.length ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
          {chips.map((c) => (
            <div key={c} style={{ fontWeight: 800, fontSize: 30, color: C.ink, background: C.surface, border: `3px solid ${C.ink}`, borderRadius: 999, padding: '8px 24px' }}>{c}</div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** Panels that change with the voice: each line shows from its own second (relative to the scene). */
export function Lines({ items, left, width }: { items: { at: number; eyebrow: string; text: string; chips?: string[] }[]; left: number; width: number }) {
  return (
    <>
      {items.map((it, i) => (
        <Sequence key={it.text} from={s(it.at)} durationInFrames={i < items.length - 1 ? s((items[i + 1]?.at ?? 0) - it.at) : undefined}>
          <Panel left={left} width={width} eyebrow={it.eyebrow} text={it.text} chips={it.chips} />
        </Sequence>
      ))}
    </>
  )
}

/** A live explorer page, as captured, with what it proves in plain words over its footer. */
export function Explorer({ src, caption, network = 'Monad testnet' }: { src: string; caption: string; network?: string }) {
  return (
    <AbsoluteFill style={{ background: '#FFFFFF' }}>
      <Img src={staticFile(`demo/${src}.png`)} style={{ width: 1920, height: 1080 }} />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 132, background: C.ink, display: 'flex', alignItems: 'center', gap: 28, padding: '0 64px', fontFamily: 'Manrope' }}>
        <div style={{ fontWeight: 800, fontSize: 26, letterSpacing: 2.5, textTransform: 'uppercase', color: C.coral, whiteSpace: 'nowrap' }}>Monadscan · {network}</div>
        <div style={{ fontWeight: 700, fontSize: 36, color: C.surface, lineHeight: 1.2 }}>{caption}</div>
      </div>
    </AbsoluteFill>
  )
}

/** A real terminal recording (asciicast rendered by agg), full width on ink. */
export function TerminalVideo({ src }: { src: string }) {
  return (
    <AbsoluteFill style={{ background: C.ink }}>
      <div style={{ position: 'absolute', left: 3, top: 8, width: 1914, height: 1012 }}>
        <OffthreadVideo src={staticFile(`demo/${src}.mp4`)} muted style={{ width: 1914, height: 1012, display: 'block' }} />
      </div>
    </AbsoluteFill>
  )
}

/** The spoken line on a band across the bottom of a terminal, with the real numbers as chips. */
export function Band({ eyebrow, text, chips = [] }: { eyebrow: string; text: string; chips?: string[] }) {
  const frame = useCurrentFrame()
  const fade = interpolate(frame, [0, 6], [0, 1], { extrapolateRight: 'clamp' })
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, minHeight: 190, background: '#13272B', borderTop: `3px solid ${C.coral}`, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 14, padding: '22px 64px', fontFamily: 'Manrope', opacity: fade }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        <div style={{ fontWeight: 800, fontSize: 26, letterSpacing: 2.5, textTransform: 'uppercase', color: C.coral, whiteSpace: 'nowrap' }}>{eyebrow}</div>
        <div style={{ fontWeight: 700, fontSize: 36, color: C.surface, lineHeight: 1.25 }}>{text}</div>
      </div>
      {chips.length ? (
        <div style={{ display: 'flex', gap: 14 }}>
          {chips.map((c) => (
            <div key={c} style={{ fontWeight: 800, fontSize: 26, color: C.ink, background: C.surface, borderRadius: 999, padding: '6px 20px' }}>{c}</div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function Scene({ from, to, children }: { from: number; to: number; children: React.ReactNode }) {
  return (
    <Sequence from={s(from)} durationInFrames={s(to - from)}>
      <AbsoluteFill style={{ background: C.paper }}>{children}</AbsoluteFill>
    </Sequence>
  )
}

/** The close: the line, where to try it, and (optionally) a small line under it. */
export function EndCard({ title, foot }: { title: React.ReactNode; foot?: React.ReactNode }) {
  const frame = useCurrentFrame()
  const rise = interpolate(frame, [0, 12], [24, 0], { extrapolateRight: 'clamp' })
  return (
    <AbsoluteFill style={{ background: C.paper, alignItems: 'center', justifyContent: 'center', gap: 40, fontFamily: 'Manrope', transform: `translateY(${rise}px)` }}>
      <Img src={staticFile('demo/kova-lockup.svg')} style={{ width: 400, height: 130 }} />
      <div style={{ fontWeight: 800, fontSize: 88, color: C.ink, letterSpacing: -3, textAlign: 'center', lineHeight: 1.05 }}>{title}</div>
      <div style={{ display: 'flex', gap: 22 }}>
        <div style={{ fontWeight: 800, fontSize: 40, color: C.ink, background: C.coral, borderRadius: 999, padding: '14px 40px' }}>mykova.app/try</div>
        <div style={{ fontWeight: 700, fontSize: 40, color: C.ink, border: `3px solid ${C.ink}`, borderRadius: 999, padding: '11px 37px' }}>Live on Monad</div>
      </div>
      {foot ? <div style={{ fontWeight: 600, fontSize: 30, color: C.muted, textAlign: 'center', lineHeight: 1.4 }}>{foot}</div> : null}
    </AbsoluteFill>
  )
}

/**
 * A real Claude Code run, shown as its conversation: the prompt as typed, each Kova tool call in
 * plain words, Kova's reply as it came back, and Claude's summary, each appearing at the second it
 * appeared in the recorded terminal (demo/raw/agent3.cast), less a constant 0.5 s.
 */
export type ChatRow = { at: number; kind: 'call' | 'paid' | 'held' | 'claude'; text: string }
export function ChatTake({ prompt, rows, note }: { prompt: string; rows: ChatRow[]; note: string }) {
  const frame = useCurrentFrame()
  const shown = rows.filter((r) => frame >= s(r.at))
  const thinking = shown.length === 0 || shown[shown.length - 1]?.kind === 'call'
  const dot = Math.floor(frame / 8) % 4
  const icon = (kind: ChatRow['kind']) =>
    kind === 'paid' ? { bg: '#2F6669', fg: C.surface, t: '✓' } : kind === 'held' ? { bg: '#E8B04A', fg: C.ink, t: '…' } : kind === 'call' ? { bg: C.coral, fg: C.ink, t: 'K' } : { bg: C.ink, fg: C.surface, t: '✳' }
  return (
    <AbsoluteFill style={{ background: C.paper, alignItems: 'center', fontFamily: 'Manrope' }}>
      <div style={{ marginTop: 60, width: 1380, background: C.surface, borderRadius: 32, boxShadow: '0 24px 60px rgba(11,26,29,0.14)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '22px 36px', background: C.ink }}>
          <div style={{ fontWeight: 800, fontSize: 28, color: C.surface }}>Claude Code</div>
          <div style={{ fontWeight: 600, fontSize: 22, color: '#A9B8B8' }}>{note}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: '30px 36px 34px' }}>
          <div style={{ alignSelf: 'flex-end', maxWidth: 1060, background: C.ink, color: C.surface, borderRadius: 26, padding: '18px 26px', fontWeight: 600, fontSize: 30, lineHeight: 1.35 }}>{prompt}</div>
          {shown.map((r) => {
            const i = icon(r.kind)
            return (
              <div key={r.at} style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
                <div style={{ flex: 'none', width: 46, height: 46, borderRadius: 23, background: i.bg, color: i.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 24 }}>{i.t}</div>
                <div style={{ fontWeight: r.kind === 'call' ? 700 : 600, fontSize: r.kind === 'call' ? 28 : 30, color: r.kind === 'call' ? C.muted : C.ink, lineHeight: 1.35, paddingTop: 4 }}>{r.text}</div>
              </div>
            )
          })}
          {thinking ? <div style={{ fontWeight: 600, fontSize: 26, color: C.muted, paddingLeft: 64 }}>{shown.length ? 'Kova is paying' : 'Claude is working'}{'.'.repeat(dot)}</div> : null}
        </div>
      </div>
    </AbsoluteFill>
  )
}
