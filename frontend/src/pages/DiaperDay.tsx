import { ChevronLeft, ChevronRight, Droplets } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDiaperRange, useMe, type DiaperKind } from '../api/hooks'
import DiaperForm from '../components/DiaperForm'
import DiaperWeek from '../components/DiaperWeek'
import PageHeader from '../components/PageHeader'
import RowLink from '../components/RowLink'
import { Button, IconButton } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { EmptyState } from '../components/ui/empty'
import { formatTime, toLocalDate } from '../lib/time'
import { useNow } from '../lib/useNow'

const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const KINDS: DiaperKind[] = ['wet', 'dirty', 'both']

/** One day of diapers: counts by kind, the list, and past diapers added. Fixing or deleting one happens in the timeline. */
export default function DiaperDay() {
  const { t } = useTranslation()
  const canEdit = (useMe().data?.role ?? 'viewer') !== 'viewer'
  const now = useNow()
  const [day, setDay] = useState(() => midnight(new Date()))
  const isToday = day.getTime() === midnight(new Date(now)).getTime()
  const range = useMemo(() => ({ from: day, to: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999) }), [day])
  const data = useDiaperRange(range.from, range.to).data
  // the week chart: the six days before this one, plus this one
  const weekFrom = useMemo(() => new Date(day.getFullYear(), day.getMonth(), day.getDate() - 6), [day])
  const week = useDiaperRange(weekFrom, range.to).data
  const rows = (Array.isArray(data) ? data : [])
    .filter((d) => Date.parse(d.at) >= range.from.getTime() && Date.parse(d.at) <= range.to.getTime())
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  const [form, setForm] = useState(false)
  const shift = (days: number) => setDay(new Date(day.getFullYear(), day.getMonth(), day.getDate() + days))
  const label = isToday ? t('timeline.today') : day.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
  const count = (k: DiaperKind) => rows.filter((r) => r.kind === k).length

  return (
    <>
      <PageHeader title={t('diapers.title')} />
      <div className="flex items-center justify-between">
        <IconButton label={t('diapers.prevDay')} onClick={() => shift(-1)}>
          <ChevronLeft size={20} aria-hidden="true" />
        </IconButton>
        <span className="font-semibold">{label}</span>
        <IconButton label={t('diapers.nextDay')} onClick={() => shift(1)} disabled={isToday} className="disabled:opacity-40">
          <ChevronRight size={20} aria-hidden="true" />
        </IconButton>
      </div>
      <Card tone="diaper" className="p-3">
        <div data-testid="diaper-counts" className="grid grid-cols-4 gap-2 text-center">
          <div>
            <span className="block text-xl font-bold tabular-nums">{rows.length}</span>
            <span className="block text-[11px] font-semibold text-diaper-ink">{t('diapers.total')}</span>
          </div>
          {KINDS.map((k) => (
            <div key={k}>
              <span className="block text-xl font-bold tabular-nums">{count(k)}</span>
              <span className="block text-[11px] font-semibold text-muted">{t(`diaperKinds.${k}`)}</span>
            </div>
          ))}
        </div>
      </Card>
      {Array.isArray(week) && (
        <Card className="space-y-2 p-4">
          <h2 className="text-sm font-semibold text-muted">{t('diapers.weekTitle')}</h2>
          <DiaperWeek diapers={week} day={day} />
        </Card>
      )}
      {canEdit && (
        <Button variant="soft" className="w-full" onClick={() => setForm(true)}>
          {t('diapers.addPast')}
        </Button>
      )}
      {data !== undefined && rows.length === 0 && <EmptyState icon={<Droplets size={28} />} title={t('diapers.none')} />}
      <ul aria-label={t('diapers.listLabel')} className="space-y-2">
        {rows.map((d) => (
          <li key={d.id}>
            <RowLink to={`/timeline?day=${toLocalDate(new Date(d.at))}&entry=diaper:${d.id}`} enabled={canEdit} label={t('timeline.edit')}>
              <Card tone="diaper" className="space-y-1 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">{t(`diaperKinds.${d.kind}`)}</span>
                  <span className="text-sm font-semibold text-diaper-ink">{formatTime(d.at)}</span>
                </div>
                <p className="text-sm text-muted">{[t('home.by', { name: d.changed_by_name }), d.note].filter(Boolean).join(' · ')}</p>
              </Card>
            </RowLink>
          </li>
        ))}
      </ul>
      {form && <DiaperForm onClose={() => setForm(false)} />}
    </>
  )
}
