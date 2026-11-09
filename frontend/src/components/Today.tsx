import { useTranslation } from 'react-i18next'
import type { Summary } from '../api/hooks'
import { Card } from './ui/card'

export default function Today({ summary }: { summary: Summary }) {
  const { t } = useTranslation()
  return (
    <Card className="py-3 text-sm font-bold text-muted">
      <p>{t('home.todayFeeds', { count: summary.feeds_today })}</p>
    </Card>
  )
}
