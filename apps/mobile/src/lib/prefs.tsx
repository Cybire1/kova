import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import { load, save } from './storage'

/**
 * Settings that are not money: which side of the counter this phone is on, and whether the
 * balance shows. The Kova Card's state lives on Monad and with Kova (lib/card.ts), not here.
 */
export type Mode = 'pay' | 'terminal'

interface Prefs {
  ready: boolean
  mode: Mode
  setMode: (mode: Mode) => void
  /** Hides the balance on Home, for glances in public. */
  hideBalance: boolean
  setHideBalance: (hide: boolean) => void
}

const PREFS = 'kova.prefs.v1'
const defaults = { mode: 'pay' as Mode, hideBalance: false }

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

  const update = useCallback((next: typeof defaults) => {
    setState(next)
    void save(PREFS, next)
  }, [])

  return (
    <PrefsContext.Provider
      value={{
        ready,
        mode: state.mode,
        setMode: (mode) => update({ ...state, mode }),
        hideBalance: state.hideBalance,
        setHideBalance: (hideBalance) => update({ ...state, hideBalance }),
      }}
    >
      {children}
    </PrefsContext.Provider>
  )
}
