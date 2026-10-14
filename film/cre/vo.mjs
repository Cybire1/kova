// CRE film voiceover, one request per line with its neighbours for continuity. node --env-file=.env cre/vo.mjs
import { execSync } from 'node:child_process'
import { copyFileSync, writeFileSync } from 'node:fs'
const voice = 'JBFqnCBsd6RMkjVDRZzb'
const lines = [
  ['hook', 'This is Kova’s exchange-rate workflow on Chainlink CRE. Every fifteen minutes, it writes the rates Kova shows people to Monad.'],
  ['how', 'Each node fetches two independent rate sources, and drops any currency where they disagree by more than two percent. The network agrees on the median, signs it into a report, and writes it to our KovaRates contract.'],
  ['run', 'Here’s a real run with the CRE CLI, broadcasting to Monad testnet.'],
  ['steps', 'The cron trigger fires. Both sources answer. Consensus takes the median of every rate. Then the signed report is written on Monad.'],
  ['scan', 'On Monadscan, the transaction succeeded: Chainlink’s forwarder delivered the report to KovaRates.'],
  ['logs', 'KovaRates logged the new rates, and the forwarder confirms the report was processed.'],
  ['api', 'Kova’s API reads the contract, and serves the same rates, from that same report.'],
  ['app', 'In the app, Lucía sees fifty cents as about forty-four euro cents, at the Chainlink rate.'],
  ['close', 'Kova rates: Chainlink CRE, on Monad. Try Kova at my kova dot app.'],
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
  const file = `cre/vo/${id}.mp3`
  writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  copyFileSync(file, `public/cre/vo-${id}.mp3`)
  const dur = Number(execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 ${file}`).toString().trim())
  out.push({ id, text, dur })
  console.log(id, dur.toFixed(2))
}
writeFileSync('cre/vo/vo.json', JSON.stringify(out, null, 2))
