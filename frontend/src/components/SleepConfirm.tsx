import { useTranslation } from 'react-i18next'
import type { Sleep } from '../api/hooks'
import { formatAgo, formatTime } from '../lib/time'
import Sheet from './Sheet'
import { Button } from './ui/button'

/** "Start sleep?" or "Wake up?": nothing is logged until this is confirmed, so an accidental touch does no harm. */
export default function SleepConfirm({ open, now, onConfirm, onCancel }: { open: Sleep | null; now: number; onConfirm: () => void; onCancel: () => void }) {
  const { t } = useTranslation()
  return (
    <Sheet title={t(open ? 'sleep.confirmEndTitle' : 'sleep.confirmStartTitle')} onClose={onCancel}>
      <p className="text-base">
        {open
          ? t('sleep.confirmEndBody', { ago: formatAgo(now - Date.parse(open.started_at)), time: formatTime(open.started_at) })
          : t('sleep.confirmStartBody', { time: formatTime(now) })}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Button variant="outline" size="lg" onClick={onCancel}>
          {t('sleep.cancel')}
        </Button>
        <Button size="lg" onClick={onConfirm}>
          {t(open ? 'sleep.confirmEnd' : 'sleep.confirmStart')}
        </Button>
      </div>
    </Sheet>
  )
}
