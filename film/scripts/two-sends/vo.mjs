// The two-sends film's voice: one line per caption beat, ElevenLabs Eleven v4, the demo film's narrator.
//   cd film && node --env-file=.env scripts/two-sends/vo.mjs [id …]
// With ids, only those lines are spoken again; the others keep their takes.
// Writes public/two-sends/vo/<id>.mp3 and src/two-sends/vo.json ({ id, at, text, dur }), which the film
// reads to place each line and duck the score under it. `at` is the frame the line starts on, and `to`
// the frame it must end by (the next caption beat).
import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'

const VOICE = 'JBFqnCBsd6RMkjVDRZzb'
const MODEL = 'eleven_v4'
const FPS = 30

// Frames are on the film's timeline (src/two-sends/TwoSendsFilm.tsx: CAPTIONS, REVEAL_AT, END_AT).
const LINES = [
  {
    id: 'hook',
    at: 6,
    to: 160,
    text: 'Ada pays Sam privately, twice. Watch where the money lands.',
  },
  { id: 'switch', at: 166, to: 288, text: 'One switch: send privately.' },
  {
    id: 'sent1',
    at: 292,
    to: 445,
    text: 'Sent in about a second, and Sam’s phone knows it’s from Ada.',
  },
  {
    id: 'sees1',
    at: 450,
    to: 600,
    text: 'But on Monad, it went to an address made for this one payment.',
  },
  { id: 'scan1', at: 604, to: 755, text: 'No Sam anywhere, and only Sam’s keys can open it.' },
  { id: 'start2', at: 758, to: 900, text: 'Payment two: same Ada, same Sam, same switch.' },
  { id: 'sent2', at: 902, to: 988, text: 'Sent, in under a second.' },
  { id: 'sees2', at: 992, to: 1142, text: 'This time, it went to a completely different address.' },
  { id: 'erc', at: 1142, to: 1240, text: 'And Sam’s phone still finds it.' },
  {
    id: 'reveal',
    at: 1240,
    to: 1446,
    text: 'Two payments. Two addresses. Both Sam’s. And only Sam can move them.',
  },
  { id: 'end', at: 1450, to: 1530, text: 'Send privately, with Kova.' },
]

mkdirSync('public/two-sends/vo', { recursive: true })

async function speak(line, i, stitched) {
  const body = {
    text: line.text,
    model_id: MODEL,
    voice_settings: { stability: 0.5, similarity_boost: 0.8, use_speaker_boost: true },
  }
  if (stitched) {
    if (i > 0) body.previous_text = LINES[i - 1].text
    if (i < LINES.length - 1) body.next_text = LINES[i + 1].text
  }
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  if (!res.ok) return { error: `${res.status} ${await res.text()}` }
  return { audio: Buffer.from(await res.arrayBuffer()) }
}

const only = process.argv.slice(2)
const out = []
let stitched = true
for (let i = 0; i < LINES.length; i++) {
  const line = LINES[i]
  const file = `public/two-sends/vo/${line.id}.mp3`
  const seconds = () =>
    Number(
      execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 ${file}`)
        .toString()
        .trim(),
    )
  if (only.length && !only.includes(line.id)) {
    out.push({
      id: line.id,
      at: line.at,
      to: line.to,
      text: line.text,
      dur: Math.round(seconds() * 1000) / 1000,
    })
    continue
  }
  let r = await speak(line, i, stitched)
  if (r.error && stitched && /previous_text|next_text|stitch/i.test(r.error)) {
    console.log(`${line.id}: with neighbouring text → ${r.error.slice(0, 160)}; retrying without`)
    stitched = false
    r = await speak(line, i, false)
  }
  if (r.error) throw new Error(`${line.id}: ${r.error}`)
  writeFileSync(file, r.audio)
  const dur = seconds()
  const room = (line.to - line.at) / FPS
  out.push({
    id: line.id,
    at: line.at,
    to: line.to,
    text: line.text,
    dur: Math.round(dur * 1000) / 1000,
  })
  console.log(
    `${line.id.padEnd(7)} ${dur.toFixed(2)} s of ${room.toFixed(2)} s${dur > room ? '  ← too long' : ''}`,
  )
}
writeFileSync('src/two-sends/vo.json', `${JSON.stringify(out, null, 2)}\n`)
