import { lazy, Suspense, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { useScanStatus } from '../api/scan'
import { useMe, useVitals, type PlaceKind, type Vital } from '../api/hooks'
import BulkVitals from '../components/BulkVitals'
import Sheet from '../components/Sheet'
import SnapRecord from '../components/SnapRecord'
import VitalForm from '../components/VitalForm'
import { type VitalRow } from '../components/VitalList'
import VitalsCalendar from '../components/VitalsCalendar'
import { Button } from '../components/ui/button'
import { Segmented } from '../components/ui/segmented'
import { useCreateVital, useDeleteVital, useUpdateVital } from '../hooks/log'
import { useQueue } from '../offline/pending'
import type { QueueEntry } from '../offline/queue'

// the charts library is large: load it only when the charts are opened
const VitalsCharts = lazy(() => import('./VitalsCharts'))

/** A queued (not yet synced) entry shown like a saved one. */
const fromQueue = (e: QueueEntry): VitalRow => ({
  weight_kg: null,
  height_cm: null,
  head_cm: null,
  temperature_c: null,
  heart_rate: null,
  resp_rate: null,
  spo2: null,
  place_name: '',
  measured_by: '',
  note: '',
  entered_by_name: '',
  ...(e.payload as Partial<Vital>),
  id: e.id,
  measured_at: String(e.payload.measured_at),
  place_kind: e.payload.place_kind as PlaceKind,
  waiting: true,
})

export default function VitalsTab() {
  const { t } = useTranslation()
  const canEdit = (useMe().data?.role ?? 'viewer') !== 'viewer'
  const [params, setParams] = useSearchParams()
  // the calendar needs every reading to mark its days (the server's most)
  const vitals = useVitals({ limit: 2000 }).data ?? []
  const waiting = useQueue()
    .pending.filter((p) => p.kind === 'vital')
    .map(fromQueue)
  const [editing, setEditing] = useState<Vital | 'new' | null>(null)
  const [newDay, setNewDay] = useState<string | undefined>()
  const close = () => {
    setEditing(null)
    setNewDay(undefined)
  }
  const [bulkOpen, setBulkOpen] = useState(false)
  const [snapOpen, setSnapOpen] = useState(false)
  const scanOn = useScanStatus().data?.enabled === true
  const [view, setView] = useState<'calendar' | 'charts'>('charts')
  const create = useCreateVital()
  const update = useUpdateVital()
  const remove = useDeleteVital()

  useEffect(() => {
    if (canEdit && params.get('add') === '1') {
      setEditing('new')
      params.delete('add')
      setParams(params, { replace: true })
    }
  }, [canEdit, params, setParams])

  const save = editing === 'new' ? create : update
  const onSave = (input: Parameters<typeof create.mutate>[0]) => save.mutate(input, { onSuccess: () => close() })

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setEditing('new')}>{t('vitals.add')}</Button>
          <Button variant="soft" onClick={() => setBulkOpen(true)}>
            {t('vitals.bulk.open')}
          </Button>
          {scanOn && (
            <Button variant="outline" onClick={() => setSnapOpen(true)}>
              {t('scan.snap')}
            </Button>
          )}
        </div>
      )}
      <Segmented
        label={t('vitals.charts.view')}
        value={view}
        onChange={setView}
        options={[
          { value: 'charts', label: t('vitals.charts.title') },
          { value: 'calendar', label: t('vitals.charts.calendar') },
        ]}
      />
      {view === 'charts' ? (
        <Suspense fallback={<p className="text-sm text-muted">{t('common.loading')}</p>}>
          <VitalsCharts />
        </Suspense>
      ) : (
        <VitalsCalendar
          rows={[...waiting, ...vitals]}
          canEdit={canEdit}
          onEdit={(v) => setEditing(v)}
          onDelete={(id) => remove.mutate(id)}
          onAddDay={(day) => {
            setNewDay(day)
            setEditing('new')
          }}
        />
      )}
      {snapOpen && (
        <SnapRecord
          onClose={() => setSnapOpen(false)}
          onManual={() => {
            setSnapOpen(false)
            setEditing('new')
          }}
        />
      )}
      {bulkOpen && (
        <Sheet variant="full" title={t('vitals.bulk.title')} onClose={() => setBulkOpen(false)}>
          <BulkVitals />
        </Sheet>
      )}
      {editing && (
        <Sheet variant="full" title={t(editing === 'new' ? 'vitals.form.title' : 'vitals.form.editTitle')} onClose={() => close()}>
          <VitalForm
            initial={editing === 'new' ? undefined : editing}
            day={editing === 'new' ? newDay : undefined}
            saving={save.isPending}
            serverError={save.error?.message}
            onSave={onSave}
          />
        </Sheet>
      )}
    </div>
  )
}
