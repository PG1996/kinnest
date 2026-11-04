import { useTranslation } from 'react-i18next'
import type { Summary } from '../api/hooks'
import { Card } from './ui/card'

export default function Today({ summary }: { summary: Summary }) {
  const { t } = useTranslation()
  const d = summary.diapers_today
  return (
    <Card className="space-y-1 text-sm text-muted">
      <p>{t('home.todayFeeds', { count: summary.feeds_today })}</p>
      <p>{t('home.todayDiapers', { wet: d.wet, dirty: d.dirty, both: d.both })}</p>
    </Card>
  )
}
