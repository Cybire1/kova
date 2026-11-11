// Voiceover for "Credit alert" (cashing out to naira): one ElevenLabs request per line, with
// character timings turned into word timings for the captions. Every number is the real cash-out's
// of 27 Oct 2026: $2 → ₦2,752.94, paid 10.7 s after its Monad transaction ("Done in 11 seconds").
// Run: node --env-file=.env scripts/voiceover-naira.mjs [voiceId] [outDir]
// Writes <outDir>/vo-<n>.mp3 and <outDir>/vo.json (durations and words, in seconds).
import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'

export const LINES = [
  { id: 'alert', say: 'Credit alert.' },
  {
    id: 'before',
    say: 'Eleven seconds earlier, this was two dollars in a Kova wallet.',
    show: [
      { spoken: ['eleven'], text: '11' },
      { spoken: ['two', 'dollars'], text: '$2' },
    ],
  },
  { id: 'amount', say: 'Type the dollars. See the naira.' },
  { id: 'bank', say: 'Type the account number. Pick the bank. Kova checks the name.' },
  { id: 'send', say: 'No fees. No crypto to buy first.' },
  { id: 'moves', say: 'Monad moves the dollars. The naira lands in the bank.' },
  { id: 'done', say: 'Done in eleven seconds.', show: [{ spoken: ['eleven'], text: '11' }] },
  {
    id: 'end',
    say: 'Kova. Dollars to any Nigerian bank. Try it at my kova dot app.',
    show: [{ spoken: ['my', 'kova', 'dot', 'app'], text: 'mykova.app' }],
  },
]

// Sarah: warm and clear (premade). George (JBFqnCBsd6RMkjVDRZzb) read the first cut.
const voiceId = process.argv[2] ?? 'EXAVITQu4vr4xnSDxMaL'
const outDir = process.argv[3] ?? 'public/credit-alert/audio'
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
