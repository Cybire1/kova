// Captures an explorer page as it is, at 1920x1080 and 2x pixels, with the cookie notice dismissed:
// node scripts/kova-launch/scan.mjs <url> <out.png> [scrollY]
import puppeteer from 'puppeteer-core'

const [, , url, out, scrollY = '0'] = process.argv
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--window-size=1920,1080'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 })
await page.goto(url, { waitUntil: 'networkidle2', timeout: 60_000 })
await new Promise((r) => setTimeout(r, 2500))
await page.evaluate(() => {
  for (const b of document.querySelectorAll('button, a')) if (/got it/i.test(b.textContent || '')) b.click()
})
if (Number(scrollY)) await page.evaluate((y) => window.scrollTo(0, y), Number(scrollY))
await new Promise((r) => setTimeout(r, 900))
await page.screenshot({ path: out })
await browser.close()
console.log(out)
