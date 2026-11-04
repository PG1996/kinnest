import { useTranslation } from 'react-i18next'
import type { Summary } from '../api/hooks'
import { formatAgo } from '../lib/time'
import { Card } from './ui/card'

export default function LastDiaperCard({ summary, now }: { summary: Summary; now: number }) {
  const { t } = useTranslation()
  const d = summary.last_diaper
  if (!d) return <Card>{t('home.noDiaper')}</Card>
  return (
    <Card className="space-y-1">
      <p className="text-lg font-medium">{t('home.lastDiaper', { ago: formatAgo(now - new Date(d.at).getTime()) })}</p>
      <p className="text-muted">
        {t('home.by', { name: d.changed_by_name })} · {t(`diaperKinds.${d.kind}`)}
      </p>
    </Card>
  )
}
