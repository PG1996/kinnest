import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from './ui/field'

/** The reminder times offered for the rest of a dose, in minutes: 1, 2, 4, 6 and 8 hours. Anything else is "Other". */
export const NUDGE_PRESETS = [60, 120, 240, 360, 480]
/** The server only takes a reminder within the next 24 hours. */
export const MAX_NUDGE_MINUTES = 24 * 60

export function useNudgeLabel() {
  const { t } = useTranslation()
  return (minutes: number) => t(minutes === 60 ? 'medicines.nudgeHr' : 'medicines.nudgeHrs', { count: minutes / 60 })
}

/** Hours and minutes typed by hand; reports the total in minutes, or null while it is empty or out of range. */
export default function NudgeOffset({ onChange }: { onChange: (minutes: number | null) => void }) {
  const { t } = useTranslation()
  const [hours, setHours] = useState('')
  const [minutes, setMinutes] = useState('')
  const total = (h: string, m: string) => {
    if (h === '' && m === '') return null
    const n = (Number(h) || 0) * 60 + (Number(m) || 0)
    return Number.isInteger(n) && n >= 1 && n <= MAX_NUDGE_MINUTES ? n : NaN
  }
  const report = (h: string, m: string) => {
    const n = total(h, m)
    onChange(n === null || Number.isNaN(n) ? null : n)
  }
  const bad = Number.isNaN(total(hours, minutes))
  return (
    <div className="space-y-2">
      <div className="flex items-end gap-3">
        <label className="flex-1 space-y-1 text-[13px] font-semibold text-muted">
          {t('medicines.nudgeHours')}
          <Input
            type="number"
            inputMode="numeric"
            min="0"
            max="24"
            value={hours}
            onChange={(e) => {
              setHours(e.target.value)
              report(e.target.value, minutes)
            }}
          />
        </label>
        <label className="flex-1 space-y-1 text-[13px] font-semibold text-muted">
          {t('medicines.nudgeMinutes')}
          <Input
            type="number"
            inputMode="numeric"
            min="0"
            max="59"
            value={minutes}
            onChange={(e) => {
              setMinutes(e.target.value)
              report(hours, e.target.value)
            }}
          />
        </label>
      </div>
      {bad && <p className="text-sm text-danger">{t('medicines.nudgeInvalid')}</p>}
    </div>
  )
}
