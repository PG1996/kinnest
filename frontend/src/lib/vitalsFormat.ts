import type { TFunction } from 'i18next'
import type { PlaceKind, Vital } from '../api/hooks'
import { MEASUREMENTS, type MeasurementKey } from './vitals'

export const PLACES: PlaceKind[] = ['home', 'hospital', 'clinic', 'other']

export const formatValue = (t: TFunction, key: MeasurementKey, v: number) =>
  `${v} ${t(MEASUREMENTS.find((m) => m.key === key)!.unit)}`

/** "3.42 kg · 36.8 °C": every measurement the entry has, in the standard order. */
export const formatValues = (t: TFunction, v: Partial<Vital>) =>
  MEASUREMENTS.filter((m) => v[m.key] != null)
    .map((m) => formatValue(t, m.key, v[m.key] as number))
    .join(' · ')

export const formatPlace = (t: TFunction, kind: PlaceKind, name?: string) =>
  name ? `${t(`vitals.places.${kind}`)}, ${name}` : t(`vitals.places.${kind}`)

export const formatWhen = (iso: string) => {
  const d = new Date(iso)
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
}
