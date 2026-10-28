import { reloadAppAsync } from 'expo'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import { Appearance, Platform, Settings } from 'react-native'
import { load, save } from './storage'
import { chosenLook, LOOK_KEY } from './theme'

/**
 * Settings that are not money: which side of the counter this phone is on, whether the balance
 * shows, and light or dark. The Kova Card's state lives on Monad and with Kova (lib/card.ts), not
 * here.
 */
export type Mode = 'pay' | 'terminal'

/** Light, dark, or whatever the phone is set to (the default). */
export type Look = 'system' | 'light' | 'dark'

/** Where to go once the app has reloaded for a new look: back to the setting that changed it. */
export const AFTER_RELOAD_KEY = 'KovaAfterReload'

interface Prefs {
  ready: boolean
  mode: Mode
  setMode: (mode: Mode) => void
  /** Hides the balance on Home, for glances in public. */
  hideBalance: boolean
  setHideBalance: (hide: boolean) => void
  look: Look
  /** Saves the look and reloads the app in it (`from` is the screen to come back to). */
  setLook: (look: Look, from?: string) => void
}

const PREFS = 'kova.prefs.v1'
const defaults = { mode: 'pay' as Mode, hideBalance: false }

/** The look this run of the app was drawn in (lib/theme.ts reads it before any style exists). */
const startLook: Look = chosenLook ?? 'system'

// Native parts (the keyboard, alerts, the status bar, sheets' chrome) follow the same look.
Appearance.setColorScheme(chosenLook)

const PrefsContext = createContext<Prefs | null>(null)

export function usePrefs(): Prefs {
  const prefs = useContext(PrefsContext)
  if (!prefs) throw new Error('usePrefs must be used inside <PrefsProvider>')
  return prefs
}

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [state, setState] = useState(defaults)

  useEffect(() => {
    void load(PREFS, defaults).then((saved) => {
      setState({
        mode: saved.mode ?? defaults.mode,
        hideBalance: saved.hideBalance ?? defaults.hideBalance,
      })
      setReady(true)
    })
  }, [])

  // Functional, so two settings changed in one go (a dev link, say) don't undo each other.
  const update = useCallback((change: Partial<typeof defaults>) => {
    setState((current) => {
      const next = { ...current, ...change }
      void save(PREFS, next)
      return next
    })
  }, [])

  return (
    <PrefsContext.Provider
      value={{
        ready,
        mode: state.mode,
        setMode: (mode) => update({ mode }),
        hideBalance: state.hideBalance,
        setHideBalance: (hideBalance) => update({ hideBalance }),
        look: startLook,
        setLook: (look, from) => {
          if (look === startLook || Platform.OS !== 'ios') return
          // Every style is made once, from the look the app started in: redraw it all in the new one.
          Settings.set({ [LOOK_KEY]: look, ...(from ? { [AFTER_RELOAD_KEY]: from } : {}) })
          void reloadAppAsync('Appearance changed')
        },
      }}
    >
      {children}
    </PrefsContext.Provider>
  )
}
