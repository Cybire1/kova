// Bed for "ugc 1" (59 s talker about building with AI), from ElevenLabs Music.
// Run: env -u ELEVENLABS_API_KEY node --env-file=.env scripts/ugc1/music.mjs <variant>
import { writeFileSync } from 'node:fs'
const v = process.argv[2] ?? 'a'
const prompt = [
  'Instrumental bed for a 60-second creator video about building things with AI. 100 BPM, modern, warm, curious and quietly confident, with forward momentum.',
  'Clean muted kick, soft snare or rim, crisp hi-hats, a deep round bass, mellow electric piano chords and a few glassy plucks. Leaves space in the mids for a voice.',
  'Steady groove all the way through, a small lift around the middle, and a clean ending with a final chord. No vocals, no risers that swamp the voice.',
].join(' ')
const res = await fetch('https://api.elevenlabs.io/v1/music', {
  method: 'POST',
  headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'content-type': 'application/json' },
  body: JSON.stringify({ prompt, music_length_ms: 62000 }),
})
if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
writeFileSync(`public/ugc1/music/${v}.mp3`, Buffer.from(await res.arrayBuffer()))
console.log(`wrote public/ugc1/music/${v}.mp3`)
