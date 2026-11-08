import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useMe, useVisits, type Visit } from '../api/hooks'
import Sheet from '../components/Sheet'
import VisitForm, { type VisitFormMode } from '../components/VisitForm'
import { Button, linkButtonClass } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { useCreateVisit, useDeleteVisit, useUpdateVisit, type VisitInput } from '../hooks/log'
import { formatWhen } from '../lib/vitalsFormat'

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
  // the server lists upcoming soonest first, then the rest newest first
  const upcoming = visits.filter((v) => v.status === 'upcoming')
  const past = visits.filter((v) => v.status !== 'upcoming')

  const save = (body: VisitInput) => {
    const done = { onSuccess: () => setForm(null) }
    if (form?.mode === 'add') create.mutate(body, done)
    else if (form?.v) update.mutate({ id: form.v.id, ...body }, done)
  }

  const row = (v: Visit) => (
    <li key={v.id}>
      <Card className="space-y-1 p-4">
        <div className="flex items-baseline justify-between gap-2 text-sm text-muted">
          <span>{formatWhen(v.scheduled_at)}</span>
          {v.status !== 'upcoming' && <span>{t(`visits.status.${v.status}`)}</span>}
        </div>
        <p className="font-medium">{[v.doctor, v.place].filter(Boolean).join(' · ')}</p>
        {v.reason && <p className="text-sm">{v.reason}</p>}
        {v.notes && <p className="text-sm">{t('visits.notesLabel', { text: v.notes })}</p>}
        {v.prescription_notes && <p className="text-sm">{t('visits.prescriptionLabel', { text: v.prescription_notes })}</p>}
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
                  <Link to="/medicines?add=1" className={linkButtonClass('soft')}>
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
      {visits.length === 0 && <p className="text-sm text-muted">{t('visits.empty')}</p>}
      {upcoming.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-medium">{t('visits.upcoming')}</h3>
          <ul className="space-y-2">{upcoming.map(row)}</ul>
        </section>
      )}
      {past.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-medium">{t('visits.past')}</h3>
          <ul className="space-y-2">{past.map(row)}</ul>
        </section>
      )}
      {form && (
        <Sheet
          title={t(form.mode === 'add' ? 'visits.form.addTitle' : form.mode === 'edit' ? 'visits.form.editTitle' : 'visits.form.doneTitle')}
          onClose={() => setForm(null)}
        >
          <VisitForm
            mode={form.mode}
            initial={form.v}
            saving={create.isPending || update.isPending}
            serverError={(form.mode === 'add' ? create.error : update.error)?.message}
            onSave={save}
          />
        </Sheet>
      )}
    </div>
  )
}
