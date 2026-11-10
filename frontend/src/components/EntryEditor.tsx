import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useMedicines, type Diaper, type DoseRow, type Feed, type Sleep, type Vital } from '../api/hooks'
import { useDeleteFeed, useDeleteSleep, useDeleteVital, useUndoDiaper, useUndoDose, useUpdateVital } from '../hooks/log'
import { formatTime } from '../lib/time'
import { describe, type TimelineItem } from '../lib/timeline'
import { DoseForm } from './DoseHistory'
import DiaperForm from './DiaperForm'
import FeedEditForm from './FeedEditForm'
import Sheet from './Sheet'
import SleepForm from './SleepForm'
import VitalForm from './VitalForm'
import { Button, linkButtonClass } from './ui/button'

/** Who may open this row: not a viewer, not a row still waiting to sync, and doses are the admin's to fix. */
export const canOpen = (item: TimelineItem, role: string) =>
  !item.pending && role !== 'viewer' && (item.kind !== 'dose' || role === 'admin')

/** One timeline entry opened: what it is, and Edit or Delete (with a second confirm). Vaccines and visits are edited in Health. */
export default function EntryEditor({ item, onClose }: { item: TimelineItem; onClose: () => void }) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const medicines = useMedicines(true).data
  const delSleep = useDeleteSleep()
  const delDiaper = useUndoDiaper()
  const delFeed = useDeleteFeed()
  const delVital = useDeleteVital()
  const delDose = useUndoDose()
  const updateVital = useUpdateVital()
  const d = describe(item, t)
  const tone = ({ feed: 'feed', diaper: 'diaper', sleep: 'sleep', dose: 'med' } as const)[item.kind as 'feed'] ?? 'plain'
  const data = item.data as Record<string, unknown>

  if (item.kind === 'vaccine' || item.kind === 'visit') {
    return (
      <Sheet tone={tone} title={d.title} onClose={onClose}>
        <p className="text-sm text-muted">{[d.meta, formatTime(item.at)].filter(Boolean).join(' · ')}</p>
        <Link to={`/health?tab=${item.kind === 'vaccine' ? 'vaccines' : 'visits'}`} className={linkButtonClass('soft')}>
          {t('timeline.openInHealth')}
        </Link>
      </Sheet>
    )
  }

  if (editing) {
    if (item.kind === 'sleep') return <SleepForm sleep={data as unknown as Sleep} onClose={onClose} />
    if (item.kind === 'diaper') return <DiaperForm diaper={data as unknown as Diaper} onClose={onClose} />
    if (item.kind === 'feed') return <FeedEditForm feed={data as unknown as Feed} onClose={onClose} />
    if (item.kind === 'vital')
      return (
        <Sheet variant="full" title={t('vitals.form.editTitle')} onClose={onClose}>
          <VitalForm
            initial={data as unknown as Vital}
            saving={updateVital.isPending}
            serverError={updateVital.error?.message}
            onSave={(input) => updateVital.mutate(input, { onSuccess: onClose })}
          />
        </Sheet>
      )
    const medicine = medicines?.find((m) => m.id === data.medicine_id)
    return medicine ? <DoseForm medicine={medicine} dose={data as unknown as DoseRow} onClose={onClose} /> : null
  }

  const remove = () => {
    const done = { onSuccess: onClose }
    if (item.kind === 'sleep') delSleep.mutate(item.id, done)
    else if (item.kind === 'diaper') delDiaper.mutate(item.id, done)
    else if (item.kind === 'feed') delFeed.mutate(item.id, done)
    else if (item.kind === 'vital') delVital.mutate(item.id, done)
    else delDose.mutate({ medicineId: String(data.medicine_id), doseId: item.id }, done)
  }

  return (
    <Sheet tone={tone} title={d.title} onClose={onClose}>
      <p className="text-sm text-muted">{[d.meta, formatTime(item.at)].filter(Boolean).join(' · ')}</p>
      <div className="flex flex-wrap gap-2">
        {confirming ? (
          <>
            <Button variant="danger" onClick={remove}>
              {t('timeline.confirmDelete')}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {t('timeline.keep')}
            </Button>
          </>
        ) : (
          <>
            <Button variant="soft" onClick={() => setEditing(true)}>
              {t('timeline.edit')}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(true)}>
              {t('timeline.delete')}
            </Button>
          </>
        )}
      </div>
    </Sheet>
  )
}
