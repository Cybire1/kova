// Score for "Send by link" (LinkFilm): ElevenLabs Music from a composition plan whose sections follow
// the film's cues, at 192 kbps. Writes public/link/score-<variant>.mp3.
// Run: env -u ELEVENLABS_API_KEY node --env-file=.env scripts/score-link.mjs a b c
import { writeFileSync } from 'node:fs'

const plan = {
  positive_global_styles: [
    'premium modern product film score',
    'polished high-fidelity studio production, clean balanced mix, wide stereo',
    'warm, optimistic, human',
    '112 BPM, F major',
    'felt piano, plucked nylon guitar, soft analog synth plucks, deep clean sub bass, tight modern drums with soft claps, airy pads',
    'instrumental',
  ],
  negative_global_styles: ['vocals', 'lo-fi', 'distorted', 'muddy', 'cheesy', 'chiptune', 'video game', 'harsh', 'noisy', 'corporate stock music cliché'],
  sections: [
    { section_name: 'Intro', positive_local_styles: ['intimate felt piano chords', 'delicate plucked motif', 'light shaker', 'sparse and close'], negative_local_styles: ['heavy drums', 'bass drop'], duration_ms: 3000, lines: [] },
    { section_name: 'Flight', positive_local_styles: ['airy rising swell', 'soft riser', 'filtered drums building', 'sense of lift and flight'], negative_local_styles: ['heavy drums'], duration_ms: 3200, lines: [] },
    { section_name: 'Story', positive_local_styles: ['warm confident groove', 'soft kick and claps', 'clean sub bass', 'plucked synth arpeggio', 'curious and light'], negative_local_styles: ['busy', 'aggressive'], duration_ms: 7100, lines: [] },
    { section_name: 'Payoff', positive_local_styles: ['full uplifting lift', 'bright piano chords', 'shimmering pads', 'joyful and satisfying'], negative_local_styles: ['abrupt'], duration_ms: 3000, lines: [] },
    { section_name: 'Afterglow', positive_local_styles: ['the groove settles into warm sustained piano and pad chords', 'soft and continuous', 'gentle and confident', 'keeps playing to the very end'], negative_local_styles: ['silence', 'abrupt ending', 'fade to nothing'], duration_ms: 3700, lines: [] },
    { section_name: 'Tail', positive_local_styles: ['final warm major chord held and ringing'], negative_local_styles: ['silence'], duration_ms: 3000, lines: [] },
  ],
}

for (const variant of process.argv.slice(2)) {
  const res = await fetch('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_192', {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ composition_plan: plan }),
  })
  if (!res.ok) throw new Error(`${variant}: ${res.status} ${await res.text()}`)
  writeFileSync(`public/link/score-${variant}.mp3`, Buffer.from(await res.arrayBuffer()))
  console.log('wrote score', variant)
}
