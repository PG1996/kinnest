import { CheckCircle2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ApiError } from '../api/client'
import { useKid, useMe, useVaccines, useVaccineTemplates, type Vaccination } from '../api/hooks'
import HistoryCalendar, { PickedDay, StatusMark } from '../components/HistoryCalendar'
import Sheet from '../components/Sheet'
import TemplatePicker from '../components/TemplatePicker'
import VaccineForm, { type VaccineFormMode } from '../components/VaccineForm'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { useApplyTemplate, useCreateVaccine, useDeleteVaccine, useUpdateVaccine, type VaccineInput } from '../hooks/log'
import { groupByDay, MARK_COLOR, monthOf, monthRange, type MarkKind } from '../lib/calendar'
import { cn } from '../lib/cn'
import { formatDay, toLocalDate } from '../lib/time'

type Group = 'overdue' | 'soon' | 'later' | 'done'
const GROUPS: Group[] = ['overdue', 'soon', 'later', 'done']
type Mark = Extract<MarkKind, 'given' | 'due' | 'overdue' | 'skipped'>
const MARKS: Mark[] = ['overdue', 'due', 'given', 'skipped']
const markOf = (v: Vaccination): Mark => (v.status === 'given' ? 'given' : v.status === 'skipped' ? 'skipped' : v.overdue ? 'overdue' : 'due')
/** A vaccine sits on the calendar on the day it was given, or on its due day until then. */
const dayOf = (v: Vaccination) => v.given_on ?? v.due_date
const groupOf = (v: Vaccination): Group => (v.status !== 'pending' ? 'done' : v.overdue ? 'overdue' : v.days_until <= 30 ? 'soon' : 'later')

