// Records the web cash-out for "Credit alert" at phone size, replaying the real run of 27 Oct 2026:
// $2.00 → ₦2,752.94 at ₦1,376.47, to the account holder's OPay ••6522, paid on Monad in
// 0x5646c1d0…be2d (cash-out 01a17fb8). The pages are Kova's own; the API answers are that cash-out's,
// so no new order is opened and nothing is paid. Take A runs Home → amount → bank → review and taps
// Send; take B is the sending step (a dev capture link) through to "Done".
// Run (web dev server on :3061): ACCOUNT=<number> ACCOUNT_NAME=<name> HIDE=<regex> \
//   node scripts/credit-alert/record.cjs [take]
// The recipient's account number and name stay out of the repo; HIDE is what the recording blurs.
// Writes public/credit-alert/take-<a|b>.mp4 (30 fps, 786x1596) and take-<a|b>.json (taps and typing, in s).
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const puppeteer = require('puppeteer-core')

const BASE = process.env.BASE ?? 'http://localhost:3061'
const OUT = path.join(__dirname, '../../public/credit-alert')
const SHELL =
  path.join(__dirname, '../../node_modules/.remotion/chrome-headless-shell/mac-arm64/chrome-headless-shell-mac-arm64/chrome-headless-shell')
const BANKS = process.env.BANKS // PAJ's bank list with logos (GET /v1/naira/banks)

const WALLET = '0xa1ceb1c291763b8426ad290491c4a7939896409e'
const ACCOUNT = process.env.ACCOUNT ?? '0000000000'
const OPAY = {
  name: 'Opay',
  code: '100004',
  logo: 'https://transsnet-android-upload-image-prod.s3.amazonaws.com/activity/17090132334317-OPAY.png',
}
// The real cash-out, as the API returned it once paid.
const PAID = {
  object: 'cash_out',
  id: '01a17fb8-bc33-702f-8290-bfa04d5b280d',
  partner: 'paj',
  amount: '2.00',
  naira: '₦2,752.94',
  naira_kobo: '275294',
  rate: '1376.47',
  fee: '₦0.00',
  bank_code: '100004',
  bank_name: 'Opay',
  account_name: process.env.ACCOUNT_NAME ?? 'ACCOUNT HOLDER',
  account_last4: '6522',
  status: 'paid',
  pay: {
    token: '0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a',
    to: '0x109fC135dE7DC9Ee06aFa18c6b5d52ad34552dfF',
    value: '2000000',
    nonce: '0x07d20f6000a12af3e629af930b9fc470bcb5ace162dc32a8a64fcc12d062544c',
    valid_before: 1793145075,
  },
  tx_hash: '0x5646c1d0c4ad3dc4c8f3add34d04a4038917b8fd7e42a75e835035d1f94bbe2d',
  tx_url: 'https://monadscan.com/tx/0x5646c1d0c4ad3dc4c8f3add34d04a4038917b8fd7e42a75e835035d1f94bbe2d',
  refund_tx_hash: null,
  refund_tx_url: null,
  failure: null,
  test_mode: false,
  expires_at: '2026-10-27T23:51:15.668Z',
  paid_at: '2026-10-27T23:36:32.684Z',
  created_at: '2026-10-27T23:36:15.670Z',
}
const QUOTED = { ...PAID, status: 'quoted', tx_hash: null, tx_url: null, paid_at: null }
const PAYING = { ...PAID, status: 'paying', paid_at: null }

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const json = (req, body, status = 200) =>
  req.respond({ status, contentType: 'application/json', body: JSON.stringify(body) })

