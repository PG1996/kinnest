import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../api/client'
import type { Medicine, Slot } from '../api/hooks'
import { useGiveDose, useUndoDose, type DoseResult } from '../hooks/log'
import { formatAgo, formatClock } from '../lib/time'
import { queuedAsNeeded, queuedDoseSlots, slotKey } from '../offline/pending'
import type { QueueEntry } from '../offline/queue'
import GiveAsNeededSheet from './GiveAsNeededSheet'
import type { ToastData } from './Toast'
import { Button } from './ui/button'
import { Card } from './ui/card'

type Props = {
  medicines: Medicine[]
  pending: QueueEntry[]
  canLog: boolean
  myName: string
  now: number
  onToast: (t: ToastData) => void
}

export default function MedicinesToday({ medicines, pending, canLog, myName, now, onToast }: Props) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const give = useGiveDose()
  const undo = useUndoDose()
  const [confirming, setConfirming] = useState<Medicine | null>(null)
  if (medicines.length === 0) return null
  const queued = queuedDoseSlots(pending)

  const saved = (r: DoseResult) => {
    if (r.queued) onToast({ message: t('home.queued') })
    else if (r.by_name && r.by_name !== myName) onToast({ message: t('medicines.alreadyGave', { name: r.by_name }) })
    else if (r.gap_warning) onToast({ message: t('medicines.gapWarned', { time: formatClock(r.gap_warning.last_given_at) }) })
    else onToast({ message: t('home.logged') })
  }
  const failed = (e: unknown) => {
    if (e instanceof ApiError && e.status === 409) {
      qc.invalidateQueries({ queryKey: ['medicines'] }) // the screen was out of date: show what is true now
      onToast({ message: t('medicines.notDue') })
    } else {
      onToast({ message: t('home.saveError') })
    }
  }
  const submit = (m: Medicine, status: 'given' | 'skipped', slot?: Slot) =>
    give.mutate(
      { id: crypto.randomUUID(), medicine_id: m.id, status, scheduled_for: slot?.due_at },
      { onSuccess: saved, onError: failed },
    )

  const giveNow = (m: Medicine) => {
    const last = m.last_dose
    const insideGap =
      m.min_gap_hours && last?.status === 'given' && now - Date.parse(last.given_at) < m.min_gap_hours * 3_600_000
    if (insideGap) setConfirming(m)
    else submit(m, 'given')
  }

  const slotRow = (m: Medicine, s: Slot) => {
    const due = Date.parse(s.due_at)
    const otherDay = new Date(due).toDateString() !== new Date(now).toDateString()
    const clock = (
      <span className="font-medium">
        {formatClock(s.due_at)}
        {otherDay && <span className="text-muted"> ({t('medicines.yesterday')})</span>}
      </span>
    )
    if (s.status !== 'pending') {
      const key = s.status === 'given' ? 'medicines.givenBy' : 'medicines.skippedBy'
      return (
        <div key={s.due_at} className="flex items-center justify-between gap-2 text-sm text-muted">
          <span>{t(key, { name: s.by_name ?? '', time: formatClock(s.given_at ?? s.due_at) })}</span>
          {canLog && s.dose_id && (
            <Button variant="ghost" onClick={() => undo.mutate({ medicineId: m.id, doseId: s.dose_id! })}>
              {t('medicines.undo')}
            </Button>
          )}
        </div>
      )
    }
    const overdue = due <= now
    return (
      <div key={s.due_at} className="flex flex-wrap items-center justify-between gap-2">
        <div>
          {clock}
          <p className={overdue ? 'text-sm font-medium text-danger' : 'text-sm text-muted'}>
            {overdue ? t('medicines.overdue', { ago: formatAgo(now - due) }) : t('medicines.dueAt', { time: formatClock(s.due_at) })}
          </p>
        </div>
        {queued.has(slotKey(m.id, s.due_at)) ? (
          <span className="text-sm text-muted">{t('medicines.waiting')}</span>
        ) : (
          canLog && (
            <div className="flex gap-2">
              <Button disabled={give.isPending} onClick={() => submit(m, 'given', s)}>
                {t('medicines.given')}
              </Button>
              <Button variant="ghost" disabled={give.isPending} onClick={() => submit(m, 'skipped', s)}>
                {t('medicines.skip')}
              </Button>
            </div>
          )
        )}
      </div>
    )
  }

  const asNeededRow = (m: Medicine) => {
    const waiting = queuedAsNeeded(pending, m.id)
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {m.last_dose?.status === 'given'
            ? t('medicines.lastGiven', { ago: formatAgo(now - Date.parse(m.last_dose.given_at)), name: m.last_dose.by_name })
            : t('medicines.neverGiven')}
          {waiting > 0 && <span> · {t('medicines.waiting')}</span>}
        </p>
        {canLog && (
          <Button variant="soft" disabled={give.isPending} onClick={() => giveNow(m)}>
            {t('medicines.giveNow')}
          </Button>
        )}
      </div>
    )
  }

  return (
    <>
      <h2 className="font-medium">{t('medicines.title')}</h2>
      {medicines.map((m) => (
        <Card key={m.id} className="space-y-3">
          <p className="text-lg font-medium">
            {m.name} · {m.dose}
          </p>
          {m.schedule_kind === 'as_needed' ? asNeededRow(m) : m.slots.map((s) => slotRow(m, s))}
        </Card>
      ))}
      {confirming && (
        <GiveAsNeededSheet
          medicine={confirming}
          now={now}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            submit(confirming, 'given')
            setConfirming(null)
          }}
        />
      )}
    </>
  )
}
