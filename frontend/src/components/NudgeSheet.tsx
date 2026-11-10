import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatClock } from '../lib/time'
import NudgeOffset, { presetsFrom, useNudgeLabel } from './NudgeOffset'
import Sheet from './Sheet'
import { Button } from './ui/button'

/** After a partial dose: offer a one-off reminder for the rest. One tap on a time sets it; Other takes any hours and minutes. */
export default function NudgeSheet({ left, from, onPick, onSkip }: { left: string; from: number; onPick: (minutes: number) => void; onSkip: () => void }) {
  const { t } = useTranslation()
  const label = useNudgeLabel()
  const [other, setOther] = useState(false)
  const [custom, setCustom] = useState<number | null>(null)
  return (
    <Sheet title={t('medicines.nudgeTitle')} onClose={onSkip}>
      <p>{t('medicines.nudgeText', { left })}</p>
      <p className="text-sm text-muted">{t('medicines.nudgeFrom', { time: formatClock(new Date(from).toISOString()) })}</p>
      <div className="grid grid-cols-3 gap-3">
        {presetsFrom(from).map((m) => (
          <Button key={m} variant="soft" onClick={() => onPick(m)}>
            {label(m)}
          </Button>
        ))}
        <Button variant="outline" aria-expanded={other} onClick={() => setOther((o) => !o)}>
          {t('medicines.nudgeOther')}
        </Button>
      </div>
      {other && (
        <div className="space-y-3">
          <NudgeOffset from={from} onChange={setCustom} />
          <Button className="w-full" disabled={custom === null} onClick={() => custom !== null && onPick(custom)}>
            {t('medicines.nudgeSet')}
          </Button>
        </div>
      )}
      <Button variant="ghost" className="w-full" onClick={onSkip}>
        {t('medicines.nudgeNo')}
      </Button>
    </Sheet>
  )
}
