// "Kova, all of it" music: one produced cue from ElevenLabs Music, its sections timed to the film's
// beat sheet (src/day/cues.json): the hook, two grooves that lift, the peak, a riser, the payoff on
// the receipt's total, and a chord that rings out under the end card. 120 BPM, a beat is 0.5 s.
// Run: node scripts/day/music.mjs [take]   (needs ELEVENLABS_API_KEY in film/.env)
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const env = Object.fromEntries(
  readFileSync(join(root, '.env'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const key = env.ELEVENLABS_API_KEY
if (!key) throw new Error('ELEVENLABS_API_KEY is missing from film/.env')
const take = process.argv[2] ?? 'a'

const sections = [
  ['Hook', 6000, ['starts instantly on the first beat with energy', 'crisp ticking hi-hats', 'plucky bright synth riff', 'tight kick', 'confident'], ['fade in', 'ambient intro', 'silence']],
  ['Groove', 14000, ['full warm groove', 'punchy kick and clap', 'bouncy bass', 'bright plucks', 'playful and precise'], ['breakdown', 'quiet']],
  ['Lift', 12000, ['the groove lifts', 'more layers', 'open hi-hats', 'rising energy', 'catchy hook melody'], ['quiet', 'slow']],
  ['Peak', 12000, ['highest energy', 'driving drums', 'fast hi-hats', 'big hook melody', 'euphoric'], ['quiet', 'sparse']],
  ['Riser', 4000, ['drums drop out', 'filtered synth', 'snare roll accelerating', 'rising riser building tension'], ['drop', 'full drums']],
  ['Payoff', 4000, ['massive impact on the first beat', 'triumphant full band', 'huge drums'], ['quiet', 'soft']],
  ['End', 4000, ['one final big chord hit on the first beat', 'then it rings out and decays to silence'], ['new melody', 'drums continuing']],
]

const body = {
  model_id: 'music_v1',
  composition_plan: {
    positive_global_styles: ['modern upbeat electronic pop', 'tech product launch', '120 BPM', 'C major', 'punchy polished drums', 'warm bass', 'bright plucky synths', 'playful but precise', 'professional mix', 'instrumental'],
    negative_global_styles: ['vocals', 'singing', 'lo-fi', 'slow', 'cinematic trailer', 'dark', 'acoustic guitar', 'jazz', 'muddy mix'],
    sections: sections.map(([section_name, duration_ms, positive_local_styles, negative_local_styles]) => ({
      section_name,
      duration_ms,
      positive_local_styles,
      negative_local_styles,
      lines: [],
    })),
  },
  respect_sections_durations: true,
}

const response = await fetch('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_192', {
  method: 'POST',
  headers: { 'xi-api-key': key, 'content-type': 'application/json' },
  body: JSON.stringify(body),
})
if (!response.ok) throw new Error(`ElevenLabs answered ${response.status}: ${(await response.text()).slice(0, 400)}`)
const audio = Buffer.from(await response.arrayBuffer())
writeFileSync(join(root, `public/day/music-${take}.mp3`), audio)
writeFileSync(join(root, `public/day/music-${take}.json`), JSON.stringify({ song_id: response.headers.get('song-id'), sections: sections.map((s) => [s[0], s[1]]) }, null, 2))
console.log(`music-${take}.mp3: ${audio.length} bytes, song ${response.headers.get('song-id')}`)
