// Bed for "Dollars for every phone" (KovaPhoneFilm, ~38 s), from ElevenLabs Music.
// Run: env -u ELEVENLABS_API_KEY node --env-file=.env scripts/kovaphone/music.mjs <variant>
import { writeFileSync } from 'node:fs'
const v = process.argv[2] ?? 'a'
const prompt = [
  'Instrumental bed for a 40-second premium fintech product film about sending dollars to a basic phone. 104 BPM, warm, hopeful, modern and human, with quiet confidence.',
  'Felt piano and soft marimba over a light muted kick, brushed hi-hats and a round warm bass; gentle and uncluttered so a voice sits clearly on top.',
  'Starts sparse, builds a little through the middle, a small lift of warmth in the second half, and ends on a clean resolved chord. No vocals.',
].join(' ')
const res = await fetch('https://api.elevenlabs.io/v1/music', {
  method: 'POST',
  headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'content-type': 'application/json' },
  body: JSON.stringify({ prompt, music_length_ms: 42000 }),
})
if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
writeFileSync(`public/kovaphone/music-${v}.mp3`, Buffer.from(await res.arrayBuffer()))
console.log(`wrote public/kovaphone/music-${v}.mp3`)
