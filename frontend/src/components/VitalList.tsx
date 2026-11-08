import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Vital } from '../api/hooks'
import { formatPlace, formatValues, formatWhen } from '../lib/vitalsFormat'
import { Button } from './ui/button'
import { Card } from './ui/card'

export type VitalRow = Vital & { waiting?: boolean }

/** Vitals entries, newest first, each with when, where and the values; Edit and a two-step Delete for caregivers. */
export default function VitalList({
  rows,
  canEdit,
  onEdit,
  onDelete,
}: {
  rows: VitalRow[]
  canEdit: boolean
  onEdit: (v: Vital) => void
  onDelete: (id: string) => void
}) {
  const { t } = useTranslation()
  const [confirming, setConfirming] = useState<string | null>(null)
  if (rows.length === 0) return <p className="text-sm text-muted">{t('vitals.list.empty')}</p>
  return (
    <ul className="space-y-3">
      {rows.map((v) => (
        <li key={v.id}>
          <Card className="space-y-1 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-muted">
              <span>{formatWhen(v.measured_at)}</span>
              <span>{formatPlace(t, v.place_kind, v.place_name)}</span>
            </div>
            <p className="font-medium">{formatValues(t, v)}</p>
            <p className="text-xs text-muted">
              {v.waiting
                ? t('vitals.list.waiting')
                : [
                    v.entered_by_name && t('vitals.list.enteredBy', { name: v.entered_by_name }),
                    v.measured_by && t('vitals.list.measuredBy', { name: v.measured_by }),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
            </p>
            {v.note && <p className="text-sm">{v.note}</p>}
            {canEdit && !v.waiting && (
              <div className="flex gap-2 pt-1">
                {confirming === v.id ? (
                  <>
                    <Button variant="danger" onClick={() => onDelete(v.id)}>
                      {t('vitals.list.confirmDelete')}
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirming(null)}>
                      {t('vitals.list.cancel')}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="soft" onClick={() => onEdit(v)}>
                      {t('vitals.list.edit')}
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirming(v.id)}>
                      {t('vitals.list.delete')}
                    </Button>
                  </>
                )}
              </div>
            )}
          </Card>
        </li>
      ))}
    </ul>
  )
}
