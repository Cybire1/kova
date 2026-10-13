// Sound effects for "Private sends" (PrivateFilm), ElevenLabs Sound Effects at 192 kbps: the two the
// link film doesn't have (the lock, the hush); the rest are public/link/sfx. Writes public/private/sfx.
// Run: env -u ELEVENLABS_API_KEY node --env-file=.env scripts/sfx-private.mjs [name …]
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'

const OUT = 'public/private/sfx'
mkdirSync(OUT, { recursive: true })
const EFFECTS = {
  lock: ['A small, satisfying, premium padlock click as a toggle switch turns on in a phone app. Soft metallic click with a tiny warm tick, close, dry, high fidelity, subtle.', 0.6],
  lift: ['A soft, premium, airy UI swell as a card lifts off a phone screen toward the viewer: a gentle short rising whoosh with a tiny glassy shimmer at the end. Subtle, clean, high fidelity, no harsh highs.', 0.8],
  hush: ['A soft airy whoosh that fades into hushed silence, as if a trail of light vanishes into fog. Gentle, smooth, premium, high fidelity, no harsh highs.', 1.6],
}
const only = process.argv.slice(2)
for (const [name, [text, seconds]] of Object.entries(EFFECTS)) {
  if (only.length ? !only.includes(name) : existsSync(`${OUT}/${name}.mp3`)) continue
  const res = await fetch('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_192', {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ text, duration_seconds: seconds, prompt_influence: 0.7 }),
  })
  if (!res.ok) throw new Error(`${name}: ${res.status} ${await res.text()}`)
  writeFileSync(`${OUT}/${name}.mp3`, Buffer.from(await res.arrayBuffer()))
  console.log('wrote', name)
}
