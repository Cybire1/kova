// Score for "Everyone's watching" (WatchingFilm): ElevenLabs Music from a composition plan that follows
// the film's turns: nosy and comic on the train, a hush and a confident click at "Not anymore", a
// playful sting when they give up, a warm groove in the café, a lift and a held chord at the end.
// Writes public/private/score-<v>.mp3.  Run: env -u ELEVENLABS_API_KEY node --env-file=.env scripts/score-watching.mjs w1 w2
import { writeFileSync } from 'node:fs'

const plan = {
  positive_global_styles: [
    'premium modern commercial film score',
    'polished high-fidelity studio production, clean balanced mix, wide stereo',
    'witty, sly, confident, warm',
    '104 BPM',
    'pizzicato strings, muted plucked synth, upright bass, finger snaps, soft brushed drums, felt piano, airy pads',
    'instrumental',
    'continuous music from start to end, no gaps or silences',
  ],
  negative_global_styles: ['vocals', 'lo-fi', 'distorted', 'muddy', 'cheesy', 'chiptune', 'video game', 'horror', 'silence', 'harsh', 'noisy', 'corporate stock music cliché'],
  sections: [
    { section_name: 'Nosy', positive_local_styles: ['sly sneaking pizzicato strings and muted plucks', 'upright bass walking softly', 'finger snaps', 'comic tension, everyone leaning in'], negative_local_styles: ['loud drums'], duration_ms: 4600, lines: [] },
    { section_name: 'Not anymore', positive_local_styles: ['a brief hush, then a confident felt piano chord and a soft kick', 'the tension released with a smile', 'cool and assured'], negative_local_styles: ['silence', 'abrupt stop'], duration_ms: 3800, lines: [] },
    { section_name: 'Nobody knows', positive_local_styles: ['playful pizzicato sting and a bouncy bass line', 'witty, light, a shrug in music'], negative_local_styles: ['silence'], duration_ms: 3000, lines: [] },
    { section_name: 'Cafe', positive_local_styles: ['warm confident groove', 'brushed drums and snaps', 'upright bass', 'felt piano melody', 'intimate and satisfied'], negative_local_styles: ['busy', 'aggressive', 'silence'], duration_ms: 6700, lines: [] },
    { section_name: 'Lift', positive_local_styles: ['full warm lift', 'bright piano chords and strings', 'satisfying'], negative_local_styles: ['abrupt'], duration_ms: 3000, lines: [] },
    { section_name: 'Tail', positive_local_styles: ['a warm final major chord held and ringing to the very end'], negative_local_styles: ['silence', 'fade to nothing'], duration_ms: 3000, lines: [] },
  ],
}

for (const variant of process.argv.slice(2)) {
  const res = await fetch('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_192', {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ composition_plan: plan }),
  })
  if (!res.ok) throw new Error(`${variant}: ${res.status} ${await res.text()}`)
  writeFileSync(`public/private/score-${variant}.mp3`, Buffer.from(await res.arrayBuffer()))
  console.log('wrote score', variant)
}