export default function VaccinesTab() {
  const { t } = useTranslation()
  const canEdit = (useMe().data?.role ?? 'viewer') !== 'viewer'
  const kid = useKid()
  const vaccines = useVaccines()
  const templates = useVaccineTemplates().data ?? []
  const apply = useApplyTemplate()
  const create = useCreateVaccine()
  const update = useUpdateVaccine()
  const remove = useDeleteVaccine()
  const [startedEmpty, setStartedEmpty] = useState(false)
  const [form, setForm] = useState<{ mode: VaccineFormMode; v?: Vaccination } | null>(null)
  const [pickMissing, setPickMissing] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [today] = useState(() => toLocalDate(new Date()))
  const [month, setMonth] = useState(() => monthOf(today))
  const [day, setDay] = useState<string | null>(null)
  const [hidden, setHidden] = useState<Set<Mark>>(new Set())
  const [newDay, setNewDay] = useState<string | undefined>()

  if (vaccines.isPending || kid.isPending) return <p className="text-sm text-muted">{t('common.loading')}</p>
  const list = vaccines.data ?? []
  const noBirth = !kid.data?.birth_date
  const birthHint = noBirth && (
    <p className="text-sm text-muted">
      <span>{t('vaccines.noBirthDate')}</span>{' '}
      <Link to="/family?tab=settings" className="text-primary underline">
        {t('vitals.charts.noBirthDateLink')}
      </Link>
    </p>
  )
  const applyError =
    apply.error instanceof ApiError && apply.error.status === 409 && apply.error.message !== 'birth date not set'
      ? t('vaccines.picker.exists')
      : apply.error?.message
  const doctorFirst = <p className="text-sm text-muted">{t('vaccines.doctorFirst')}</p>

  if (list.length === 0 && !startedEmpty) {
    return (
      <div className="space-y-4">
        <h2 className="font-medium">{t('vaccines.picker.title')}</h2>
        <p className="text-sm text-muted">{t('vaccines.picker.intro')}</p>
        {doctorFirst}
        {birthHint}
        {canEdit ? (
          <>
            <TemplatePicker templates={templates} disabled={noBirth || apply.isPending} onPick={(id) => apply.mutate({ template_id: id, mode: 'fill' })} />
            {applyError && <p className="text-sm text-danger">{applyError}</p>}
            <Button variant="ghost" onClick={() => setStartedEmpty(true)}>
              {t('vaccines.picker.empty')}
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted">{t('vaccines.empty')}</p>
        )}
      </div>
    )
  }

  const shown = list.filter((v) => !hidden.has(markOf(v)))
  const days = groupByDay(shown, dayOf)
  const flip = (m: Mark) => {
    const next = new Set(hidden)
    if (next.has(m)) next.delete(m)
    else next.add(m)
    setHidden(next)
  }
  const picked = day ? (days.get(day) ?? []) : []
  const calendar = (
    <HistoryCalendar
      label={t('vaccines.calendar.label')}
      days={days}
      month={month}
      onMonth={setMonth}
      selected={day}
      onSelect={setDay}
      range={monthRange(groupByDay(list, dayOf).keys(), today, kid.data?.birth_date)}
      firstDay={kid.data?.birth_date}
      marks={(l) =>
        MARKS.map((m) => {
          const n = l.filter((v) => markOf(v) === m).length
          return n ? (
            <span key={m} className="inline-flex items-center gap-px">
              <StatusMark kind={m} />
              {n > 1 && n}
            </span>
          ) : null
        })
      }
      describe={(l) =>
        MARKS.map((m) => [m, l.filter((v) => markOf(v) === m).length] as const)
          .filter(([, n]) => n > 0)
          .map(([m, n]) => `${n} ${t(`vaccines.status.${m === 'due' ? 'pending' : m}`).toLowerCase()}`)
          .join(', ')
      }
      mini={(l) => MARK_COLOR[MARKS.find((m) => l.some((v) => markOf(v) === m))!]}
      summary={(count) => t('vaccines.calendar.days', { count })}
    >
      <div role="group" aria-label={t('vaccines.calendar.statusLabel')} className="flex flex-wrap gap-1.5">
        {MARKS.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={!hidden.has(m)}
            onClick={() => flip(m)}
            className={cn(
              'flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold',
              hidden.has(m) ? 'border-dashed border-line text-muted' : 'border-line',
            )}
          >
            <span className={cn(hidden.has(m) && 'opacity-30')}>
              <StatusMark kind={m} className="size-3" />
            </span>
            {t(`vaccines.status.${m === 'due' ? 'pending' : m}`)}
          </button>
        ))}
      </div>
    </HistoryCalendar>
  )

  const save = (body: VaccineInput) => {
    const done = {
      onSuccess: () => {
        setForm(null)
        setNewDay(undefined)
      },
    }
    if (form?.mode === 'add') create.mutate(body, done)
    else if (form?.v) update.mutate({ id: form.v.id, ...body }, done)
  }
  const row = (v: Vaccination) => (
    <li key={v.id}>
      <Card tone={v.overdue ? 'warn' : 'plain'} data-testid={`vaccine-${v.id}`} data-done={v.status === 'given' ? 'true' : 'false'} className="space-y-1 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 font-bold">
            {v.status === 'given' && <CheckCircle2 size={20} aria-hidden="true" className="text-diaper" />}
            {`${v.name} ${v.dose_label}`.trim()}
          </span>
          <span
            className={cn(
              'rounded-full px-2.5 py-0.5 text-xs font-bold',
              v.overdue ? 'bg-surface text-warn-ink' : v.status === 'given' ? 'bg-diaper-bg text-diaper-ink' : 'bg-surface-2',
            )}
          >
            {t(`vaccines.status.${v.overdue ? 'overdue' : v.status}`)}
          </span>
        </div>
        <p className="text-sm text-muted">
          {v.status === 'given' && v.given_on
            ? [t('vaccines.givenOn', { date: formatDay(v.given_on) }), v.place && t('vaccines.at', { place: v.place })].filter(Boolean).join(' ')
            : t('vaccines.due', { date: formatDay(v.due_date) })}
        </p>
        {v.notes && <p className="text-sm">{v.notes}</p>}
        {canEdit && (
          <div className="flex flex-wrap gap-2 pt-1">
            {confirming === v.id ? (
              <>
                <Button variant="danger" onClick={() => remove.mutate(v.id, { onSuccess: () => setConfirming(null) })}>
                  {t('vaccines.confirmDelete')}
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(null)}>
                  {t('vaccines.cancel')}
                </Button>
              </>
            ) : (
              <>
                {v.status !== 'given' && <Button onClick={() => setForm({ mode: 'given', v })}>{t('vaccines.markGiven')}</Button>}
                {v.status === 'pending' ? (
                  <Button variant="soft" onClick={() => update.mutate({ id: v.id, status: 'skipped' })}>
                    {t('vaccines.skip')}
                  </Button>
                ) : (
                  // a mis-tapped Skip (or a wrong "given") can be put back on the schedule
                  <Button variant="soft" onClick={() => update.mutate({ id: v.id, status: 'pending' })}>
                    {t('vaccines.restore')}
                  </Button>
                )}
                <Button variant="ghost" onClick={() => setForm({ mode: 'edit', v })}>
                  {t('vaccines.edit')}
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(v.id)}>
                  {t('vaccines.delete')}
                </Button>
              </>
            )}
          </div>
        )}
      </Card>
    </li>
  )

  const saving = create.isPending || update.isPending
  const saveError = (form?.mode === 'add' ? create.error : update.error)?.message

  return (
    <div className="space-y-4">
      {doctorFirst}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setForm({ mode: 'add' })}>{t('vaccines.add')}</Button>
          <Button variant="soft" onClick={() => setPickMissing(true)}>
            {t('vaccines.addMissing')}
          </Button>
        </div>
      )}
      {calendar}
      {list.length === 0 && <p className="text-sm text-muted">{t('vaccines.empty')}</p>}
      {day && (
        <section className="space-y-2">
          <PickedDay day={day} count={picked.length ? t('vaccines.calendar.count', { count: picked.length }) : ''} onClear={() => setDay(null)} />
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
                  {t('vaccines.calendar.addDay')}
                </Button>
              )}
            </div>
          )}
        </section>
      )}
      {!day &&
        GROUPS.map((g) => {
          const items = shown.filter((v) => groupOf(v) === g)
          // what is still to come stays soonest first; what is done is newest first, by the day it was given
          if (g === 'done') items.sort((a, b) => (b.given_on ?? b.due_date).localeCompare(a.given_on ?? a.due_date))
          if (items.length === 0) return null
          return (
            <section key={g} className="space-y-2">
              <h3 className={cn('text-sm font-bold uppercase tracking-wide text-muted', g === 'overdue' && 'text-warn-ink')}>{t(`vaccines.groups.${g}`)}</h3>
              <ul className="space-y-2">{items.map(row)}</ul>
            </section>
          )
        })}
      {form && (
        <Sheet
          title={t(form.mode === 'add' ? 'vaccines.form.addTitle' : form.mode === 'edit' ? 'vaccines.form.editTitle' : 'vaccines.form.givenTitle')}
          onClose={() => {
            setForm(null)
            setNewDay(undefined)
          }}
        >
          <VaccineForm mode={form.mode} initial={form.v} day={form.mode === 'add' ? newDay : undefined} saving={saving} serverError={saveError} onSave={save} />
        </Sheet>
      )}
      {pickMissing && (
        <Sheet title={t('vaccines.addMissing')} onClose={() => setPickMissing(false)}>
          {birthHint}
          <TemplatePicker
            templates={templates}
            disabled={noBirth || apply.isPending}
            onPick={(id) => apply.mutate({ template_id: id, mode: 'add_missing' }, { onSuccess: () => setPickMissing(false) })}
          />
          {apply.error && <p className="text-sm text-danger">{apply.error.message}</p>}
        </Sheet>
      )}
    </div>
  )
}
