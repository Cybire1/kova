const fs = require('node:fs')
const path = require('node:path')
const puppeteer = require('../../node_modules/puppeteer-core')

const root = path.resolve(__dirname, '../../..')
const out = path.join(root, 'output/contest-flyer')
const embed = (file) => fs.readFileSync(path.join(root, file)).toString('base64')
const font = (weight, file) => `@font-face{font-family:Manrope;font-weight:${weight};src:url(data:font/ttf;base64,${embed(`film/public/fonts/${file}`)}) format('truetype');font-display:block}`
const logo = `<svg width="219" height="64" viewBox="0 0 342 100" fill="none" aria-label="Kova"><g transform="translate(-6,-6) scale(.56)"><path d="M62 46V154" stroke="#0B1A1D" stroke-width="19" stroke-linecap="round"/><g stroke="#D46558" stroke-width="17" stroke-linecap="round"><path d="M92.6 74.3A40 40 0 0 1 92.6 125.7"/><path d="M115.6 55A70 70 0 0 1 115.6 145"/><path d="M138.6 35.7A100 100 0 0 1 138.6 164.3"/></g></g><g transform="translate(101,4) scale(.91)" stroke="#0B1A1D" stroke-width="15.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 8V92M12 70L40 38M26 56L44 92"/><circle cx="86" cy="65" r="27" fill="#EBB3AA"/><path d="M130 40L150 92L170 40"/><circle cx="212" cy="66" r="26"/><path d="M238 40V92"/></g></svg>`
const arrow = `<svg width="31" height="31" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`
const star = `<svg viewBox="0 0 100 100" fill="none"><path d="m50 18 9.7 19.6 21.6 3.1-15.6 15.2 3.7 21.5L50 67.3 30.6 77.4l3.7-21.5L18.7 40.7l21.6-3.1L50 18Z" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/></svg>`
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Kova · Thread contest winners</title><style>
${font(500, 'Manrope_500Medium.ttf')}${font(600, 'Manrope_600SemiBold.ttf')}${font(700, 'Manrope_700Bold.ttf')}${font(800, 'Manrope_800ExtraBold.ttf')}
*{box-sizing:border-box}html,body{margin:0;width:1080px;height:1350px;background:#E7E5E0;color:#0B1A1D;font-family:Manrope,sans-serif;-webkit-font-smoothing:antialiased}body{padding:60px 64px;overflow:hidden}.poster{height:1230px;display:flex;flex-direction:column}.top{display:flex;align-items:center;justify-content:space-between}.tag{display:flex;align-items:center;gap:11px;border:2px solid #0B1A1D;border-radius:99px;padding:13px 21px;font-size:17px;font-weight:700;letter-spacing:.025em}.tag i{width:10px;height:10px;background:#D46558;border-radius:50%}.intro{margin-top:62px}.eyebrow{font-size:19px;font-weight:700;letter-spacing:3px;text-transform:uppercase;margin:0 0 24px}h1{font-size:108px;line-height:1.035;font-weight:800;letter-spacing:-6.8px;margin:0}h1 span{color:#46878B}.card{margin-top:48px;border:3px solid #0B1A1D;border-radius:42px;background:#609598;position:relative;overflow:hidden;min-height:478px;padding:36px 40px 36px;isolation:isolate}.rings{position:absolute;width:510px;height:510px;right:-190px;top:-194px;z-index:-1;color:#376B70;opacity:.36}.card-top{display:flex;align-items:center;justify-content:space-between}.card-label{font-size:23px;font-weight:600;color:#F1EFEA}.check{width:40px;height:40px;background:#F1EFEA;border:2px solid #0B1A1D;border-radius:50%;display:grid;place-items:center}.check svg{width:23px;height:23px}.result{color:#F1EFEA;font-size:112px;font-weight:800;letter-spacing:-6.5px;line-height:1.03;margin:44px 0 0}.card-bottom{display:flex;align-items:center;justify-content:space-between;margin-top:32px}.result-pill{display:inline-flex;align-items:center;gap:10px;border-radius:99px;background:#0B1A1D;color:#F1EFEA;font-size:17px;font-weight:700;padding:14px 20px}.result-pill i{width:8px;height:8px;background:#EBB3AA;border-radius:99px}.award{position:absolute;right:30px;bottom:25px;width:126px;height:126px;transform:rotate(13deg)}.award::before,.award::after{content:"";position:absolute;bottom:-18px;width:32px;height:70px;background:#D46558;border:2px solid #0B1A1D;z-index:-1}.award::before{left:25px;transform:rotate(14deg)}.award::after{right:25px;transform:rotate(-14deg)}.medal{width:126px;height:126px;background:#EBB3AA;border:3px solid #0B1A1D;border-radius:50%;padding:13px;outline:2px solid #0B1A1D;outline-offset:-12px}.medal svg{width:100%;height:100%}.thanks{border:3px solid #0B1A1D;border-radius:30px;background:#EBB3AA;padding:23px 24px 23px 30px;display:flex;align-items:center;justify-content:space-between;margin-top:22px;min-height:105px}.thanks strong{font-size:28px;font-weight:700;letter-spacing:-.7px}.arrow{width:55px;height:55px;display:grid;place-items:center;border-radius:50%;background:#0B1A1D;color:#F1EFEA}.footer{margin-top:auto;padding-top:29px;border-top:2px solid #0B1A1D;display:flex;align-items:center;justify-content:space-between;font-weight:700;font-size:24px;letter-spacing:-.4px}.footer .community{font-size:16px;letter-spacing:1.7px;color:#566568;font-weight:700}.footer .right{display:flex;gap:23px;align-items:center}.footer .divider{height:19px;border-left:2px solid #AFB5B1}
</style></head><body><main class="poster"><header class="top">${logo}<div class="tag"><i></i>Community spotlight</div></header><section class="intro"><p class="eyebrow">The Kova Thread Contest</p><h1>Your words.<br><span>Your moment.</span></h1></section><section class="card"><svg class="rings" viewBox="0 0 510 510" fill="none" stroke="currentColor" stroke-width="2"><circle cx="255" cy="255" r="245"/><circle cx="255" cy="255" r="192"/><circle cx="255" cy="255" r="139"/><circle cx="255" cy="255" r="86"/></svg><div class="card-top"><span class="card-label">#KovaThreadContest</span><span class="check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 12 4 4 8-8"/></svg></span></div><p class="result">The winners<br>are in.</p><div class="card-bottom"><span class="result-pill"><i></i>Winner announcement</span></div><div class="award"><div class="medal">${star}</div></div></section><section class="thanks"><strong>You told our story. Thank you.</strong><span class="arrow">${arrow}</span></section><footer class="footer"><span class="community">DOLLARS FOR EVERY PHONE.</span><div class="right"><span>@kovafinance</span><span class="divider"></span><span>mykova.app</span></div></footer></main></body></html>`

async function main() {
  fs.mkdirSync(out, { recursive: true })
  fs.writeFileSync(path.join(out, 'kova-thread-contest-ui-v1.html'), html)
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true, args: ['--no-sandbox'],
  })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 2 })
    await page.setContent(html, { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready)
    const checks = await page.evaluate(() => ({
      fonts: document.fonts.check('800 108px Manrope'),
      fits: document.querySelector('.thanks').getBoundingClientRect().bottom < document.querySelector('.footer').getBoundingClientRect().top,
      overflow: document.documentElement.scrollWidth > 1080,
    }))
    if (!checks.fonts || !checks.fits || checks.overflow) throw Error(JSON.stringify(checks))
    await page.screenshot({ path: path.join(out, 'kova-thread-contest-ui-v1.png') })
    await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 1 })
    await page.screenshot({ path: path.join(out, 'kova-thread-contest-ui-v1-social.png') })
    console.log(JSON.stringify({ checks, output: out, sizes: ['2160×2700', '1080×1350'], editable: 'kova-thread-contest-ui-v1.html' }))
  } finally { await browser.close() }
}
main().catch((e) => { console.error(e.message); process.exitCode = 1 })
