// Fetch the four xStocks that are buyable on Monad today (checked: $10 quotes within 0.2% of price)
// once, from Kova's mainnet API, and freeze them for the film: the "prices" field of src/xstocks2/cues.json
// holds each price as served and the fetch time; public/xstocks2/<SYMBOL>.png is the logo from the response.
// Run: node scripts/xstocks2/prices.mjs
import { readFileSync, writeFileSync } from 'node:fs'

const BUYABLE = ['TSLAx', 'NVDAx', 'SPYx', 'QQQx']
const url = 'https://api-monad-mainnet.up.railway.app/v1/stocks'
const fetchedAt = new Date().toISOString()
const body = await (await fetch(url)).json()
const stocks = []
for (const symbol of BUYABLE) {
  const s = body.data.find((d) => d.symbol === symbol)
  if (!s) throw new Error(`${symbol} missing from ${url}`)
  const png = Buffer.from(await (await fetch(s.logo)).arrayBuffer())
  writeFileSync(`public/xstocks2/${symbol}.png`, png)
  stocks.push({ symbol, name: s.name, ticker: s.ticker, price: s.price, logo: s.logo, period: s.period })
}
const cuesFile = 'src/xstocks2/cues.json'
const cues = JSON.parse(readFileSync(cuesFile, 'utf8'))
cues.prices = { source: url, fetchedAt, stocks }
writeFileSync(cuesFile, `${JSON.stringify(cues, null, 2)}\n`)
console.log(fetchedAt, stocks.map((s) => `${s.symbol} ${s.price}`).join(' · '))
