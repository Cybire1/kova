// The agent scene's payment on Monadscan, captured like demo/scan.mjs (same browser profile).
import puppeteer from 'puppeteer-core'
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', userDataDir: '/Users/cyber/.claude/jobs/15cd9816/tmp/chrome-demo' })
const page = await browser.newPage()
await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36')
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 })
const shots = [['scan-agent', 'https://testnet.monadscan.com/tx/0xf7659c659ae3c2d7c75f9d3702339bb9c2e60425ab59560ee91390f7b6a2e5d2']]
for (const [name, url] of shots) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }).catch((e) => console.log(name, e.message))
  await new Promise((r) => setTimeout(r, 3000))
  await page.screenshot({ path: `/Users/cyber/kova/film/demo/raw/${name}.png` })
  console.log(name, JSON.stringify(await page.title()))
}
await browser.close()
