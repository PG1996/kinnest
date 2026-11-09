import { ChevronLeft, ChevronRight, Droplets } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDiaperRange, useMe, type Diaper, type DiaperKind } from '../api/hooks'
import DiaperForm from '../components/DiaperForm'
import PageHeader from '../components/PageHeader'
import { Button, IconButton } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { EmptyState } from '../components/ui/empty'
import { useUndoDiaper } from '../hooks/log'
import { formatTime } from '../lib/time'
import { useNow } from '../lib/useNow'

const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const KINDS: DiaperKind[] = ['wet', 'dirty', 'both']

/** One day of diapers: counts by kind, the list, and past diapers added, fixed or deleted. */
export default function DiaperDay() {
  const { t } = useTranslation()
  const canEdit = (useMe().data?.role ?? 'viewer') !== 'viewer'
  const now = useNow()
  const [day, setDay] = useState(() => midnight(new Date()))
  const isToday = day.getTime() === midnight(new Date(now)).getTime()
  const range = useMemo(() => ({ from: day, to: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999) }), [day])
  const data = useDiaperRange(range.from, range.to).data
  const rows = (Array.isArray(data) ? data : [])
    .filter((d) => Date.parse(d.at) >= range.from.getTime() && Date.parse(d.at) <= range.to.getTime())
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  const [form, setForm] = useState<{ diaper?: Diaper } | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const remove = useUndoDiaper()
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
      {canEdit && (
        <Button variant="soft" className="w-full" onClick={() => setForm({})}>
          {t('diapers.addPast')}
        </Button>
      )}
      {data !== undefined && rows.length === 0 && <EmptyState icon={<Droplets size={28} />} title={t('diapers.none')} />}
      <ul aria-label={t('diapers.listLabel')} className="space-y-2">
        {rows.map((d) => (
          <li key={d.id}>
            <Card tone="diaper" className="space-y-1 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">{t(`diaperKinds.${d.kind}`)}</span>
                <span className="text-sm font-semibold text-diaper-ink">{formatTime(d.at)}</span>
              </div>
              <p className="text-sm text-muted">{[t('home.by', { name: d.changed_by_name }), d.note].filter(Boolean).join(' · ')}</p>
              {canEdit && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {confirming === d.id ? (
                    <>
                      <Button variant="danger" onClick={() => remove.mutate(d.id, { onSuccess: () => setConfirming(null) })}>
                        {t('diapers.confirmDelete')}
                      </Button>
                      <Button variant="ghost" onClick={() => setConfirming(null)}>
                        {t('diapers.keep')}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button variant="outline" onClick={() => setForm({ diaper: d })}>
                        {t('diapers.edit')}
                      </Button>
                      <Button variant="ghost" onClick={() => setConfirming(d.id)}>
                        {t('diapers.delete')}
                      </Button>
                    </>
                  )}
                </div>
              )}
            </Card>
          </li>
        ))}
      </ul>
      {form && <DiaperForm key={form.diaper?.id ?? 'new'} diaper={form.diaper} onClose={() => setForm(null)} />}
    </>
  )
}
