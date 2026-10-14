// Demo voiceover, one request per line with its neighbours for continuity. node --env-file=.env demo/vo.mjs
import { writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
const voice = 'JBFqnCBsd6RMkjVDRZzb'
const lines = [
  ['hook', 'This is Kova: a dollar account that works anywhere. With no signal, in private, across borders. Live on Monad.'],
  ['cafe', 'Sam orders a croissant from table three. One tap, and it is paid: three twenty-five to Ada’s Bakery, settled on Monad. Kova pays the gas.'],
  ['link', 'Then he sends Lucía fifty cents by link. She’s abroad, with no wallet.'],
  ['claim', 'She sees it in euros, makes a wallet with Face ID, and claims it. It arrived in seven tenths of a second.'],
  ['offline', 'No signal? Sam still pays. His phone signs the payment and shows it as a code, and Lucía’s phone checks it on the spot.'],
  ['settle', 'As soon as either phone is back online, it settles on Monad, once.'],
  ['private', 'And when it’s private, Monad sees who paid, but not who got paid. Ada pays Sam at a one-time address only he can find, with a sealed note.'],
  ['arrival', 'Only Sam’s phone can open it.'],
  ['close', 'Kova is live on Monad mainnet today. Tap. Paid. Anywhere.'],
]
const out = []
for (let i = 0; i < lines.length; i++) {
  const [id, text] = lines[i]
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', previous_text: lines[i - 1]?.[1], next_text: lines[i + 1]?.[1], voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.3, use_speaker_boost: true } }),
  })
  if (!res.ok) throw new Error(`${id}: ${res.status} ${await res.text()}`)
  const file = `demo/vo/${id}.mp3`
  writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  const dur = Number(execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 ${file}`).toString().trim())
  out.push({ id, text, file, dur })
  console.log(id, dur.toFixed(2))
}
writeFileSync('demo/vo/vo.json', JSON.stringify(out, null, 2))
