import { useEffect, useState } from 'react'

export type ThemeMode = 'light' | 'dark' | 'auto' | 'night'

const KEY = 'kinnest.theme'
const MODES: ThemeMode[] = ['light', 'dark', 'auto', 'night']

/** `night` is dark from 22:00 to 06:00 (local), light otherwise; `auto` follows the phone. */
export function resolveTheme(mode: ThemeMode, now: Date, prefersDark: boolean): 'light' | 'dark' {
  if (mode === 'light' || mode === 'dark') return mode
  if (mode === 'auto') return prefersDark ? 'dark' : 'light'
  const h = now.getHours()
  return h >= 22 || h < 6 ? 'dark' : 'light'
}

export function readMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved && (MODES as string[]).includes(saved)) return saved as ThemeMode
  } catch {
    /* storage blocked: follow the system */
  }
  return 'auto'
}

const systemDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false

export function applyMode(mode: ThemeMode, now = new Date()) {
  document.documentElement.dataset.theme = resolveTheme(mode, now, systemDark())
}

/** Call once at startup, before React renders, so the first paint has the right colours. */
export function initTheme() {
  applyMode(readMode())
}

export function useThemeMode(): [ThemeMode, (m: ThemeMode) => void] {
  const [mode, setModeState] = useState<ThemeMode>(readMode)
  useEffect(() => {
    applyMode(mode)
    // `night` flips at 22:00 and 06:00, `auto` when the phone does
    const id = window.setInterval(() => applyMode(mode), 60_000)
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    const onChange = () => applyMode(mode)
    mq?.addEventListener?.('change', onChange)
    return () => {
      window.clearInterval(id)
      mq?.removeEventListener?.('change', onChange)
    }
  }, [mode])
  const setMode = (m: ThemeMode) => {
    try {
      localStorage.setItem(KEY, m)
    } catch {
      /* ignore */
    }
    setModeState(m)
  }
  return [mode, setMode]
}