async function open() {
  const browser = await puppeteer.launch({ executablePath: SHELL, headless: 'shell' })
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.error('page error:', e.message))
  // An iPhone 16 Pro's screen less its 54 pt status bar, which the film draws: as Kova runs when
  // it's added to the Home Screen.
  await page.setViewport({ width: 393, height: 798, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await page.evaluateOnNewDocument((address, hidden) => {
    localStorage.setItem(
      'kova.web.profile.v1',
      JSON.stringify({ address, name: 'Afeez', currency: 'USD', createdAt: Date.now() }),
    )
    localStorage.removeItem('kova.web.naira.recents.v1')
    // The account holder's name and number are blurred wherever they show, without touching the page's DOM
    // (React owns it): a CSS custom highlight over each match, kept up to date as screens change.
    const hide = new RegExp(hidden, 'g')
    const mark = () => {
      if (!window.CSS?.highlights || !document.body) return
      const ranges = []
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        hide.lastIndex = 0
        for (let m = hide.exec(node.nodeValue); m; m = hide.exec(node.nodeValue)) {
          const range = new Range()
          range.setStart(node, m.index)
          range.setEnd(node, m.index + m[0].length)
          ranges.push(range)
        }
      }
      CSS.highlights.set('kova-hide', new Highlight(...ranges))
    }
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style')
      style.textContent =
        '::highlight(kova-hide){color:transparent;text-shadow:0 0 11px rgba(11,26,29,.9)}' +
        '*{-webkit-tap-highlight-color:transparent!important}' +
        // The number as it's typed: the field stays, its digits blur.
        '#cx-account{color:transparent!important;caret-color:#0b1a1d;text-shadow:0 0 11px rgba(11,26,29,.9)}'
      document.head.appendChild(style)
      mark()
      new MutationObserver(mark).observe(document.body, { subtree: true, childList: true, characterData: true })
    })
  }, WALLET, process.env.HIDE || '(?!)')
  let polls = 0
  await page.setRequestInterception(true)
  page.on('request', async (req) => {
    const url = req.url()
    if (url.includes('/api/naira/naira/banks') && BANKS)
      return req.respond({ status: 200, contentType: 'application/json', body: fs.readFileSync(BANKS, 'utf8') })
    // Naira's terms at the time of the run: PAJ's rate then was ₦1,376.47.
    if (url.endsWith('/api/naira/naira'))
      return json(req, { object: 'naira', enabled: true, partner: 'paj', test_mode: false, rate_source: 'paj', cash_out_rate: PAID.rate, min_cash_out: '1.00', max_cash_out: '500.00', min_top_up: '1.00', max_top_up: '500.00' })
    if (url.includes('/api/naira/naira/quote'))
      return json(req, { direction: 'out', naira: PAID.naira, naira_kobo: PAID.naira_kobo, rate: PAID.rate, fee: PAID.fee, rate_source: 'paj' })
    if (url.includes('/cash-outs') && req.method() === 'POST') {
      await wait(1800) // PAJ opens the order and names the account
      return json(req, QUOTED, 201)
    }
    if (url.includes(`/api/naira/cash-outs/${PAID.id}`)) {
      polls += 1
      return json(req, polls >= 3 ? PAID : PAYING)
    }
    return req.continue()
  })
  return { browser, page }
}

/**
 * Frames with their times, then one constant 30 fps video from them. Screenshots in a loop, not the
 * screencast: the screencast only sends CSS-pixel frames (393x852); screenshots come at 2x.
 */
async function record(page, name, run) {
  const dir = path.join(OUT, `.frames-${name}`)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  const frames = []
  let recording = true
  // A tap sent while a screenshot is being taken can be lost, so each tap waits for the one in
  // flight and holds the next until it's sent (a frame or two, invisible at 30 fps).
  let paused = false
  let shooting = Promise.resolve()
  const capturing = (async () => {
    while (recording) {
      if (paused) {
        await wait(4)
        continue
      }
      const asked = Date.now() / 1000
      const file = path.join(dir, `f${String(frames.length).padStart(5, '0')}.jpg`)
      shooting = page.screenshot({ path: file, type: 'jpeg', quality: 93, optimizeForSpeed: true, captureBeyondViewport: false })
      await shooting
      frames.push({ t: (asked + Date.now() / 1000) / 2, file })
    }
  })()
  const taps = []
  const start = Date.now() / 1000
  const tap = async (selector, label, match) => {
    const handles = await page.$$(selector)
    let el = handles[0]
    if (match)
      for (const h of handles) if ((await h.evaluate((n) => n.textContent)).includes(match)) el = h
    if (!el) throw new Error(`no ${selector} ${match ?? ''}`)
    await el.evaluate((n) => n.scrollIntoView({ block: 'nearest' }))
    const box = await el.boundingBox()
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    paused = true
    await shooting
    taps.push({ label, t: Date.now() / 1000 - start, x, y })
    await page.touchscreen.tap(x, y)
    paused = false
  }
  const typed = []
  const type = async (selector, text, delay) => {
    typed.push({ t: Date.now() / 1000 - start, text, delay: delay / 1000 })
    await page.type(selector, text, { delay })
  }
  await run({ tap, type })
  await wait(200)
  recording = false
  await capturing
  const t0 = frames[0].t
  const list = frames
    .map((f, i) => `file '${f.file}'\nduration ${((frames[i + 1]?.t ?? f.t + 0.2) - f.t).toFixed(4)}`)
    .join('\n')
  fs.writeFileSync(path.join(dir, 'list.txt'), `${list}\nfile '${frames.at(-1).file}'\n`)
  execFileSync('ffmpeg', [
    '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'),
    '-fps_mode', 'cfr', '-r', '30', '-c:v', 'libx264', '-crf', '12', '-preset', 'slow', '-pix_fmt', 'yuv420p',
    path.join(OUT, `take-${name}.mp4`),
  ])
  const offset = t0 - start
  fs.writeFileSync(
    path.join(OUT, `take-${name}.json`),
    JSON.stringify(
      {
        frames: frames.length,
        duration: frames.at(-1).t - t0,
        taps: taps.map((p) => ({ ...p, t: +(p.t - offset).toFixed(3) })),
        typed: typed.map((k) => ({ ...k, t: +(k.t - offset).toFixed(3) })),
      },
      null,
      2,
    ),
  )
  fs.rmSync(dir, { recursive: true, force: true })
  console.log(`take-${name}: ${frames.length} frames, ${(frames.at(-1).t - t0).toFixed(1)} s, taps`, taps.map((p) => p.label).join(', '))
}

