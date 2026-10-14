// A quiet bed under the demo's narration: ElevenLabs Music from a plan that follows the scenes.
// node --env-file=.env demo/score.mjs d1 [d2]  → demo/vo/score-<v>.mp3
import { writeFileSync } from 'node:fs'
const plan = {
  positive_global_styles: ['minimal modern product film bed, sits under narration', 'warm, calm, quietly confident', '96 BPM', 'soft marimba plucks, felt piano, airy warm pads, gentle muted bass, light brushed shaker', 'instrumental', 'clean balanced mix', 'continuous music from start to end, no gaps or silences'],
  negative_global_styles: ['vocals', 'lead melody that competes with speech', 'big drums', 'drops', 'risers', 'distorted', 'lo-fi', 'cheesy', 'silence', 'harsh', 'corporate stock music cliché'],
  sections: [
    { section_name: 'Hello', positive_local_styles: ['soft felt piano and pads open gently'], negative_local_styles: ['silence', 'loud'], duration_ms: 8000, lines: [] },
    { section_name: 'Cafe', positive_local_styles: ['light marimba pulse and shaker join, easy and warm'], negative_local_styles: ['busy', 'silence'], duration_ms: 18500, lines: [] },
    { section_name: 'Link', positive_local_styles: ['the pulse continues, a little brighter, friendly'], negative_local_styles: ['busy', 'silence'], duration_ms: 27000, lines: [] },
    { section_name: 'No signal', positive_local_styles: ['drums drop away, pads and soft marimba only, calm and steady'], negative_local_styles: ['silence', 'tense'], duration_ms: 23000, lines: [] },
    { section_name: 'Private', positive_local_styles: ['intimate felt piano over warm pads, the pulse returns softly'], negative_local_styles: ['busy', 'silence'], duration_ms: 28500, lines: [] },
    { section_name: 'Live', positive_local_styles: ['a warm lift and a held major chord ringing to the end'], negative_local_styles: ['silence', 'abrupt', 'fade to nothing'], duration_ms: 9000, lines: [] },
  ],
}
for (const v of process.argv.slice(2)) {
  const res = await fetch('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_192', { method: 'POST', headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ composition_plan: plan }) })
  if (!res.ok) throw new Error(`${v}: ${res.status} ${await res.text()}`)
  writeFileSync(`demo/vo/score-${v}.mp3`, Buffer.from(await res.arrayBuffer()))
  console.log('wrote', v)
}
