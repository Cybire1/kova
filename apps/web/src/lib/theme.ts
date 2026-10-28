/**
 * The wallet's appearance: System (the phone's own setting, the default), Light or Dark, kept in this
 * browser. The root layout's script applies it before the first paint; the wallet keeps it in step
 * (components/wallet/theme.tsx). Pages outside the wallet stay light.
 */

export type ThemeChoice = 'system' | 'light' | 'dark'

export const THEME_KEY = 'kova.theme'
/** Fired on window when the choice changes in this tab ('storage' covers the others). */
export const THEME_EVENT = 'kova-theme'
/** The browser's and the phone's top bar, in the page's colour. */
export const BAR = { light: '#E7E5E0', dark: '#000000' }

const DARK_QUERY = '(prefers-color-scheme: dark)'

export function readTheme(): ThemeChoice {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    return saved === 'light' || saved === 'dark' ? saved : 'system'
  } catch {
    return 'system'
  }
}

export function saveTheme(choice: ThemeChoice) {
  try {
    localStorage.setItem(THEME_KEY, choice)
  } catch {
    // Private browsing: the choice lasts until the page closes.
  }
  applyTheme(choice)
  window.dispatchEvent(new Event(THEME_EVENT))
}

/** Dark when chosen, or when following a phone that's dark. */
export function isDark(choice: ThemeChoice = readTheme()) {
  return choice === 'dark' || (choice === 'system' && window.matchMedia(DARK_QUERY).matches)
}

export function applyTheme(choice: ThemeChoice = readTheme()) {
  setDark(isDark(choice))
}

/** Leaving the wallet: the rest of the site is light. */
export function clearTheme() {
  setDark(false)
}

function setDark(dark: boolean) {
  const root = document.documentElement
  if (dark) root.dataset.theme = 'dark'
  else delete root.dataset.theme
  for (const meta of document.querySelectorAll('meta[name="theme-color"]'))
    meta.setAttribute('content', dark ? BAR.dark : BAR.light)
}

export function watchSystemTheme(onChange: () => void) {
  const media = window.matchMedia(DARK_QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

/**
 * The same, as the inline script the root layout runs in <head> before anything paints: ?theme=
 * (dark, light or system) is saved for this browser, then the wallet's pages are dark when chosen
 * or when the phone is.
 */
export const THEME_SCRIPT = `(function(){var c='system';try{var q=new URLSearchParams(location.search).get('theme');if(q==='dark'||q==='light'||q==='system')localStorage.setItem('${THEME_KEY}',q);var s=localStorage.getItem('${THEME_KEY}');if(s==='dark'||s==='light')c=s}catch(e){}try{if(!/^\\/wallet(\\/|$)/.test(location.pathname))return;if(c==='dark'||(c==='system'&&matchMedia('${DARK_QUERY}').matches)){document.documentElement.dataset.theme='dark';var bar=function(){document.querySelectorAll('meta[name="theme-color"]').forEach(function(m){m.setAttribute('content','${BAR.dark}')})};bar();document.addEventListener('DOMContentLoaded',bar)}}catch(e){}})()`
