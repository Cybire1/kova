// Voice for "Dollars for every phone", two sends (KovaOfflineFilm), ElevenLabs eleven_v4, the demo's voice.
// One request per line with its neighbours as context; word timings from the character alignment.
// Run: env -u ELEVENLABS_API_KEY node --env-file=.env scripts/kovaoffline/vo.mjs
import { writeFileSync } from 'node:fs'
const voice = 'JBFqnCBsd6RMkjVDRZzb'
const lines = [
  ['hook', 'This phone has no apps, and no internet. Watch it get paid. Twice.'],
  ['send1', 'With Kova, you send dollars to a phone number. Three dollars, with a note.'],
  ['text1', 'Their phone gets a text. The three dollars are in their Kova pocket.'],
  ['send2', 'Then one more dollar. It settles on Monad in about a second.'],
  ['text2', 'Another text. Their pocket is now nine twenty-five.'],
  ['dial', 'To check it or spend it, they dial a short code, and enter their PIN.'],
  ['proof', 'Both payments, on Monad.'],
  ['close', 'No app. No data. Dollars for every phone. That’s Kova.'],
]
const out = []
for (let i = 0; i < lines.length; i++) {
  const [id, text] = lines[i]
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: 'eleven_v4',
      previous_text: lines[i - 1]?.[1],
      next_text: lines[i + 1]?.[1],
      voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.3, use_speaker_boost: true },
    }),
  })
  if (!res.ok) throw new Error(`${id}: ${res.status} ${await res.text()}`)
  const j = await res.json()
  writeFileSync(`public/kovaoffline/vo-${id}.mp3`, Buffer.from(j.audio_base64, 'base64'))
  const a = j.alignment
  const words = []
  let cur = null
  a.characters.forEach((ch, k) => {
    if (/\s/.test(ch)) { if (cur) { words.push(cur); cur = null } return }
    if (!cur) cur = { text: '', start: a.character_start_times_seconds[k], end: 0 }
    cur.text += ch
    cur.end = a.character_end_times_seconds[k]
  })
  if (cur) words.push(cur)
  out.push({ id, text, duration: a.character_end_times_seconds.at(-1), words })
  console.log(id, out.at(-1).duration.toFixed(2), 's')
}
writeFileSync('src/kovaoffline/vo.json', JSON.stringify({ lines: out }, null, 1))
