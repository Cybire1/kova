// New voice lines for demo v2 (hook first) and the Agora cut. Same voice and settings as demo/vo.mjs.
//   node --env-file=.env demo/vo2.mjs
import { execSync } from 'node:child_process'
import { copyFileSync, writeFileSync } from 'node:fs'
const voice = 'JBFqnCBsd6RMkjVDRZzb'
const lines = [
  ['hook2', 'This phone has no signal. Watch it pay.'],
  ['problem', 'People want dollars. But wallets stop with no signal, show everything in public, and ask for gas and seed phrases. Kova is a dollar account that works anywhere, on Monad.'],
  ['agent', 'Sam can also give his AI agent its own key. Claude pays Ada’s Bakery twenty cents on its own, but anything over fifty cents waits for Sam to approve it. Monad enforces the limit.'],
  ['agora-hook', 'Fifty cents to a friend abroad, in about a second, in AUSD on Monad.'],
  ['agora-offline', 'And with no signal, AUSD’s EIP-3009 lets the phone sign the payment offline. It settles on Monad once either phone is back online.'],
  ['agora-close', 'Every balance and every payment in Kova is AUSD. Try it at mykova dot app, slash try.'],
]
const out = []
for (let i = 0; i < lines.length; i++) {
  const [id, text] = lines[i]
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.3, use_speaker_boost: true } }),
  })
  if (!res.ok) throw new Error(`${id}: ${res.status} ${await res.text()}`)
  const file = `demo/vo2/${id}.mp3`
  writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  copyFileSync(file, `public/demo/${id}.mp3`)
  const dur = Number(execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 ${file}`).toString().trim())
  out.push({ id, text, dur })
  console.log(id, dur.toFixed(2))
}
writeFileSync('demo/vo2/vo.json', JSON.stringify(out, null, 2))
