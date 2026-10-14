import puppeteer from 'puppeteer-core'
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', userDataDir: '/Users/cyber/.claude/jobs/15cd9816/tmp/chrome-demo' })
const page = await browser.newPage()
await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36')
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 })
const shots = [
  ['scan-cafe', 'https://testnet.monadscan.com/tx/0x1d7346188f9af2e2df66983f19bf504280368e093986cf09fb3e8d7c3cd1e05f'],
  ['scan-claim', 'https://testnet.monadscan.com/tx/0x647c5359d954aa172e5a80a9e5a99d03b5e7f5f3a6787f08d23ddd9d46e1ff86'],
  ['scan-offline', 'https://testnet.monadscan.com/tx/0x2df5dfdb7e68b57d864403cde2ee935e905760bd51da5bb001c5f0ed27fdbbe1'],
  ['scan-private', 'https://testnet.monadscan.com/tx/0xf7df5a1547d42be9410001cbf77095d9b66e551f37c87a9484faf5240e9b54c7'],
  ['scan-announce', 'https://testnet.monadscan.com/tx/0xc460c5b5d3b539850e6b109873d8ae873964c8b7fa1525a1e3b7e2bcb80bad0f#eventlog'],
  ['scan-mainnet-card', 'https://monadscan.com/address/0x9bee9F2D59d9675F2723B274e1276F5931Ef325E'],
]
for (const [name, url] of shots) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }).catch((e) => console.log(name, e.message))
  await new Promise((r) => setTimeout(r, 2500))
  await page.screenshot({ path: `/Users/cyber/kova/film/demo/raw/${name}.png` })
  console.log(name, JSON.stringify(await page.title()))
}
await browser.close()
