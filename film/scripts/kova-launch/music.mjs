// Score for "Kova: dollars for every phone" (src/kova-launch, 52 s), from ElevenLabs Music.
// Run: env -u ELEVENLABS_API_KEY node --env-file=.env scripts/kova-launch/music.mjs <variant>
import { writeFileSync } from 'node:fs'
const v = process.argv[2] ?? 'a'
const prompt = [
  'Instrumental score for a 52-second premium product launch film for a dollar wallet app. 120 BPM, 4/4, modern, confident and warm, polished like an Apple or Linear launch film.',
  'Section 1 (0 to 6 s): a bright plucked synth motif and a ticking hi-hat, sparse and curious.',
  'Section 2 (6 to 14 s): a tight groove enters, punchy kick, claps, round bass, the motif on top.',
  'Section 3 (14 to 26 s): darker and more intriguing, filtered pads, a pulsing bassline, a feeling of something secret and clever.',
  'Section 4 (26 to 32 s): a short airy breakdown, almost silent, soft pads only.',
  'Section 5 (32 to 42 s): warm and human, felt piano and marimba over the groove, hopeful.',
  'Section 6 (42 to 48 s): full build, everything together, energetic.',
  'Section 7 (48 to 52 s): one big final hit, then a clean resolved chord ringing out. No vocals.',
].join(' ')
const res = await fetch('https://api.elevenlabs.io/v1/music', {
  method: 'POST',
  headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'content-type': 'application/json' },
  body: JSON.stringify({ prompt, music_length_ms: 52000 }),
})
if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
writeFileSync(`public/kova-launch/music-${v}.mp3`, Buffer.from(await res.arrayBuffer()))
console.log(`wrote public/kova-launch/music-${v}.mp3`)
