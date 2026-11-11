// Screenshot of a mykova.app page at a desktop viewport (1440x900 @2x), for the "websites" beat.
//   node scripts/ugc1/desk.mjs <url> <out.png>
import puppeteer from 'puppeteer-core'
const [url, out] = process.argv.slice(2)
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 })
await page.goto(url, { waitUntil: 'networkidle0' })
await new Promise((r) => setTimeout(r, 1500))
await page.screenshot({ path: out })
await browser.close()
console.log(out)
