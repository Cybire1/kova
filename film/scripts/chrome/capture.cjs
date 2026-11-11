// Captures Kova for Chrome's own windows for the extension film: the built extension's popup.html and
// prompt.html (apps/extension/dist), opened in headless Chrome with the background's answers scripted,
// so every pixel is the shipped UI. Writes public/chrome/*.png (4x, the popup 6x) and rects.json (where the film's
// cursor taps, in CSS px of each window).
// Run: (cd apps/extension && node build.mjs) && node scripts/chrome/capture.cjs
const fs = require('node:fs')
const path = require('node:path')
const puppeteer = require('puppeteer-core')

const DIST = path.join(__dirname, '../../../apps/extension/dist')
const OUT = path.join(__dirname, '../../public/chrome')
const SHELL = path.join(
  __dirname,
  '../../node_modules/.remotion/chrome-headless-shell/mac-arm64/chrome-headless-shell-mac-arm64/chrome-headless-shell',
)
const ORBIT = 'https://orbit.trade'
const OWNER = { address: '0xE4F3a1c291763b8426ad290491c4a7939896b4d6', name: 'Mia', currency: 'USD', connectedAt: 0 }
const BALANCE = 1284.5
const site = (origin, name, spent, limit, period, status = 'active') => ({
  origin, name, keyId: name, status, limit, period, spent: spent.toFixed(2),
  left: (Number(limit) - spent).toFixed(2), askAbove: '0.50',
})
const popupState = (spent, status, others) => ({
  owner: OWNER,
  balance: (BALANCE - spent).toFixed(2),
  sites: [
    site(ORBIT, 'orbit.trade', spent, '20', 'day', status),
    ...(others ? [site('https://pixel.news', 'pixel.news', 0.37, '2', 'week'), site('https://atlas.market', 'atlas.market', 4.99, '20', 'day')] : []),
  ],
  connected: [],
  network: 'mainnet',
})

async function page(browser, file, w, h, answers, dsf = 4) {
  const p = await browser.newPage()
  await p.setViewport({ width: w, height: h, deviceScaleFactor: dsf })
  await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  await p.evaluateOnNewDocument((a) => {
    window.__answers = a
    window.chrome = {
      runtime: {
        sendMessage: async (m) => ({ ok: true, value: window.__answers[m.type] ?? null }),
        getURL: (u) => u,
      },
    }
  }, answers)
  await p.goto(`file://${DIST}/${file}`)
  await p.evaluate(() => document.fonts.ready)
  await new Promise((r) => setTimeout(r, 1800))
  return p
}
const rect = (p, sel, text) =>
  p.evaluate((sel, text) => {
    const el = [...document.querySelectorAll(sel)].find((e) => !text || e.textContent.trim().startsWith(text))
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  }, sel, text)
const clickText = (p, sel, text) =>
  p.evaluate((sel, text) => [...document.querySelectorAll(sel)].find((e) => e.textContent.trim().startsWith(text)).click(), sel, text)

;(async () => {
  const browser = await puppeteer.launch({ executablePath: SHELL, headless: 'shell' })
  const rects = {}

  // The budget window: orbit.trade asks $5.00.
  const prompt = { kind: 'budget', origin: ORBIT, reason: 'pay', ask: { amount: '5.00', token: 'AUSD', description: null } }
  const b = await page(browser, 'prompt.html?id=film', 400, 612, { 'prompt:get': prompt })
  rects.budget = {
    w: 400, h: 612,
    chip20: await rect(b, '.chip', '$20'),
    chips: await rect(b, '.chips'),
    go: await rect(b, 'button', 'Continue') ?? (await rect(b, '.btn')),
  }
  await b.screenshot({ path: path.join(OUT, 'budget-20.png') })
  rects.budget.buttons = await b.evaluate(() => [...document.querySelectorAll('button')].map((e) => e.textContent.trim()))

  // Connecting, and the payment that asks for more than the site has left.
  const cn = await page(browser, 'prompt.html?id=film', 400, 612, { 'prompt:get': { kind: 'connect', origin: ORBIT } })
  await cn.screenshot({ path: path.join(OUT, 'connect.png') })
  rects.connect = { w: 400, h: 612, go: await rect(cn, 'button', 'Connect') }
  const ov = await page(browser, 'prompt.html?id=film', 400, 612, {
    'prompt:get': { kind: 'pay', origin: ORBIT, to: '0x109fC135dE7DC9Ee06aFa18c6b5d52ad34552dfF', amount: '1264.50', left: '0.00', period: 'day' },
  })
  await ov.screenshot({ path: path.join(OUT, 'over.png') })
  rects.over = { w: 400, h: 612, err: await rect(ov, '.err') }

  // A page that costs a cent, and the popup with four sites, before and after Freeze all.
  const pu = await page(browser, 'prompt.html?id=film', 400, 612, {
    'prompt:get': { kind: 'x402', origin: 'https://pixel.news', left: '1.63', period: 'week', amount: '0.01', token: 'AUSD', description: null },
  })
  await pu.screenshot({ path: path.join(OUT, 'cent.png') })
  rects.cent = { w: 400, h: 612, go: await rect(pu, 'button', 'Pay') }
  const four = (status) => ({
    owner: OWNER, balance: '1284.50', connected: [], network: 'mainnet',
    sites: [
      site('https://northline.air', 'northline.air', 412.3, '500', 'week', status),
      site('https://pixel.news', 'pixel.news', 0.37, '2', 'week', status),
      site('https://atlas.market', 'atlas.market', 4.99, '20', 'day', status),
      site(ORBIT, 'orbit.trade', 5, '20', 'day', status),
    ],
  })
  for (const [name, status] of [['sites', 'active'], ['sites-frozen', 'frozen']]) {
    const p = await page(browser, 'popup.html', 360, 600, { state: four(status) }, 6)
    await p.screenshot({ path: path.join(OUT, `${name}.png`) })
    if (name === 'sites') rects.sites = { w: 360, h: 600, all: await rect(p, '.link', 'Freeze all') }
    await p.close()
  }

  // The popup's list, one site, as its budget is spent; then frozen.
  for (const [name, spent, status, others] of [
    ['row-0', 0, 'active'], ['row-5', 5, 'active'], ['row-10', 10, 'active'], ['row-15', 15, 'active'], ['row-20', 20, 'active'],
    ['row-frozen', 20, 'frozen'], ['row-5-frozen', 5, 'frozen'],
  ]) {
    const p = await page(browser, 'popup.html', 360, 600, { state: popupState(spent, status, others) }, 6)
    await p.screenshot({ path: path.join(OUT, `${name}.png`) })
    if (name === 'row-0') rects.row = { w: 360, h: 600, site: await rect(p, '.site'), bar: await rect(p, '.site .bar'), sw: await p.evaluate(() => {
        const r = document.querySelector('.site').children[1].getBoundingClientRect()
        return { x: r.x, y: r.y, w: r.width, h: r.height }
      }) }
    await p.close()
  }
  fs.writeFileSync(path.join(OUT, 'rects.json'), JSON.stringify(rects, null, 2))
  await browser.close()
  console.log(JSON.stringify(rects))
})()
