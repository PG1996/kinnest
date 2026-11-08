import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../api/client'
import type { Medicine, Slot } from '../api/hooks'
import { useCancelNudge, useCreateNudge, useGiveDose, useUndoDose, type DoseResult } from '../hooks/log'
import { formatAgo, formatClock } from '../lib/time'
import { formatDose } from '../lib/units'
import { queuedAmount, queuedDoseSlots, queuedAsNeeded, slotKey } from '../offline/pending'
import type { QueueEntry } from '../offline/queue'
import GiveAsNeededSheet from './GiveAsNeededSheet'
import GiveDoseSheet from './GiveDoseSheet'
import NudgeSheet from './NudgeSheet'
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

const round2 = (n: number) => Math.round(n * 100) / 100

/** Medicines on Home: today's slots with full or partial dosing, progress, and a reminder for the rest of a dose. */
export default function MedicinesToday({ medicines, pending, canLog, myName, now, onToast }: Props) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const give = useGiveDose()
  const undo = useUndoDose()
  const createNudge = useCreateNudge()
  const cancelNudge = useCancelNudge()
  const [confirming, setConfirming] = useState<{ medicine: Medicine; amount?: number } | null>(null)
  const [partial, setPartial] = useState<{ medicine: Medicine; slot?: Slot; max: number } | null>(null)
  const [nudgeFor, setNudgeFor] = useState<{ medicine: Medicine; slot: Slot; left: number } | null>(null)
  if (medicines.length === 0) return null
  const queued = queuedDoseSlots(pending)

  const fmt = (m: Medicine, n: number) => formatDose(n, m.dose_unit ?? '', t)
  /** What can still be given for a slot, counting pieces that are waiting to sync. */
  const effectiveRemaining = (m: Medicine, s: Slot) => round2(Math.max(0, (s.remaining ?? 0) - queuedAmount(pending, m.id, s.due_at)))

  const saved = (r: DoseResult) => {
    if (r.queued) onToast({ message: t('home.queued') })
    else if (r.by_name && r.by_name !== myName) onToast({ message: t('medicines.alreadyGave', { name: r.by_name }) })
    else if (r.gap_warning) onToast({ message: t('medicines.gapWarned', { time: formatClock(r.gap_warning.last_given_at) }) })
    else onToast({ message: t('home.logged') })
  }
  const failed = (m: Medicine) => (e: unknown) => {
    if (e instanceof ApiError && e.status === 409) {
      qc.invalidateQueries({ queryKey: ['medicines'] }) // the screen was out of date: show what is true now
      const body = e.body as { detail?: string; remaining?: number | null } | undefined
      if (body?.detail?.includes('skipped')) onToast({ message: t('medicines.slotSkipped') })
      else if (body?.remaining === 0) onToast({ message: t('medicines.alreadyComplete') })
      else if (typeof body?.remaining === 'number') onToast({ message: t('medicines.onlyLeft', { left: fmt(m, body.remaining) }) })
      else onToast({ message: t('medicines.notDue') })
    } else {
      onToast({ message: t('home.saveError') })
    }
  }

  const submit = (m: Medicine, status: 'given' | 'skipped', slot?: Slot, amount?: number) =>
    give.mutate(
      { id: crypto.randomUUID(), medicine_id: m.id, status, scheduled_for: slot?.due_at, amount },
      {
        onSuccess: (r) => {
          saved(r)
          // a piece that leaves something to give: offer a one-off reminder for the rest
          if (slot && amount !== undefined && status === 'given') {
            const left = r.slot ? r.slot.remaining : round2(effectiveRemaining(m, slot) - amount)
            const partlyGiven = r.slot ? r.slot.status === 'partial' : r.queued && (left ?? 0) > 0
            if (partlyGiven && left) setNudgeFor({ medicine: m, slot, left })
          }
        },
        onError: failed(m),
      },
    )

  const giveAsNeeded = (m: Medicine, amount: number | undefined) => {
    const last = m.last_dose
    const insideGap = m.min_gap_hours && last?.status === 'given' && now - Date.parse(last.given_at) < m.min_gap_hours * 3_600_000
    if (insideGap) setConfirming({ medicine: m, amount })
    else submit(m, 'given', undefined, amount)
  }

  const pickNudge = (minutes: number) => {
    if (!nudgeFor) return
    const remindAt = new Date(Date.now() + minutes * 60_000)
    createNudge.mutate(
      { id: crypto.randomUUID(), medicine_id: nudgeFor.medicine.id, scheduled_for: nudgeFor.slot.due_at, remind_at: remindAt.toISOString() },
      {
        onSuccess: () => onToast({ message: t('medicines.reminderSet', { time: formatClock(remindAt.toISOString()) }) }),
        onError: () => onToast({ message: t('home.saveError') }),
      },
    )
    setNudgeFor(null)
  }

  const undoButton = (m: Medicine, doseId: string | null) =>
    canLog && doseId ? (
      <Button variant="ghost" onClick={() => undo.mutate({ medicineId: m.id, doseId })}>
        {t('medicines.undo')}
      </Button>
    ) : null

  /** One line per piece that was given or skipped, oldest first. */
  const pieceLines = (m: Medicine, s: Slot) =>
    (s.doses ?? []).map((d) => (
      <div key={d.id} className="flex items-center justify-between gap-2 text-sm text-muted">
        <span>
          {d.status === 'given'
            ? t('medicines.pieceBy', { name: d.by_name, amount: fmt(m, d.amount ?? m.dose_amount ?? 0), time: formatClock(d.given_at) })
            : t('medicines.skippedBy', { name: d.by_name, time: formatClock(d.given_at) })}
        </span>
        {undoButton(m, d.id)}
      </div>
    ))

  const slotRow = (m: Medicine, s: Slot) => {
    const structured = m.dose_amount != null && !!m.dose_unit
    const due = Date.parse(s.due_at)
    const otherDay = new Date(due).toDateString() !== new Date(now).toDateString()
    const clock = (
      <span className="font-medium">
        {formatClock(s.due_at)}
        {otherDay && <span className="text-muted"> ({t('medicines.yesterday')})</span>}
      </span>
    )

    if (s.status === 'given' || s.status === 'skipped') {
      if (structured && (s.doses ?? []).length > 0) {
        return (
          <div key={s.due_at} className="space-y-1">
            {pieceLines(m, s)}
          </div>
        )
      }
      const key = s.status === 'given' ? 'medicines.givenBy' : 'medicines.skippedBy'
      return (
        <div key={s.due_at} className="flex items-center justify-between gap-2 text-sm text-muted">
          <span>{t(key, { name: s.by_name ?? '', time: formatClock(s.given_at ?? s.due_at) })}</span>
          {undoButton(m, s.dose_id)}
        </div>
      )
    }

    const overdue = due <= now
    const header = (
      <div>
        {clock}
        <p className={overdue ? 'text-sm font-medium text-danger' : 'text-sm text-muted'}>
          {overdue ? t('medicines.overdue', { ago: formatAgo(now - due) }) : t('medicines.dueAt', { time: formatClock(s.due_at) })}
        </p>
      </div>
    )

    if (!structured) {
      return (
        <div key={s.due_at} className="flex flex-wrap items-center justify-between gap-2">
          {header}
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

    const left = effectiveRemaining(m, s)
    const waiting = queuedAmount(pending, m.id, s.due_at)
    return (
      <div key={s.due_at} className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {header}
          {s.status === 'partial' && (
            <p className="text-sm font-medium">
              {t('medicines.progress', { given: fmt(m, s.given_amount), total: fmt(m, m.dose_amount!), left: fmt(m, s.remaining ?? 0) })}
            </p>
          )}
        </div>
        {pieceLines(m, s)}
        {waiting > 0 && <p className="text-sm text-muted">{t('medicines.waitingAmount', { amount: fmt(m, waiting) })}</p>}
        {s.nudge && (
          <div className="flex items-center justify-between gap-2 text-sm text-muted">
            <span>{t('medicines.reminderAt', { time: formatClock(s.nudge.remind_at) })}</span>
            {canLog && (
              <Button variant="ghost" onClick={() => cancelNudge.mutate({ medicineId: m.id, nudgeId: s.nudge!.id })}>
                {t('medicines.cancelReminder')}
              </Button>
            )}
          </div>
        )}
        {canLog && left > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button disabled={give.isPending} onClick={() => submit(m, 'given', s, left)}>
              {t('medicines.giveFull')}
            </Button>
            <Button variant="soft" disabled={give.isPending} onClick={() => setPartial({ medicine: m, slot: s, max: left })}>
              {t('medicines.givePartial')}
            </Button>
            <Button variant="ghost" disabled={give.isPending} onClick={() => submit(m, 'skipped', s)}>
              {t('medicines.skip')}
            </Button>
          </div>
        )}
      </div>
    )
  }

  const asNeededRow = (m: Medicine) => {
    const waiting = queuedAsNeeded(pending, m.id)
    const structured = m.dose_amount != null && !!m.dose_unit
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {m.last_dose?.status === 'given'
            ? t('medicines.lastGiven', { ago: formatAgo(now - Date.parse(m.last_dose.given_at)), name: m.last_dose.by_name })
            : t('medicines.neverGiven')}
          {waiting > 0 && <span> · {t('medicines.waiting')}</span>}
        </p>
        {canLog &&
          (structured ? (
            <div className="flex gap-2">
              <Button variant="soft" disabled={give.isPending} onClick={() => giveAsNeeded(m, m.dose_amount!)}>
                {t('medicines.giveFull')}
              </Button>
              <Button variant="ghost" disabled={give.isPending} onClick={() => setPartial({ medicine: m, max: m.dose_amount! })}>
                {t('medicines.givePartial')}
              </Button>
            </div>
          ) : (
            <Button variant="soft" disabled={give.isPending} onClick={() => giveAsNeeded(m, undefined)}>
              {t('medicines.giveNow')}
            </Button>
          ))}
      </div>
    )
  }

  return (
    <>
      <h2 className="font-medium">{t('medicines.title')}</h2>
      {medicines.map((m) => (
        <Card key={m.id} className="space-y-3">
          <p className="text-lg font-medium">{m.dose_amount != null && m.dose_unit ? `${m.name} · ${fmt(m, m.dose_amount)}` : m.name}</p>
          {m.schedule_kind === 'as_needed' ? asNeededRow(m) : m.slots.map((s) => slotRow(m, s))}
        </Card>
      ))}
      {partial && (
        <GiveDoseSheet
          unit={partial.medicine.dose_unit ?? ''}
          max={partial.max}
          initial={Math.min(partial.max, round2(partial.max / 2))}
          onCancel={() => setPartial(null)}
          onGive={(amount) => {
            const { medicine, slot } = partial
            setPartial(null)
            if (slot) submit(medicine, 'given', slot, amount)
            else giveAsNeeded(medicine, amount)
          }}
        />
      )}
      {confirming && (
        <GiveAsNeededSheet
          medicine={confirming.medicine}
          now={now}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            submit(confirming.medicine, 'given', undefined, confirming.amount)
            setConfirming(null)
          }}
        />
      )}
      {nudgeFor && <NudgeSheet left={fmt(nudgeFor.medicine, nudgeFor.left)} onPick={pickNudge} onSkip={() => setNudgeFor(null)} />}
    </>
  )
}