/** The fonts, and the logos of the banks an OPay number suggests, so nothing pops in on camera. */
async function warm(page) {
  const suggested = /opay|palmpay|moniepoint|kuda|zenith/i
  const logos = BANKS
    ? JSON.parse(fs.readFileSync(BANKS, 'utf8'))
        .data.filter((b) => b.logo && suggested.test(b.name))
        .map((b) => b.logo)
    : [OPAY.logo]
  await page.evaluate(async (urls) => {
    await document.fonts.ready
    await Promise.all(
      urls.map(
        (u) =>
          new Promise((done) => {
            const img = new Image()
            img.onload = img.onerror = done
            img.src = u
          }),
      ),
    )
  }, logos)
}

async function takeA() {
  const { browser, page } = await open()
  await page.goto(`${BASE}/wallet`, { waitUntil: 'networkidle2', timeout: 180000 })
  await page.waitForSelector('.w-cashout')
  await warm(page)
  await wait(2500)
  await record(page, 'a', async ({ tap, type }) => {
    await wait(1200)
    await tap('.w-cashout', 'cash out')
    await page.waitForSelector('input[aria-label="Dollars to cash out"]')
    await wait(900)
    await type('input[aria-label="Dollars to cash out"]', '2', 140)
    await wait(1600)
    await tap('button.cx-go', 'continue')
    await page.waitForSelector('#cx-account')
    await wait(700)
    await type('#cx-account', ACCOUNT, 115)
    await wait(1100)
    await tap('button.cx-tile', 'opay', 'OPay')
    await page.waitForSelector('.cx-named', { timeout: 15000 })
    await wait(1700)
    await tap('button.cx-go', 'continue')
    await page.waitForSelector('.cx-hero', { timeout: 15000 })
    await wait(2000)
    await tap('.cx button.pill', 'send', 'Send')
  })
  await browser.close()
}

async function takeB() {
  const { browser, page } = await open()
  const capture = {
    step: 'sending',
    amount: '2',
    account: ACCOUNT,
    bank: OPAY,
    name: PAID.account_name,
    cashOut: PAYING,
    elapsed: 1700, // the passkey and the relay, before this screen
  }
  await page.goto(`${BASE}/wallet/cash-out/naira?capture=${encodeURIComponent(JSON.stringify(capture))}`, {
    waitUntil: 'domcontentloaded',
    timeout: 180000,
  })
  await page.waitForSelector('.cx-steps', { timeout: 60000 })
  await warm(page)
  await record(page, 'b', async () => {
    await page.waitForSelector('.cx-done', { timeout: 30000 })
    await wait(5000)
  })
  await browser.close()
}

;(async () => {
  const which = process.argv[2]
  if (!which || which === 'a') await takeA()
  if (!which || which === 'b') await takeB()
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
