// Score for "Kova on the wall" (12 s), from ElevenLabs Music. The film's beats are then set from
// the music's own hits (scripts/wall/beats.py), not the other way round.
// Run: env -u ELEVENLABS_API_KEY node --env-file=.env scripts/wall/music.mjs <variant>
import { writeFileSync } from 'node:fs'

const v = process.argv[2] ?? 'a'
const prompt = [
  'Instrumental score for a 12-second premium tech brand film shown on a giant LED wall in a dark venue. 120 BPM, warm, confident, modern, alive.',
  '0-2s: anticipation: a soft felt-piano motif over a ticking closed hi-hat and a low swelling pad.',
  'At exactly 2.0s: a satisfying drop: a punchy kick, a deep warm bass, crisp claps and bright glassy synth plucks; the groove plays from 2s to 8s with a bouncy feel-good rhythm.',
  '8s: a short riser and a half-beat of near silence.',
  'At exactly 9.0s: one big final hit, a warm open major chord with a shimmering tail ringing out to 12s.',
  'No vocals.',
].join(' ')
const res = await fetch('https://api.elevenlabs.io/v1/music', {
  method: 'POST',
  headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'content-type': 'application/json' },
  body: JSON.stringify({ prompt, music_length_ms: 12000 }),
})
if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
writeFileSync(`public/wall/music/${v}.mp3`, Buffer.from(await res.arrayBuffer()))
console.log(`wrote public/wall/music/${v}.mp3`)
