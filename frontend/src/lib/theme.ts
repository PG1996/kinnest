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

/**
 * Keeps the theme right while the app stays open: `night` flips at 22:00 and 06:00, `auto` when the phone does.
 * Mount it once, in the app shell (the settings screen is not always open).
 */
export function useThemeSync() {
  useEffect(() => {
    const run = () => applyMode(readMode())
    run()
    const id = window.setInterval(run, 60_000)
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    mq?.addEventListener?.('change', run)
    return () => {
      window.clearInterval(id)
      mq?.removeEventListener?.('change', run)
    }
  }, [])
}

export function useThemeMode(): [ThemeMode, (m: ThemeMode) => void] {
  const [mode, setModeState] = useState<ThemeMode>(readMode)
  const setMode = (m: ThemeMode) => {
    try {
      localStorage.setItem(KEY, m)
    } catch {
      /* ignore */
    }
    applyMode(m)
    setModeState(m)
  }
  return [mode, setMode]
}
