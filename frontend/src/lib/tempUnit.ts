import { useSyncExternalStore } from 'react'

/** Temperatures are stored in °C everywhere (server, WHO data, fever line); this is only how they are shown and typed. */
export type TempUnit = 'C' | 'F'

const KEY = 'kinnest.tempUnit'
const listeners = new Set<() => void>()

export function getTempUnit(): TempUnit {
  try {
    return localStorage.getItem(KEY) === 'C' ? 'C' : 'F'
  } catch {
    return 'F'
  }
}

export function setTempUnit(unit: TempUnit) {
  try {
    localStorage.setItem(KEY, unit)
  } catch {
    /* storage blocked: the choice lasts until the page reloads */
  }
  listeners.forEach((l) => l())
}

/** The current unit, re-rendering the component when it changes. */
export function useTempUnit(): [TempUnit, (u: TempUnit) => void] {
  const unit = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => void listeners.delete(cb)
    },
    getTempUnit,
    getTempUnit,
  )
  return [unit, setTempUnit]
}

const one = (n: number) => Math.round(n * 10) / 10
export const cToF = (c: number) => one((c * 9) / 5 + 32)
export const fToC = (f: number) => one(((f - 32) * 5) / 9)
