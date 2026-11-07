import { useTranslation } from 'react-i18next'
import type { Medicine } from '../api/hooks'
import { formatAgo } from '../lib/time'
import Sheet from './Sheet'
import { Button } from './ui/button'

/** Asks before an as-needed dose is logged inside the medicine's minimum gap. The server never refuses it. */
export default function GiveAsNeededSheet({
  medicine,
  now,
  onConfirm,
  onCancel,
}: {
  medicine: Medicine
  now: number
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const last = medicine.last_dose
  return (
    <Sheet title={t('medicines.gapTitle')} onClose={onCancel}>
      <p>
        {t('medicines.gapConfirm', {
          ago: last ? formatAgo(now - Date.parse(last.given_at)) : '',
          hours: medicine.min_gap_hours ?? 0,
        })}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Button onClick={onConfirm}>{t('medicines.giveAnyway')}</Button>
        <Button variant="ghost" onClick={onCancel}>
          {t('medicines.cancel')}
        </Button>
      </div>
    </Sheet>
  )
}
