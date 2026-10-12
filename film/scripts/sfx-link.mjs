// Sound effects for "Send by link" (LinkFilm): a few subtle, high-fidelity ones from ElevenLabs
// Sound Effects at 192 kbps. Writes public/link/sfx/<name>.mp3.
// Run: env -u ELEVENLABS_API_KEY node --env-file=.env scripts/sfx-link.mjs [name …]
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'

const OUT = 'public/link/sfx'
mkdirSync(OUT, { recursive: true })
const EFFECTS = {
  tap: ['A single soft, clean, premium smartphone touch-screen tap. Subtle, very short, close, dry, high fidelity.', 0.5],
  slide: ['A soft, smooth finger slide on glass with a gentle rising airy tone. Subtle, premium, high fidelity, no harsh highs.', 0.9],
  swoosh: ['A smooth, elegant, airy swoosh of a paper envelope gliding through the air from left to right. Soft, premium, high fidelity, no harsh highs.', 1.3],
  land: ['A soft, warm, premium notification pop as a message arrives on a phone. Subtle and pleasant, high fidelity.', 0.6],
  faceid: ['A subtle, crisp, premium biometric unlock confirmation: a soft click and a tiny bright glint. High fidelity, minimal.', 0.7],
  success: ['A warm, elegant success chime: two soft bell tones rising, premium fintech app, subtle, high fidelity, clean natural tail.', 1.8],
  logo: ['A soft, warm, deep low impact with a gentle airy tail for a minimal logo reveal. Premium, high fidelity.', 1.6],
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
