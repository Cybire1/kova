import fs from 'node:fs'
import puppeteer from 'puppeteer-core'
export const LINK = process.env.LINK
export async function open({ profile = 'lucia', locale = 'es-ES', tz = 'Europe/Madrid' } = {}) {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
    userDataDir: `/Users/cyber/.claude/jobs/15cd9816/tmp/chrome-${profile}`,
    args: [`--lang=${locale}`, '--window-size=393,852'],
  })
  const page = await browser.newPage()
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1')
  await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  await page.emulateTimezone(tz)
  await page.setExtraHTTPHeaders({ 'Accept-Language': `${locale},es;q=0.9,en;q=0.8` })
  const cdp = await page.createCDPSession()
  await cdp.send('WebAuthn.enable')
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } })
  return { browser, page, cdp, authenticatorId }
}
export function recorder(cdp, dir) {
  fs.mkdirSync(dir, { recursive: true })
  const frames = []
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    const i = frames.length
    fs.writeFileSync(`${dir}/f${String(i).padStart(5, '0')}.jpg`, Buffer.from(data, 'base64'))
    frames.push(metadata.timestamp)
    await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
  })
  return {
    start: () => cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 }),
    stop: async () => { await cdp.send('Page.stopScreencast'); fs.writeFileSync(`${dir}/times.json`, JSON.stringify(frames)); return frames.length },
  }
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export async function buttons(page) {
  return page.$$eval('button, a[role=button], a', (els) => els.filter((e) => e.offsetParent).map((e) => (e.innerText || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ')).filter(Boolean).slice(0, 25))
}
