import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { useMe, useMedicines, type Medicine } from '../api/hooks'
import DoseHistory from '../components/DoseHistory'
import MedicineForm from '../components/MedicineForm'
import MedicinesToday from '../components/MedicinesToday'
import Sheet from '../components/Sheet'
import Toast, { type ToastData } from '../components/Toast'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { formatDose } from '../lib/units'
import { toLocalDate } from '../lib/time'
import { useNow } from '../lib/useNow'
import { useQueue } from '../offline/pending'

export default function MedicinesPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const me = useMe().data
  const isAdmin = me?.role === 'admin'
  const canLog = me?.role === 'admin' || me?.role === 'caregiver'
  const all = useMedicines(true).data ?? []
  const current = all.filter((m) => !m.ended)
  const active = current.filter((m) => m.schedule_kind !== 'as_needed')
  const sos = current.filter((m) => m.schedule_kind === 'as_needed')
  // newest first: by when each one stopped (ended early, else the end of its last day)
  const stoppedAt = (m: Medicine) => (m.ended_at ? Date.parse(m.ended_at) : m.end_date ? Date.parse(`${m.end_date}T23:59:59`) : Date.parse(`${m.start_date}T00:00:00`))
  const past = all.filter((m) => m.ended).sort((a, b) => stoppedAt(b) - stoppedAt(a))
  const { pending } = useQueue()
  const now = useNow()
  const [toast, setToast] = useState<ToastData | null>(null)
  const closeToast = useCallback(() => setToast(null), [])
  const [endAsk, setEndAsk] = useState<string | null>(null)
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

  // "End now" and its undo; the open history shows the medicine as it is after the change
  const lifecycle = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'end' | 'resume' }) => api<Medicine>(`/api/medicines/${id}/${action}`, { method: 'POST' }),
    onSuccess: (m) => {
      setEndAsk(null)
      setHistoryFor((h) => (h && h.id === m.id ? m : h))
      refresh()
    },
  })

  // the open medicine as the latest list has it, so a dose just given counts at once (SOS gap, last dose)
  const shown = historyFor ? (all.find((m) => m.id === historyFor.id) ?? historyFor) : null

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

  /** A titled group of tiles: the heading carries a count and a rule across the page, so each group's start is clear. */
  const section = (title: string, list: Medicine[]) =>
    list.length > 0 && (
      <section aria-label={title} className="space-y-3 pt-3">
        <div className="flex items-center gap-3">
          <h3 className="shrink-0 text-xs font-bold tracking-wider text-med-ink uppercase">{title}</h3>
          <span className="rounded-full bg-med-bg px-2 text-xs font-bold text-med-ink tabular-nums">{list.length}</span>
          <span aria-hidden="true" className="h-px flex-1 bg-line" />
        </div>
        {grid(list)}
      </section>
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
          medicine={shown ?? historyFor}
          canEdit={isAdmin}
          onClose={() => {
            setHistoryFor(null)
            setConfirming(null)
            setEndAsk(null)
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
                {historyFor.ended && historyFor.ended_at && (
                  <p className="text-sm font-semibold text-med-ink">{t('medicines.page.endedOn', { date: toLocalDate(new Date(historyFor.ended_at)) })}</p>
                )}
                {isAdmin && historyFor.dose_amount == null && <p className="text-sm text-danger">{t('medicines.page.setDose')}</p>}
              </div>
              {shown && shown.schedule_kind === 'as_needed' && !shown.ended && canLog && (
                // the same give buttons as on Home, with its gap and daily-maximum checks; the popup stays open
                <MedicinesToday giveOnly medicines={[shown]} pending={pending} canLog={canLog} myName={me?.user.name ?? ''} now={now} onToast={setToast} />
              )}
              {isAdmin && (
                <div className="flex flex-wrap gap-2">
                  <Button variant="soft" onClick={() => { setEditing(historyFor); setHistoryFor(null) }}>
                    {t('medicines.page.edit')}
                  </Button>
                  {!historyFor.ended &&
                    (endAsk === historyFor.id ? (
                      <>
                        <Button onClick={() => lifecycle.mutate({ id: historyFor.id, action: 'end' })} disabled={lifecycle.isPending}>
                          {t('medicines.page.confirmEnd')}
                        </Button>
                        <Button variant="ghost" onClick={() => setEndAsk(null)}>
                          {t('medicines.form.cancel')}
                        </Button>
                        <p className="w-full text-sm text-muted">{t('medicines.page.endHint')}</p>
                      </>
                    ) : (
                      <Button variant="soft" onClick={() => setEndAsk(historyFor.id)}>
                        {t('medicines.page.endNow')}
                      </Button>
                    ))}
                  {historyFor.ended && historyFor.ended_at && (
                    <Button variant="soft" onClick={() => lifecycle.mutate({ id: historyFor.id, action: 'resume' })} disabled={lifecycle.isPending}>
                      {t('medicines.page.resume')}
                    </Button>
                  )}
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
      {section(t('medicines.page.active'), active)}
      {section(t('medicines.page.sos'), sos)}
      {!isAdmin && <p className="text-sm text-muted">{t('medicines.page.readOnly')}</p>}
      {section(t('medicines.page.past'), past)}
      {toast && <Toast toast={toast} onClose={closeToast} />}
    </>
  )
}
