import type { TFunction } from 'i18next'

/** Dose units. Must match the backend list in backend/app/units.py. */
export const DOSE_UNITS = ['ml', 'drops', 'mg', 'mcg', 'g', 'IU', 'tablet', 'puff'] as const
export type DoseUnit = (typeof DOSE_UNITS)[number]

/** A dose amount without float noise or trailing zeros: 0.1 + 0.2 shows as 0.3, 5 as 5, 1.50 as 1.5. */
export const formatAmount = (amount: number): string => String(Number(amount.toFixed(2)))

/** "0.25 ml", "1 drop", "5 drops": amount plus the translated, pluralised unit. */
export function formatDose(amount: number, unit: string, t: TFunction): string {
  return `${formatAmount(amount)} ${t(`units.${unit}`, { count: amount })}`
}
