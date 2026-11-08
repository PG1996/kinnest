import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { useMe, useVaccines, useVaccineTemplates, type Vaccination } from '../api/hooks'
import Sheet from '../components/Sheet'
import TemplatePicker from '../components/TemplatePicker'
import VaccineForm, { type VaccineFormMode } from '../components/VaccineForm'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { useApplyTemplate, useCreateVaccine, useDeleteVaccine, useUpdateVaccine, type VaccineInput } from '../hooks/log'
import { cn } from '../lib/cn'
import { formatDay } from '../lib/time'

type Group = 'overdue' | 'soon' | 'later' | 'done'
const GROUPS: Group[] = ['overdue', 'soon', 'later', 'done']
const groupOf = (v: Vaccination): Group =>
  v.status !== 'pending' ? 'done' : v.overdue ? 'overdue' : v.days_until <= 30 ? 'soon' : 'later'

export default function VaccinesTab() {
  const { t } = useTranslation()
  const canEdit = (useMe().data?.role ?? 'viewer') !== 'viewer'
  const kid = useQuery({ queryKey: ['kid'], queryFn: () => api<{ birth_date: string | null }>('/api/kid') })
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

  if (vaccines.isPending || kid.isPending) return <p className="text-sm text-muted">{t('common.loading')}</p>
  const list = vaccines.data ?? []
  const noBirth = !kid.data?.birth_date
  const birthHint = noBirth && (
    <p className="text-sm text-muted">
      <span>{t('vaccines.noBirthDate')}</span>{' '}
      <Link to="/settings" className="text-primary underline">
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
            <TemplatePicker
              templates={templates}
              disabled={noBirth || apply.isPending}
              onPick={(id) => apply.mutate({ template_id: id, mode: 'fill' })}
            />
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

  const save = (body: VaccineInput) => {
    const done = { onSuccess: () => setForm(null) }
    if (form?.mode === 'add') create.mutate(body, done)
    else if (form?.v) update.mutate({ id: form.v.id, ...body }, done)
  }
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
      {list.length === 0 && <p className="text-sm text-muted">{t('vaccines.empty')}</p>}
      {GROUPS.map((g) => {
        const items = list.filter((v) => groupOf(v) === g)
        if (items.length === 0) return null
        return (
          <section key={g} className="space-y-2">
            <h3 className={cn('font-medium', g === 'overdue' && 'text-danger')}>{t(`vaccines.groups.${g}`)}</h3>
            <ul className="space-y-2">
              {items.map((v) => (
                <li key={v.id}>
                  <Card className="space-y-1 p-4">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium">{`${v.name} ${v.dose_label}`.trim()}</span>
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-xs',
                          v.overdue ? 'bg-danger/15 text-danger' : v.status === 'given' ? 'bg-primary/15' : 'bg-line/50',
                        )}
                      >
                        {t(`vaccines.status.${v.overdue ? 'overdue' : v.status}`)}
                      </span>
                    </div>
                    <p className="text-sm text-muted">
                      {v.status === 'given' && v.given_on
                        ? [t('vaccines.givenOn', { date: formatDay(v.given_on) }), v.place && t('vaccines.at', { place: v.place })]
                            .filter(Boolean)
                            .join(' ')
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
                            {v.status !== 'given' && (
                              <Button onClick={() => setForm({ mode: 'given', v })}>{t('vaccines.markGiven')}</Button>
                            )}
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
              ))}
            </ul>
          </section>
        )
      })}
      {form && (
        <Sheet
          title={t(form.mode === 'add' ? 'vaccines.form.addTitle' : form.mode === 'edit' ? 'vaccines.form.editTitle' : 'vaccines.form.givenTitle')}
          onClose={() => setForm(null)}
        >
          <VaccineForm mode={form.mode} initial={form.v} saving={saving} serverError={saveError} onSave={save} />
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
