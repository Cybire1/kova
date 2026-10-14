import fs from 'node:fs'
import { open, recorder, sleep } from './web-lib.mjs'
const CODE_URL = fs.readFileSync('/Users/cyber/.claude/jobs/15cd9816/tmp/offline-code.txt', 'utf8').trim()
const { browser, page, cdp } = await open()
await page.goto(CODE_URL, { waitUntil: 'networkidle2', timeout: 45000 })
await sleep(600)
const rec = recorder(cdp, '/Users/cyber/kova/film/demo/raw/w2-opage')
await rec.start()
const t0 = Date.now()
let last = ''
for (let i = 0; i < 140; i++) {
  await sleep(400)
  const text = await page.evaluate(() => document.body.innerText)
  const head = text.replace(/\s+/g, ' ').slice(0, 160)
  if (head !== last) { console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', head); last = head }
  if (/settled|Settled|landed|is in your/i.test(text) && i > 5) { await sleep(5000); break }
}
console.log('frames', await rec.stop())
console.log('links', await page.$$eval('a', (as) => as.map((a) => a.href).filter((h) => /scan/.test(h))))
await page.screenshot({ path: '/Users/cyber/.claude/jobs/15cd9816/tmp/opage.png' })
await browser.close()
