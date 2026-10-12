// Score for "Send by link" (LinkFilm), from ElevenLabs Music, timed to src/link/link-cues.json.
// Run: env -u ELEVENLABS_API_KEY node --env-file=.env scripts/sound-link.mjs
import { writeFileSync } from 'node:fs'

const res = await fetch('https://api.elevenlabs.io/v1/music', {
  method: 'POST',
  headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'content-type': 'application/json' },
  body: JSON.stringify({
    prompt: [
      'Instrumental score for a 20-second premium product announcement, warm, light and optimistic, 112 BPM.',
      '0-3.5s: a soft plucked guitar motif and a light shaker, intimate.',
      '3.5-6s: an airy rising swell, as something flies across the sky.',
      '6-13s: a gentle groove with soft kick, claps and warm bass, curious and friendly.',
      '13.5s: a joyful lift with bright piano chords and a little sparkle, the happy moment.',
      '16.5-20s: a calm resolution on a warm final chord that rings out to the end. No vocals.',
    ].join(' '),
    music_length_ms: 20000,
  }),
})
if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
writeFileSync('public/link/music.mp3', Buffer.from(await res.arrayBuffer()))
console.log('wrote public/link/music.mp3')
