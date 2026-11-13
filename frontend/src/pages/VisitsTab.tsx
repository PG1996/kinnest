import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useKid, useMe, useVisits, type Visit, type VisitStatus } from '../api/hooks'
import HistoryCalendar, { PickedDay, StatusMark } from '../components/HistoryCalendar'
import Sheet from '../components/Sheet'
import VisitForm, { type VisitFormMode } from '../components/VisitForm'
import { Button, linkButtonClass } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { useCreateVisit, useDeleteVisit, useUpdateVisit, type VisitInput } from '../hooks/log'
import { dayOfIso, groupByDay, MARK_COLOR, monthOf, monthRange } from '../lib/calendar'
import { cn } from '../lib/cn'
import { toLocalDate } from '../lib/time'
import { formatValues, formatWhen } from '../lib/vitalsFormat'

const STATUSES: VisitStatus[] = ['upcoming', 'done', 'cancelled']
const dayOf = (v: Visit) => dayOfIso(v.scheduled_at)

export default function VisitsTab() {
  const { t } = useTranslation()
  const role = useMe().data?.role ?? 'viewer'
  const canEdit = role !== 'viewer'
  const visits = useVisits().data ?? []
  const create = useCreateVisit()
  const update = useUpdateVisit()
  const remove = useDeleteVisit()
  const [form, setForm] = useState<{ mode: VisitFormMode; v?: Visit } | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const birth = useKid().data?.birth_date
  const [today] = useState(() => toLocalDate(new Date()))
  const [month, setMonth] = useState(() => monthOf(today))
  const [day, setDay] = useState<string | null>(null)
  const [hidden, setHidden] = useState<Set<VisitStatus>>(new Set())
  const [newDay, setNewDay] = useState<string | undefined>()
  const shown = visits.filter((v) => !hidden.has(v.status))
  const days = groupByDay(shown, dayOf)
  const picked = day ? (days.get(day) ?? []).slice().sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)) : []
  // the server lists upcoming soonest first, then the rest newest first
  const upcoming = shown.filter((v) => v.status === 'upcoming')
  const past = shown.filter((v) => v.status !== 'upcoming')
  const flip = (st: VisitStatus) => {
    const next = new Set(hidden)
    if (next.has(st)) next.delete(st)
    else next.add(st)
    setHidden(next)
  }
  const close = () => {
    setForm(null)
    setNewDay(undefined)
  }

  const save = (body: VisitInput) => {
    const done = { onSuccess: close }
    if (form?.mode === 'add') create.mutate(body, done)
    else if (form?.v) update.mutate({ id: form.v.id, ...body }, done)
  }

  const row = (v: Visit) => (
    <li key={v.id}>
      <Card tone={v.status === 'upcoming' ? 'sleep' : 'plain'} data-testid={`visit-${v.id}`} className="space-y-1 p-4">
        <div className="flex items-baseline justify-between gap-2 text-sm font-bold text-muted">
          <span>{formatWhen(v.scheduled_at)}</span>
          {v.status !== 'upcoming' && <span>{t(`visits.status.${v.status}`)}</span>}
        </div>
        <p className="text-base font-bold">{[v.doctor, v.place].filter(Boolean).join(' · ')}</p>
        {v.reason && <p className="text-sm">{v.reason}</p>}
        {v.notes && <p className="text-sm">{t('visits.notesLabel', { text: v.notes })}</p>}
        {v.prescription_notes && <p className="text-sm">{t('visits.prescriptionLabel', { text: v.prescription_notes })}</p>}
        {v.vitals && v.vitals.length > 0 && (
          <p className="text-sm font-medium text-primary">{t('visits.vitalsLabel', { values: v.vitals.map((x) => formatValues(t, x)).join(' · ') })}</p>
        )}
        {canEdit && (
          <div className="flex flex-wrap gap-2 pt-1">
            {confirming === v.id ? (
              <>
                <Button variant="danger" onClick={() => remove.mutate(v.id, { onSuccess: () => setConfirming(null) })}>
                  {t('visits.confirmDelete')}
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(null)}>
                  {t('visits.keep')}
                </Button>
              </>
            ) : (
              <>
                {v.status === 'upcoming' && (
                  <>
                    <Button onClick={() => setForm({ mode: 'done', v })}>{t('visits.markDone')}</Button>
                    <Button variant="soft" onClick={() => update.mutate({ id: v.id, status: 'cancelled' })}>
                      {t('visits.cancelVisit')}
                    </Button>
                  </>
                )}
                {v.status === 'cancelled' && (
                  <Button variant="soft" onClick={() => update.mutate({ id: v.id, status: 'upcoming' })}>
                    {t('visits.restore')}
                  </Button>
                )}
                {v.status === 'done' && role === 'admin' && (
                  <Link to="/health?tab=medicines&add=1" className={linkButtonClass('soft')}>
                    {t('visits.addMedicine')}
                  </Link>
                )}
                <Button variant="ghost" onClick={() => setForm({ mode: 'edit', v })}>
                  {t('visits.edit')}
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(v.id)}>
                  {t('visits.delete')}
                </Button>
              </>
            )}
          </div>
        )}
      </Card>
    </li>
  )

  return (
    <div className="space-y-4">
      {canEdit && <Button onClick={() => setForm({ mode: 'add' })}>{t('visits.add')}</Button>}
      <HistoryCalendar
        label={t('visits.calendar.label')}
        days={days}
        month={month}
        onMonth={setMonth}
        selected={day}
        onSelect={setDay}
        range={monthRange(groupByDay(visits, dayOf).keys(), today, birth)}
        firstDay={birth}
        marks={(l) => l.slice(0, 3).map((v) => <StatusMark key={v.id} kind={v.status} />)}
        describe={(l) =>
          STATUSES.map((st) => [st, l.filter((v) => v.status === st).length] as const)
            .filter(([, n]) => n > 0)
            .map(([st, n]) => `${n} ${t(`visits.status.${st}`).toLowerCase()}`)
            .join(', ')
        }
        mini={(l) => MARK_COLOR[STATUSES.find((st) => l.some((v) => v.status === st))!]}
        summary={(count) => t('visits.calendar.days', { count })}
      >
        <div role="group" aria-label={t('visits.calendar.statusLabel')} className="flex flex-wrap gap-1.5">
          {STATUSES.map((st) => (
            <button
              key={st}
              type="button"
              aria-pressed={!hidden.has(st)}
              onClick={() => flip(st)}
              className={cn(
                'flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold',
                hidden.has(st) ? 'border-dashed border-line text-muted' : 'border-line',
              )}
            >
              <span className={cn(hidden.has(st) && 'opacity-30')}>
                <StatusMark kind={st} className="size-3" />
              </span>
              {t(`visits.status.${st}`)}
            </button>
          ))}
        </div>
      </HistoryCalendar>
      {visits.length === 0 && <p className="text-sm text-muted">{t('visits.empty')}</p>}
      {day && (
        <section className="space-y-2">
          <PickedDay day={day} count={picked.length ? t('visits.calendar.count', { count: picked.length }) : ''} onClear={() => setDay(null)} />
          {picked.length > 0 ? (
            <ul className="space-y-2">{picked.map(row)}</ul>
          ) : (
            <div className="space-y-3 rounded-card bg-surface p-4 text-sm text-muted">
              <p>{t('calendar.emptyDay')}</p>
              {canEdit && (
                <Button
                  variant="soft"
                  onClick={() => {
                    setNewDay(day)
                    setForm({ mode: 'add' })
                  }}
                >
                  {t('visits.calendar.addDay')}
                </Button>
              )}
            </div>
          )}
        </section>
      )}
      {!day && upcoming.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-bold uppercase tracking-wide text-muted">{t('visits.upcoming')}</h3>
          <ul className="space-y-2">{upcoming.map(row)}</ul>
        </section>
      )}
      {!day && past.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-bold uppercase tracking-wide text-muted">{t('visits.past')}</h3>
          <ul className="space-y-2">{past.map(row)}</ul>
        </section>
      )}
      {form && (
        <Sheet
          title={t(form.mode === 'add' ? 'visits.form.addTitle' : form.mode === 'edit' ? 'visits.form.editTitle' : 'visits.form.doneTitle')}
          onClose={close}
        >
          <VisitForm
            mode={form.mode}
            initial={form.v}
            day={form.mode === 'add' ? newDay : undefined}
            saving={create.isPending || update.isPending}
            serverError={(form.mode === 'add' ? create.error : update.error)?.message}
            onSave={save}
          />
        </Sheet>
      )}
    </div>
  )
}
