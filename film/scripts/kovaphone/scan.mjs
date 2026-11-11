// The $1.00 send's page on testnet Monadscan, at 1920x1080, for the film's proof scene.
//   node scripts/kovaphone/scan.mjs <tx> <out.png>
import puppeteer from 'puppeteer-core'
const [tx, out] = process.argv.slice(2)
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const page = await browser.newPage()
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 })
await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36')
await page.goto(`https://testnet.monadscan.com/tx/${tx}`, { waitUntil: 'networkidle2', timeout: 60000 })
await new Promise((r) => setTimeout(r, 3000))
// dismiss the cookie notice so it doesn't cover the page
await page.evaluate(() => { for (const b of document.querySelectorAll('button, a')) if (/^\s*Got it!?\s*$/.test(b.textContent ?? '')) b.click() })
await new Promise((r) => setTimeout(r, 800))
console.log((await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 600))
await page.screenshot({ path: out })
await browser.close()
