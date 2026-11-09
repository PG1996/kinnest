import { CalendarDays, Syringe } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import type { Vaccination, Visit } from '../api/hooks'
import { cn } from '../lib/cn'
import { formatDay } from '../lib/time'
import { formatWhen } from '../lib/vitalsFormat'
import { Card } from './ui/card'

const WEEK_MS = 7 * 24 * 3600_000

const ROW = 'flex items-center gap-3 rounded-tile bg-surface-2/60 px-3 py-2.5 text-sm font-bold'

/** Home card: overdue vaccines, and vaccines and visits in the next 7 days. */
export default function UpcomingCard({ vaccines, visits, now }: { vaccines: Vaccination[]; visits: Visit[]; now: number }) {
  const { t } = useTranslation()
  const vax = vaccines.filter((v) => v.status === 'pending' && (v.overdue || v.days_until <= 7))
  const soon = visits.filter((v) => v.status === 'upcoming' && Date.parse(v.scheduled_at) <= now + WEEK_MS)
  if (vax.length === 0 && soon.length === 0) return null
  const when = (v: Vaccination) =>
    v.overdue
      ? t('upcoming.overdue', { date: formatDay(v.due_date) })
      : v.days_until === 0
        ? t('upcoming.today')
        : t('upcoming.inDays', { count: v.days_until })
  return (
    <Card role="region" aria-label={t('upcoming.title')} className="space-y-2 p-4">
      <h2 className="text-[13px] font-semibold text-muted">{t('upcoming.title')}</h2>
      <ul className="space-y-2">
        {vax.map((v) => (
          <li key={v.id}>
            <Link to="/health?tab=vaccines" className={cn(ROW, v.overdue ? 'bg-warn-bg text-warn-ink' : '')}>
              <Syringe size={20} aria-hidden="true" className="shrink-0 text-sleep" />
              {t('upcoming.vaccine', { name: `${v.name} ${v.dose_label}`.trim(), when: when(v) })}
            </Link>
          </li>
        ))}
        {soon.map((v) => (
          <li key={v.id}>
            <Link to="/health?tab=visits" className={ROW}>
              <CalendarDays size={20} aria-hidden="true" className="shrink-0 text-sleep" />
              {t('upcoming.visit', { who: [v.doctor, v.reason].filter(Boolean).join(' · '), when: formatWhen(v.scheduled_at) })}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  )
}
