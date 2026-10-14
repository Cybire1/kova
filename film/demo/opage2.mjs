import fs from 'node:fs'
import { open, recorder, sleep } from './web-lib.mjs'
const CODE_URL = fs.readFileSync('/Users/cyber/.claude/jobs/15cd9816/tmp/offline-code.txt', 'utf8').trim()
const { browser, page, cdp } = await open()
const rec = recorder(cdp, '/Users/cyber/kova/film/demo/raw/w3-osettled')
await rec.start()
await page.goto(CODE_URL, { waitUntil: 'networkidle2', timeout: 45000 })
await sleep(6000)
console.log('frames', await rec.stop())
console.log((await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 300))
console.log('links', await page.$$eval('a', (as) => as.map((a) => a.href).filter((h) => /scan/.test(h))))
await browser.close()
