import { open, recorder, sleep, LINK } from './web-lib.mjs'
const { browser, page, cdp } = await open()
await page.goto(LINK, { waitUntil: 'networkidle2', timeout: 45000 })
await sleep(800)
const rec = recorder(cdp, '/Users/cyber/kova/film/demo/raw/w1-claim')
await rec.start()
await sleep(3500)
const click = async (label) => { const [el] = await page.$$(`xpath/.//button[contains(., "${label}")]`); if (!el) throw new Error(`no button ${label}`); await el.scrollIntoView(); await sleep(700); await el.click() }
await click('Claim with Face ID')
await sleep(1500)
const input = await page.$('input')
await input.scrollIntoView(); await sleep(400)
await input.type('Lucía', { delay: 110 })
await sleep(700)
const t0 = Date.now()
await click('Make it and claim')
let text = ''
for (let i = 0; i < 80; i++) {
  await sleep(400)
  text = await page.evaluate(() => document.body.innerText)
  if (/yours|claimed|landed/i.test(text) && !/Make it and claim/.test(text)) break
}
console.log('claim took', Date.now() - t0, 'ms')
await sleep(5000)
console.log('frames', await rec.stop())
console.log(text.slice(0, 600))
console.log('links', await page.$$eval('a', (as) => as.map((a) => a.href).filter((h) => /scan|\/tx\/|address/.test(h))))
console.log('profile', await page.evaluate(() => localStorage.getItem('kova.web.profile.v1')))
await page.screenshot({ path: '/Users/cyber/.claude/jobs/15cd9816/tmp/claim-2.png' })
await browser.close()
