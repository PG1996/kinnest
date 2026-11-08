import i18n from '../i18n'
import type { VitalInput } from '../api/hooks'

export type MeasurementKey = 'weight_kg' | 'height_cm' | 'head_cm' | 'temperature_c' | 'heart_rate' | 'resp_rate' | 'spo2'

export type Measurement = { key: MeasurementKey; label: string; unit: string; min: number; max: number; decimals: number }

/** Same ranges as the server (backend/app/api/vitals.py and the database CHECKs). label and unit are i18n keys. */
export const MEASUREMENTS: Measurement[] = [
  { key: 'weight_kg', label: 'vitals.measurements.weight_kg', unit: 'vitals.units.weight_kg', min: 0.3, max: 60, decimals: 2 },
  { key: 'height_cm', label: 'vitals.measurements.height_cm', unit: 'vitals.units.height_cm', min: 20, max: 150, decimals: 1 },
  { key: 'head_cm', label: 'vitals.measurements.head_cm', unit: 'vitals.units.head_cm', min: 20, max: 60, decimals: 1 },
  { key: 'temperature_c', label: 'vitals.measurements.temperature_c', unit: 'vitals.units.temperature_c', min: 30, max: 45, decimals: 1 },
  { key: 'heart_rate', label: 'vitals.measurements.heart_rate', unit: 'vitals.units.heart_rate', min: 30, max: 300, decimals: 0 },
  { key: 'resp_rate', label: 'vitals.measurements.resp_rate', unit: 'vitals.units.resp_rate', min: 5, max: 120, decimals: 0 },
  { key: 'spo2', label: 'vitals.measurements.spo2', unit: 'vitals.units.spo2', min: 50, max: 100, decimals: 0 },
]

const MAX_FUTURE_MS = 5 * 60_000

/** Field -> message for everything wrong with an entry ({} when it can be saved). `_form` holds entry-wide problems. */
export function validateVital(input: Partial<VitalInput>): Record<string, string> {
  const t = i18n.t.bind(i18n)
  const errors: Record<string, string> = {}
  let any = false
  for (const m of MEASUREMENTS) {
    const v = input[m.key]
    if (v === null || v === undefined) continue
    any = true
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      errors[m.key] = t('vitals.errors.number')
      continue
    }
    if (m.decimals === 0 && !Number.isInteger(v)) {
      errors[m.key] = t('vitals.errors.number')
      continue
    }
    if (v < m.min || v > m.max) {
      let msg = t('vitals.errors.range', { label: t(m.label), min: m.min, max: m.max, unit: t(m.unit) })
      if (m.key === 'temperature_c' && v >= 86 && v <= 113)
        msg += ' ' + t('vitals.errors.fahrenheit', { value: v, celsius: (((v - 32) * 5) / 9).toFixed(1) })
      errors[m.key] = msg
    }
  }
  if (!any) errors._form = t('vitals.errors.none')
  if (input.measured_at && Date.parse(input.measured_at) > Date.now() + MAX_FUTURE_MS)
    errors.measured_at = t('vitals.errors.future')
  return errors
}
