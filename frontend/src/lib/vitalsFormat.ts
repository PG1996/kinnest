import type { TFunction } from 'i18next'
import type { PlaceKind, Vital } from '../api/hooks'
import { formatTime } from './time'
import { MEASUREMENTS, shownUnit, shownValue, type MeasurementKey } from './vitals'

export const PLACES: PlaceKind[] = ['home', 'hospital', 'clinic', 'other']

export const formatValue = (t: TFunction, key: MeasurementKey, v: number) =>
  `${shownValue(key, v)} ${t(shownUnit(MEASUREMENTS.find((m) => m.key === key)!))}`

/** "3.42 kg · 36.8 °C": every measurement the entry has, in the standard order. */
export const formatValues = (t: TFunction, v: Partial<Vital>) =>
  MEASUREMENTS.filter((m) => v[m.key] != null)
    .map((m) => formatValue(t, m.key, v[m.key] as number))
    .join(' · ')

export const formatPlace = (t: TFunction, kind: PlaceKind, name?: string) =>
  name ? `${t(`vitals.places.${kind}`)}, ${name}` : t(`vitals.places.${kind}`)

export const formatWhen = (iso: string) => {
  const d = new Date(iso)
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })} ${formatTime(d)}`
}

/** "▲ 0.14 kg", "▼ 10 bpm" or "no change": a reading against the one before, in the units the user sees. */
export function formatDelta(t: TFunction, key: MeasurementKey, latest: number, previous: number): string {
  const m = MEASUREMENTS.find((x) => x.key === key)!
  const step = 10 ** -m.decimals
  const diff = Math.round((shownValue(key, latest) - shownValue(key, previous)) / step) * step
  if (diff === 0) return t('vitals.charts.noChange')
  return `${diff > 0 ? '▲' : '▼'} ${Number(Math.abs(diff).toFixed(m.decimals))} ${t(shownUnit(m))}`
}
