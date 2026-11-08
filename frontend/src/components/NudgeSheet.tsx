import { useTranslation } from 'react-i18next'
import Sheet from './Sheet'
import { Button } from './ui/button'

const MINUTES = [5, 10, 15, 30, 60]

/** After a partial dose: offer a one-off reminder for the rest. */
export default function NudgeSheet({ left, onPick, onSkip }: { left: string; onPick: (minutes: number) => void; onSkip: () => void }) {
  const { t } = useTranslation()
  return (
    <Sheet title={t('medicines.nudgeTitle')} onClose={onSkip}>
      <p>{t('medicines.nudgeText', { left })}</p>
      <div className="grid grid-cols-3 gap-3">
        {MINUTES.map((m) => (
          <Button key={m} variant="soft" onClick={() => onPick(m)}>
            {t('medicines.nudgeIn', { minutes: m })}
          </Button>
        ))}
      </div>
      <Button variant="ghost" className="w-full" onClick={onSkip}>
        {t('medicines.nudgeNo')}
      </Button>
    </Sheet>
  )
}
