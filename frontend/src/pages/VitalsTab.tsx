import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { useMe, useVitals, type PlaceKind, type Vital, type VitalFilters } from '../api/hooks'
import Sheet from '../components/Sheet'
import VitalForm from '../components/VitalForm'
import VitalList, { type VitalRow } from '../components/VitalList'
import { Button } from '../components/ui/button'
import { Input, Select } from '../components/ui/field'
import { useCreateVital, useDeleteVital, useUpdateVital } from '../hooks/log'
import { PLACES } from '../lib/vitalsFormat'
import { useQueue } from '../offline/pending'
import type { QueueEntry } from '../offline/queue'

/** A queued (not yet synced) entry shown like a saved one. */
const fromQueue = (e: QueueEntry): VitalRow => ({
  weight_kg: null, height_cm: null, head_cm: null, temperature_c: null, heart_rate: null, resp_rate: null, spo2: null,
  place_name: '', measured_by: '', note: '', entered_by_name: '',
  ...(e.payload as Partial<Vital>),
  id: e.id,
  measured_at: String(e.payload.measured_at),
  place_kind: e.payload.place_kind as PlaceKind,
  waiting: true,
})

const dayStart = (d: string) => (d ? new Date(`${d}T00:00:00`).toISOString() : undefined)
const dayEnd = (d: string) => (d ? new Date(`${d}T23:59:59.999`).toISOString() : undefined)

export default function VitalsTab({ extra }: { extra?: React.ReactNode }) {
  const { t } = useTranslation()
  const canEdit = (useMe().data?.role ?? 'viewer') !== 'viewer'
  const [params, setParams] = useSearchParams()
  const [place, setPlace] = useState<PlaceKind | ''>('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const filters: VitalFilters = { place_kind: place || undefined, from: dayStart(from), to: dayEnd(to) }
  const vitals = useVitals(filters).data ?? []
  const waiting = useQueue().pending.filter((p) => p.kind === 'vital').map(fromQueue)
  const [editing, setEditing] = useState<Vital | 'new' | null>(null)
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
  const onSave = (input: Parameters<typeof create.mutate>[0]) =>
    save.mutate(input, { onSuccess: () => setEditing(null) })

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setEditing('new')}>{t('vitals.add')}</Button>
          {extra}
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label htmlFor="vitals-place" className="block text-xs text-muted">
            {t('vitals.list.place')}
          </label>
          <Select id="vitals-place" value={place} onChange={(e) => setPlace(e.target.value as PlaceKind | '')}>
            <option value="">{t('vitals.list.all')}</option>
            {PLACES.map((p) => (
              <option key={p} value={p}>
                {t(`vitals.places.${p}`)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="vitals-from" className="block text-xs text-muted">
            {t('vitals.list.from')}
          </label>
          <Input id="vitals-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label htmlFor="vitals-to" className="block text-xs text-muted">
            {t('vitals.list.to')}
          </label>
          <Input id="vitals-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      <VitalList
        rows={[...waiting, ...vitals]}
        canEdit={canEdit}
        onEdit={(v) => setEditing(v)}
        onDelete={(id) => remove.mutate(id)}
      />
      {editing && (
        <Sheet title={t(editing === 'new' ? 'vitals.form.title' : 'vitals.form.editTitle')} onClose={() => setEditing(null)}>
          <VitalForm
            initial={editing === 'new' ? undefined : editing}
            saving={save.isPending}
            serverError={save.error?.message}
            onSave={onSave}
          />
        </Sheet>
      )}
    </div>
  )
}
