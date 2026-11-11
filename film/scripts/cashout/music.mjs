// The cash-out film's music: one produced action cue from ElevenLabs Music, its sections timed to
// the film (src/cashout/cues.json): the hook, the board, the run, the build, the landing, the
// wall and the end. Writes public/cashout/music.mp3 and keeps the song id beside it.
// Run: node scripts/cashout/music.mjs   (needs ELEVENLABS_API_KEY in film/.env)
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

const sections = [
  ['Hook', 4000, ['tense ticking hi-hats', 'pulsing synth bass', 'anticipation', 'building fast'], ['big drums', 'silence']],
  ['Board', 6000, ['drums hit hard on the first beat', 'full driving beat', 'punchy kick and snare', 'high energy'], ['quiet', 'ambient']],
  ['Run', 11000, ['relentless driving groove', 'tight percussion', 'propulsive bass', 'momentum'], ['breakdown', 'quiet']],
  ['Build', 3000, ['snare roll accelerating', 'rising riser', 'tension climbing to a peak'], ['drop', 'calm']],
  ['Landing', 3000, ['massive impact hit on the first beat', 'triumphant', 'huge drums'], ['quiet', 'soft']],
  ['Wall', 4000, ['euphoric full energy', 'driving drums', 'soaring synths', 'triumphant'], ['quiet', 'sparse']],
  ['End', 3000, ['final big hit on the first beat', 'then the sound rings out and decays to silence'], ['new melody', 'drums continuing']],
]

const body = {
  model_id: 'music_v1',
  composition_plan: {
    positive_global_styles: ['cinematic action trailer', 'modern electronic hybrid', 'fast-paced', '120 BPM', 'D minor', 'punchy drums', 'driving bass', 'polished professional mix', 'instrumental'],
    negative_global_styles: ['vocals', 'singing', 'lo-fi', 'slow', 'acoustic guitar', 'jazz', 'muddy mix'],
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
writeFileSync(join(root, 'public/cashout/music.mp3'), audio)
writeFileSync(join(root, 'public/cashout/music.json'), JSON.stringify({ song_id: response.headers.get('song-id'), sections: body.composition_plan.sections.map((s) => [s.section_name, s.duration_ms]) }, null, 2))
console.log(`music.mp3: ${audio.length} bytes, song ${response.headers.get('song-id')}`)
