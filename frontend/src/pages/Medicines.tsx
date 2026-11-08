import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { useMe, useMedicines, type Medicine } from '../api/hooks'
import MedicineForm from '../components/MedicineForm'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { formatDose } from '../lib/units'

export default function MedicinesPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const isAdmin = useMe().data?.role === 'admin'
  const all = useMedicines(true).data ?? []
  const current = all.filter((m) => !m.ended)
  const past = all.filter((m) => m.ended)
  const [editing, setEditing] = useState<Medicine | 'new' | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [params, setParams] = useSearchParams()
  useEffect(() => {
    // "Add medicine" after a doctor visit opens this page with the form open
    if (isAdmin && params.get('add') === '1') {
      setEditing('new')
      setParams({}, { replace: true })
    }
  }, [isAdmin, params, setParams])
  const refresh = () => qc.invalidateQueries({ queryKey: ['medicines'] })

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      editing && editing !== 'new'
        ? api(`/api/medicines/${editing.id}`, { method: 'PATCH', json: body })
        : api('/api/medicines', { json: body }),
    onSuccess: () => {
      setEditing(null)
      refresh()
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/medicines/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setConfirming(null)
      refresh()
    },
  })

  const describe = (m: Medicine) =>
    m.schedule_kind === 'fixed'
      ? t('medicines.page.fixed', { times: m.times.join(', ') })
      : m.schedule_kind === 'interval'
        ? t('medicines.page.interval', { hours: m.interval_hours ?? 0 })
        : m.min_gap_hours
          ? t('medicines.page.asNeededGap', { hours: m.min_gap_hours })
          : t('medicines.page.asNeeded')

  const card = (m: Medicine) => (
    <Card key={m.id} className="space-y-2">
      <p className="text-lg font-medium">{m.dose_amount != null && m.dose_unit ? `${m.name} · ${formatDose(m.dose_amount, m.dose_unit, t)}` : m.name}</p>
      {isAdmin && m.dose_amount == null && <p className="text-sm text-danger">{t('medicines.page.setDose')}</p>}
      <p className="text-sm text-muted">{describe(m)}</p>
      <p className="text-sm text-muted">
        {t('medicines.page.from', { date: m.start_date })}
        {m.end_date && ` ${t('medicines.page.until', { date: m.end_date })}`}
      </p>
      {isAdmin && (
        <div className="flex flex-wrap gap-2">
          <Button variant="soft" onClick={() => setEditing(m)}>
            {t('medicines.page.edit')}
          </Button>
          {confirming === m.id ? (
            <>
              <Button variant="danger" onClick={() => remove.mutate(m.id)}>
                {t('medicines.page.confirmDelete')}
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(null)}>
                {t('medicines.form.cancel')}
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => setConfirming(m.id)}>
              {t('medicines.page.delete')}
            </Button>
          )}
        </div>
      )}
    </Card>
  )

  return (
    <>
      <h1 className="text-xl font-semibold">{t('medicines.page.title')}</h1>
      {isAdmin && editing === null && <Button onClick={() => setEditing('new')}>{t('medicines.page.add')}</Button>}
      {editing !== null && (
        <MedicineForm
          key={editing === 'new' ? 'new' : editing.id}
          medicine={editing === 'new' ? undefined : editing}
          saving={save.isPending}
          failed={save.isError}
          onSave={(body) => save.mutate(body)}
          onCancel={() => setEditing(null)}
        />
      )}
      {current.length === 0 && past.length === 0 && <Card className="text-muted">{t('medicines.page.empty')}</Card>}
      {current.map(card)}
      {!isAdmin && <p className="text-sm text-muted">{t('medicines.page.readOnly')}</p>}
      {past.length > 0 && (
        <>
          <h2 className="pt-2 font-medium">{t('medicines.page.past')}</h2>
          {past.map(card)}
        </>
      )}
    </>
  )
}
