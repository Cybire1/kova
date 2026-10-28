'use client'

import { useEffect, useState } from 'react'
import { Icon } from '@/components/brand'
import { useWallet } from './provider'

/** Chrome's install prompt, held until the person asks for it. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const KEY = 'kova.web.install.v1'
const QUIET = 14 * 86_400_000

/** Apps whose own browsers can't add to the Home Screen (in-app.tsx says how to get out of them). */
const IN_APP =
  /Twitter|Instagram|FBAN|FBAV|FB_IAB|LinkedInApp|Snapchat|TikTok|musical_ly|BytedanceWebview|\bLine\//i

const standalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true

function dismissedLately() {
  try {
    const at = Number(localStorage.getItem(KEY))
    return Number.isFinite(at) && Date.now() - at < QUIET
  } catch {
    return false
  }
}

/**
 * Kova on the Home Screen: it opens full screen, no browser bars, like the app. Offered on phones
 * that aren't running it that way yet, once Kova has been used: Android installs in one tap (the
 * browser's own prompt), an iPhone gets the three steps. Not now hides it for two weeks.
 */
export function InstallPrompt() {
  // Offered once Kova has been useful (a payment, a send, money in), not on a first visit.
  const { activity } = useWallet()
  const [how, setHow] = useState<'ios' | 'prompt' | null>(null)
  const [held, setHeld] = useState<InstallPromptEvent | null>(null)
  const [steps, setSteps] = useState(false)

  useEffect(() => {
    if (standalone() || dismissedLately()) return
    if (!window.matchMedia('(pointer: coarse)').matches) return
    const ua = navigator.userAgent
    if (/iPhone|iPad|iPod/i.test(ua) && !IN_APP.test(ua)) setHow('ios')
    const offered = (event: Event) => {
      event.preventDefault()
      setHeld(event as InstallPromptEvent)
      setHow('prompt')
    }
    const installed = () => setHow(null)
    window.addEventListener('beforeinstallprompt', offered)
    window.addEventListener('appinstalled', installed)
    return () => {
      window.removeEventListener('beforeinstallprompt', offered)
      window.removeEventListener('appinstalled', installed)
    }
  }, [])

  if (!how || activity.length === 0) return null

  const later = () => {
    try {
      localStorage.setItem(KEY, String(Date.now()))
    } catch {
      // Private browsing: it simply comes back next time.
    }
    setHow(null)
  }

  const add = async () => {
    if (how === 'ios') return setSteps(true)
    if (!held) return
    await held.prompt()
    const { outcome } = await held.userChoice
    if (outcome === 'accepted') setHow(null)
  }

  return (
    <>
      <div className="w-install">
        {/* biome-ignore lint/performance/noImgElement: the app icon, 192 px, already sized */}
        <img className="w-install-icon" src="/icons/kova-192.png" alt="" width={44} height={44} />
        <span className="w-install-text">
          <strong>Get Kova full screen</strong>
          <small>Add it to your Home Screen. It opens like an app.</small>
        </span>
        <button type="button" className="w-install-add" onClick={() => void add()}>
          Add
        </button>
        <button type="button" className="w-install-x" aria-label="Not now" onClick={later}>
          <Icon name="close" size={14} />
        </button>
      </div>
      {steps ? <IosSteps onClose={() => setSteps(false)} /> : null}
    </>
  )
}

/** Where Share is in each iPhone browser (all of them can add to the Home Screen since iOS 16.4). */
function whereShareIs() {
  const ua = navigator.userAgent
  if (/CriOS/.test(ua)) return 'The share icon in Chrome’s address bar, at the top right'
  if (/EdgiOS/.test(ua)) return 'In Edge’s menu, at the bottom'
  if (/FxiOS/.test(ua)) return 'In Firefox’s menu, under •••'
  return 'In Safari’s bar, or under ••• on newer iPhones'
}

/** An iPhone can't be asked from a page, so it gets the three taps, in its browser's own words. */
function IosSteps({ onClose }: { onClose: () => void }) {
  const [closing, setClosing] = useState(false)
  const close = () => {
    setClosing(true)
    setTimeout(onClose, 240)
  }
  return (
    <>
      <button
        type="button"
        aria-label="Close"
        className={`w-sheet-scrim${closing ? ' w-sheet-out' : ''}`}
        onClick={close}
      />
      {/CriOS/.test(navigator.userAgent) ? (
        <span className={`w-install-arrow${closing ? ' w-sheet-out' : ''}`} aria-hidden="true">
          <Icon name="up" size={22} />
        </span>
      ) : null}
      <div
        className={`w-sheet w-install-sheet${closing ? ' w-sheet-out' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="w-install-title"
      >
        <button type="button" className="w-sheet-grab" aria-label="Close" onClick={close} />
        {/* biome-ignore lint/performance/noImgElement: the app icon, 192 px, already sized */}
        <img className="w-install-hero" src="/icons/kova-192.png" alt="" width={72} height={72} />
        <h2 className="w-sheet-h w-center" id="w-install-title">
          Add Kova to your Home Screen
        </h2>
        <p className="w-fine w-center">Then it opens full screen, with no browser bars.</p>
        <ol className="w-install-steps">
          <li>
            <span className="w-install-n">1</span>
            <span>
              Tap <strong>Share</strong>
              <span className="w-install-glyph" aria-hidden="true">
                <Icon name="share" size={16} />
              </span>
              <small>{whereShareIs()}</small>
            </span>
          </li>
          <li>
            <span className="w-install-n">2</span>
            <span>
              Tap <strong>Add to Home Screen</strong>
              <span className="w-install-glyph" aria-hidden="true">
                <Icon name="plus" size={16} />
              </span>
              <small>Scroll down the list if you don’t see it</small>
            </span>
          </li>
          <li>
            <span className="w-install-n">3</span>
            <span>
              Open <strong>Kova</strong> from your Home Screen
              <small>Sign in with your passkey: your wallet is there</small>
            </span>
          </li>
        </ol>
        <button type="button" className="pill pill-block" data-tone="ink" onClick={close}>
          <span className="pill-label">Got it</span>
          <span className="pill-cap">
            <Icon name="check" size={18} />
          </span>
        </button>
      </div>
    </>
  )
}
