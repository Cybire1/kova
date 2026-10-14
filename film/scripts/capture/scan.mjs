// Captures an explorer page as it is, at 1920x1080: node scripts/capture/scan.mjs <url> <out.png> [scrollY]
import puppeteer from 'puppeteer-core'

const [, , url, out, scrollY = '0'] = process.argv
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--window-size=1920,1080'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 })
await page.goto(url, { waitUntil: 'networkidle2', timeout: 60_000 })
await new Promise((r) => setTimeout(r, 2500))
if (Number(scrollY)) await page.evaluate((y) => window.scrollTo(0, y), Number(scrollY))
await new Promise((r) => setTimeout(r, 800))
await page.screenshot({ path: out })
await browser.close()
console.log(out)
