import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { useMe, useMedicines, type Medicine } from '../api/hooks'
import DoseHistory from '../components/DoseHistory'
import MedicineForm from '../components/MedicineForm'
import Sheet from '../components/Sheet'
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
  const [editing, setEditing] = useState<Medicine | 'new' | 'sos' | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [historyFor, setHistoryFor] = useState<Medicine | null>(null)
  const [params, setParams] = useSearchParams()
  useEffect(() => {
    // "Add medicine" after a doctor visit opens this page with the form open
    if (isAdmin && params.get('add') === '1') {
      setEditing('new')
      params.delete('add')
      setParams(params, { replace: true })
    }
  }, [isAdmin, params, setParams])
  useEffect(() => {
    // the dose history of one medicine, opened from its card on Home
    const wanted = params.get('history')
    if (!wanted) return
    const m = all.find((x) => x.id === wanted)
    if (!m) return
    setHistoryFor(m)
    params.delete('history')
    setParams(params, { replace: true })
  }, [all, params, setParams])
  const refresh = () => qc.invalidateQueries({ queryKey: ['medicines'] })

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      editing && typeof editing === 'object'
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

  const dose = (m: Medicine) => (m.dose_amount != null && m.dose_unit ? formatDose(m.dose_amount, m.dose_unit, t) : null)

  const tile = (m: Medicine) => (
    <button
      key={m.id}
      type="button"
      data-testid={`medicine-${m.id}`}
      data-tone="med"
      onClick={() => setHistoryFor(m)}
      className="flex aspect-square flex-col justify-between rounded-2xl border border-transparent bg-med-bg p-3.5 text-left text-ink transition-transform active:scale-[0.98]"
    >
      <span className="space-y-0.5">
        <span className="block text-base font-bold leading-tight">{dose(m) ? `${m.name} · ${dose(m)}` : m.name}</span>
        {isAdmin && m.dose_amount == null && <span className="block text-xs text-danger">{t('medicines.page.setDose')}</span>}
      </span>
      <span className="block text-xs font-medium text-med-ink">{describe(m)}</span>
    </button>
  )

  const grid = (list: Medicine[]) => (
    <div data-testid="medicine-tiles" className="grid grid-cols-2 gap-3">
      {list.map(tile)}
    </div>
  )

  return (
    <>
      <h2 className="text-lg font-bold">{t('medicines.page.title')}</h2>
      {isAdmin && editing === null && (
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => setEditing('new')}>{t('medicines.page.add')}</Button>
          <Button variant="soft" onClick={() => setEditing('sos')}>
            {t('medicines.page.addSos')}
          </Button>
        </div>
      )}
      {editing !== null && (
        <Sheet
          title={typeof editing === 'object' ? t('medicines.page.editTitle', { name: editing.name }) : t(editing === 'sos' ? 'medicines.page.addSos' : 'medicines.page.add')}
          onClose={() => setEditing(null)}
        >
          <MedicineForm
            key={typeof editing === 'string' ? editing : editing.id}
            medicine={typeof editing === 'string' ? undefined : editing}
            initialKind={editing === 'sos' ? 'as_needed' : undefined}
            saving={save.isPending}
            failed={save.isError}
            onSave={(body) => save.mutate(body)}
            onCancel={() => setEditing(null)}
          />
        </Sheet>
      )}
      {historyFor && (
        <DoseHistory
          medicine={historyFor}
          canEdit={isAdmin}
          onClose={() => {
            setHistoryFor(null)
            setConfirming(null)
          }}
          header={
            <>
              <div className="space-y-1">
                {dose(historyFor) && <p className="text-base font-bold">{dose(historyFor)}</p>}
                <p className="text-sm font-medium text-med-ink">{describe(historyFor)}</p>
                <p className="text-sm text-muted">
                  {t('medicines.page.from', { date: historyFor.start_date })}
                  {historyFor.end_date && ` ${t('medicines.page.until', { date: historyFor.end_date })}`}
                </p>
                {isAdmin && historyFor.dose_amount == null && <p className="text-sm text-danger">{t('medicines.page.setDose')}</p>}
              </div>
              {isAdmin && (
                <div className="flex flex-wrap gap-2">
                  <Button variant="soft" onClick={() => { setEditing(historyFor); setHistoryFor(null) }}>
                    {t('medicines.page.edit')}
                  </Button>
                  {confirming === historyFor.id ? (
                    <>
                      <Button variant="danger" onClick={() => remove.mutate(historyFor.id, { onSuccess: () => setHistoryFor(null) })}>
                        {t('medicines.page.confirmDelete')}
                      </Button>
                      <Button variant="ghost" onClick={() => setConfirming(null)}>
                        {t('medicines.form.cancel')}
                      </Button>
                    </>
                  ) : (
                    <Button variant="ghost" onClick={() => setConfirming(historyFor.id)}>
                      {t('medicines.page.delete')}
                    </Button>
                  )}
                </div>
              )}
            </>
          }
        />
      )}
      {current.length === 0 && past.length === 0 && <Card className="text-muted">{t('medicines.page.empty')}</Card>}
      {current.length > 0 && grid(current)}
      {!isAdmin && <p className="text-sm text-muted">{t('medicines.page.readOnly')}</p>}
      {past.length > 0 && (
        <>
          <h2 className="pt-2 font-medium">{t('medicines.page.past')}</h2>
          {grid(past)}
        </>
      )}
    </>
  )
}
