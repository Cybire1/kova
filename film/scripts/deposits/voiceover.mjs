// Voiceover for "Deposits" (Kova takes deposits from 53 networks): one ElevenLabs request per line,
// with character timings turned into word timings for the captions. Every claim is from a real run:
// 53 networks live on mainnet on 28 Oct 2026 (public/deposits/networks.json), and the $5 of USDC sent
// from Arc that day landed as $4.97 a second later (Relay request 0x1793196000…f6e8: Arc block
// 14:00:01 UTC, Monad block 14:00:02 UTC).
// Run: node --env-file=.env scripts/deposits/voiceover.mjs [voiceId] [outDir]
// Writes <outDir>/vo-<n>.mp3 and <outDir>/vo.json (durations and words, in seconds).
import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'

export const LINES = [
  {
    id: 'hook',
    say: 'Kova now takes deposits from fifty-three networks.',
    show: [{ spoken: ['fifty', 'three'], text: '53' }, { spoken: ['fiftythree'], text: '53' }],
  },
  {
    id: 'list',
    say: 'Base. Solana. Arbitrum. Tron. Bitcoin. And forty-eight more.',
    show: [{ spoken: ['forty', 'eight'], text: '48' }, { spoken: ['fortyeight'], text: '48' }],
  },
  { id: 'send', say: 'Send from any wallet.' },
  { id: 'this', say: 'This one: five dollars of USDC, on Arc.', show: [{ spoken: ['five', 'dollars'], text: '$5' }] },
  { id: 'lands', say: 'It lands in Kova as dollars, in about a second.' },
  {
    id: 'end',
    say: 'Kova. Try it at my kova dot app.',
    show: [{ spoken: ['my', 'kova', 'dot', 'app'], text: 'mykova.app' }],
  },
]

// Sarah: warm and clear (premade). George (JBFqnCBsd6RMkjVDRZzb) read the first cut.
const voiceId = process.argv[2] ?? 'EXAVITQu4vr4xnSDxMaL'
const outDir = process.argv[3] ?? 'public/deposits/audio'
const key = process.env.ELEVENLABS_API_KEY
if (!key) throw new Error('ELEVENLABS_API_KEY is missing (film/.env)')
mkdirSync(outDir, { recursive: true })

const duration = (file) =>
  Number(execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${file}"`).toString().trim())

/** Character timings to words: each word runs from its first letter to its last. */
function words(alignment, shows = []) {
  let out = []
  let current = null
  alignment.characters.forEach((ch, i) => {
    const start = alignment.character_start_times_seconds[i]
    const end = alignment.character_end_times_seconds[i]
    if (/\s/.test(ch)) {
      if (current) out.push(current)
      current = null
      return
    }
    if (!current) current = { text: '', start, end }
    current.text += ch
    current.end = end
  })
  if (current) out.push(current)
  // Swap a spoken run ("my kova dot app") for what the captions show ("mykova.app"), keeping the
  // run's punctuation ("dollars." → "$2.").
  const bare = (w) => w.text.replace(/[^a-z]/gi, '').toLowerCase()
  for (const show of shows) {
    const at = out.findIndex((_, i) => show.spoken.every((s, j) => out[i + j] && bare(out[i + j]) === s))
    if (at < 0) continue
    const last = out[at + show.spoken.length - 1]
    const tail = show.tail === false ? '' : last.text.match(/[^a-z0-9]*$/i)[0]
    out = [...out.slice(0, at), { text: show.text + tail, start: out[at].start, end: last.end }, ...out.slice(at + show.spoken.length)]
  }
  return out
}

const lines = []
for (const [i, line] of LINES.entries()) {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({
        text: line.say,
        model_id: process.env.ELEVENLABS_MODEL ?? 'eleven_v4',
        previous_text: LINES[i - 1]?.say,
        next_text: LINES[i + 1]?.say,
        voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true },
      }),
    },
  )
  if (!response.ok) throw new Error(`${line.id}: ${response.status} ${await response.text()}`)
  const body = await response.json()
  const file = `${outDir}/vo-${i + 1}.mp3`
  writeFileSync(file, Buffer.from(body.audio_base64, 'base64'))
  lines.push({ id: line.id, file: file.replace(/^public\//, ''), duration: duration(file), words: words(body.alignment, line.show) })
  console.log(`${line.id}: ${lines.at(-1).duration.toFixed(2)} s`)
}
writeFileSync(`${outDir}/vo.json`, JSON.stringify({ voiceId, lines }, null, 2))
