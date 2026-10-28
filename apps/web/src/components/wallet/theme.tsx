'use client'

import { useLayoutEffect, useSyncExternalStore } from 'react'
import {
  applyTheme,
  clearTheme,
  readTheme,
  saveTheme,
  THEME_EVENT,
  type ThemeChoice,
  watchSystemTheme,
} from '@/lib/theme'

function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange)
  window.addEventListener(THEME_EVENT, onChange)
  return () => {
    window.removeEventListener('storage', onChange)
    window.removeEventListener(THEME_EVENT, onChange)
  }
}

/**
 * Keeps the wallet in its appearance while it's open: the phone turning dark at sunset, a choice
 * made in another tab, and light again on leaving the wallet for the rest of the site.
 */
export function WalletTheme() {
  useLayoutEffect(() => {
    const apply = () => applyTheme()
    apply()
    const unwatch = watchSystemTheme(apply)
    const unsubscribe = subscribe(apply)
    return () => {
      unwatch()
      unsubscribe()
      clearTheme()
    }
  }, [])
  return null
}

const CHOICES: [ThemeChoice, string][] = [
  ['system', 'System'],
  ['light', 'Light'],
  ['dark', 'Dark'],
]

/** Profile's Appearance: like the phone (the default), or always light, or always dark. */
export function Appearance() {
  const choice = useSyncExternalStore(subscribe, readTheme, () => 'system' as const)
  return (
    <section className="w-appearance">
      <span className="w-appearance-head">
        <strong>Appearance</strong>
        <small>
          {choice === 'system'
            ? 'Light or dark, like your phone'
            : `Always ${choice}, on this browser`}
        </small>
      </span>
      <fieldset className="w-filters">
        <legend className="sr-only">Appearance</legend>
        {CHOICES.map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`w-filter${choice === value ? ' w-filter-on' : ''}`}
            aria-pressed={choice === value}
            onClick={() => saveTheme(value)}
          >
            {label}
          </button>
        ))}
      </fieldset>
    </section>
  )
}
