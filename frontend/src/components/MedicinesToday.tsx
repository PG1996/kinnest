import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Pill, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '../api/client'
import type { Medicine, Slot } from '../api/hooks'
import { useCancelNudge, useCreateNudge, useGiveDose, useUndoDose, type DoseResult } from '../hooks/log'
import { cn } from '../lib/cn'
import { formatAgo, formatClock } from '../lib/time'
import { formatDose } from '../lib/units'
import { queuedAmount, queuedDoseSlots, queuedAsNeeded, slotKey } from '../offline/pending'
import type { QueueEntry } from '../offline/queue'
import GiveAsNeededSheet from './GiveAsNeededSheet'
import Sheet from './Sheet'
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
  /** a medicine to open (from a tapped reminder) */
  focusId?: string | null
  /** only the give buttons of the one SOS medicine passed, for the Medicines page's popup: no heading, tiles or card */
  giveOnly?: boolean
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Medicines on Home: today's slots with full or partial dosing, progress, and a reminder for the rest of a dose. */
export default function MedicinesToday({ medicines, pending, canLog, myName, now, onToast, focusId, giveOnly = false }: Props) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const give = useGiveDose()
  const undo = useUndoDose()
  const createNudge = useCreateNudge()
  const cancelNudge = useCancelNudge()
  const [confirming, setConfirming] = useState<{ medicine: Medicine; amount?: number; givenAt?: string | null } | null>(null)
  const [partial, setPartial] = useState<{ medicine: Medicine; slot?: Slot; max: number; mode?: 'full' | 'partial'; askTime?: boolean } | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [picked, setPicked] = useState<string | null>(focusId ?? null)
  const [focused, setFocused] = useState(focusId)
  // a reminder tapped while the app is open points at another medicine
  if (focusId !== focused) {
    setFocused(focusId)
    if (focusId) setPicked(focusId)
  }
  const [maxAsk, setMaxAsk] = useState<{ medicine: Medicine; run: () => void } | null>(null)
  const [nudgeFor, setNudgeFor] = useState<{ medicine: Medicine; slot: Slot; left: number; from: number } | null>(null)
  if (medicines.length === 0) return null
  const queued = queuedDoseSlots(pending)

  /** Doses given on today's calendar date; a list fetched before midnight counts as zero once the day has ended. */
  const givenToday = (m: Medicine) => (m.day_ends_at && now >= Date.parse(m.day_ends_at) ? 0 : (m.given_today ?? 0))
  const fmt = (m: Medicine, n: number) => formatDose(n, m.dose_unit ?? '', t)
  /** The rest of a partly given dose is due: its reminder has gone off (or its time has come and it is about to). */
  const restDue = (s: Slot) => s.status === 'partial' && (!!s.reminder_due || (!!s.nudge && Date.parse(s.nudge.remind_at) <= now))
  /** What can still be given for a slot, counting pieces that are waiting to sync. */
  const effectiveRemaining = (m: Medicine, s: Slot) => round2(Math.max(0, (s.remaining ?? 0) - queuedAmount(pending, m.id, s.due_at)))

  /** The toast after a dose is logged: Undo takes that very dose back (not while it only waits to sync). */
  const saved = (r: DoseResult, m: Medicine, doseId: string) => {
    const undoAction = r.queued ? undefined : { label: t('medicines.undo'), run: () => undo.mutate({ medicineId: m.id, doseId }) }
    if (r.queued) onToast({ message: t('home.queued') })
    else if (r.by_name && r.by_name !== myName) onToast({ message: t('medicines.alreadyGave', { name: r.by_name }), action: undoAction })
    else if (r.gap_warning) onToast({ message: t('medicines.gapWarned', { time: formatClock(r.gap_warning.last_given_at) }), action: undoAction })
    else onToast({ message: t('home.logged'), action: undoAction })
  }
  const failed = (m: Medicine) => (e: unknown) => {
    if (e instanceof ApiError && e.status === 409) {
      qc.invalidateQueries({ queryKey: ['medicines'] }) // the screen was out of date: show what is true now
      const body = e.body as { detail?: string; remaining?: number | null } | undefined
      if (body?.detail?.includes('skipped')) onToast({ message: t('medicines.slotSkipped'), tone: 'error' })
      else if (body?.remaining === 0) onToast({ message: t('medicines.alreadyComplete'), tone: 'error' })
      else if (typeof body?.remaining === 'number') onToast({ message: t('medicines.onlyLeft', { left: fmt(m, body.remaining), tone: 'error' }) })
      else onToast({ message: t('medicines.notDue'), tone: 'error' })
    } else {
      onToast({ message: t('home.saveError'), tone: 'error' })
    }
  }

  /** True when one more dose would pass the medicine's maximum for today (another piece of a started dose does not). */
  const overMax = (m: Medicine, slot?: Slot) => m.max_per_day != null && givenToday(m) >= m.max_per_day && !(slot && slot.given_amount > 0)

  const submit = (m: Medicine, status: 'given' | 'skipped', slot?: Slot, amount?: number, nudgeMinutes: number | null = null, givenAt: string | null = null, skipMax = false) => {
    if (status === 'given' && !skipMax && overMax(m, slot)) {
      setMaxAsk({ medicine: m, run: () => submit(m, status, slot, amount, nudgeMinutes, givenAt, true) })
      return
    }
    const doseId = crypto.randomUUID()
    give.mutate(
      { id: doseId, medicine_id: m.id, status, scheduled_for: slot?.due_at, amount, ...(givenAt ? { given_at: givenAt } : {}) },
      {
        onSuccess: (r) => {
          saved(r, m, doseId)
          // a piece that leaves something to give: offer a one-off reminder for the rest
          if (slot && amount !== undefined && status === 'given') {
            const left = r.slot ? r.slot.remaining : round2(effectiveRemaining(m, slot) - amount)
            const partlyGiven = r.slot ? r.slot.status === 'partial' : r.queued && (left ?? 0) > 0
            if (partlyGiven && left) {
              // a reminder already chosen on the dose screen is created now; otherwise offer one
              const from = givenAt ? Date.parse(givenAt) : Date.now() // counted from the dose just given
              if (nudgeMinutes) makeNudge(m, slot, nudgeMinutes, from)
              else setNudgeFor({ medicine: m, slot, left, from })
            }
          }
        },
        onError: failed(m),
      },
    )
  }

  const giveAsNeeded = (m: Medicine, amount: number | undefined, givenAt: string | null = null) => {
    const last = m.last_dose
    const at = givenAt ? Date.parse(givenAt) : now
    const insideGap = m.min_gap_hours && last?.status === 'given' && Math.abs(at - Date.parse(last.given_at)) < m.min_gap_hours * 3_600_000
    if (insideGap) setConfirming({ medicine: m, amount, givenAt })
    else submit(m, 'given', undefined, amount, null, givenAt)
  }

  /** When the last piece of a dose was given (the reminder for the rest counts from it), or now if nothing is known. */
  const lastPieceAt = (slot: Slot) => {
    const times = (slot.doses ?? []).filter((d) => d.status === 'given').map((d) => Date.parse(d.given_at))
    return times.length > 0 ? Math.max(...times) : Date.now()
  }
  const makeNudge = (m: Medicine, slot: Slot, minutes: number, from: number) => {
    const remindAt = new Date(from + minutes * 60_000)
    createNudge.mutate(
      { id: crypto.randomUUID(), medicine_id: m.id, scheduled_for: slot.due_at, remind_at: remindAt.toISOString() },
      {
        onSuccess: () => onToast({ message: t('medicines.reminderSet', { time: formatClock(remindAt.toISOString()) }) }),
        onError: () => onToast({ message: t('home.saveError'), tone: 'error' }),
      },
    )
  }
  const pickNudge = (minutes: number) => {
    if (!nudgeFor) return
    makeNudge(nudgeFor.medicine, nudgeFor.slot, minutes, nudgeFor.from)
    setNudgeFor(null)
  }

  const undoButton = (m: Medicine, doseId: string | null) =>
    canLog && doseId ? (
      <Button size="sm" variant="chip" onClick={() => undo.mutate({ medicineId: m.id, doseId })}>
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
                <Button size="sm" disabled={give.isPending} onClick={() => submit(m, 'given', s)}>
                  {t('medicines.given')}
                </Button>
                <Button size="sm" variant="chip" disabled={give.isPending} onClick={() => submit(m, 'skipped', s)}>
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
              <Button size="sm" variant="chip" onClick={() => cancelNudge.mutate({ medicineId: m.id, nudgeId: s.nudge!.id })}>
                {t('medicines.cancelReminder')}
              </Button>
            )}
          </div>
        )}
        {canLog && left > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={give.isPending} onClick={() => submit(m, 'given', s, left)}>
              {t('medicines.giveFull')}
            </Button>
            <Button size="sm" variant="chip" disabled={give.isPending} onClick={() => setPartial({ medicine: m, slot: s, max: left })}>
              {t('medicines.givePartial')}
            </Button>
            <Button size="sm" variant="chip" disabled={give.isPending} onClick={() => submit(m, 'skipped', s)}>
              {t('medicines.skip')}
            </Button>
            <Button size="sm" variant="chip" disabled={give.isPending} onClick={() => setPartial({ medicine: m, slot: s, max: left, mode: 'full', askTime: true })}>
              {t('medicines.atOtherTime')}
            </Button>
          </div>
        )}
      </div>
    )
  }

  const flip = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }))
  const SOON_MS = 30 * 60_000

  /** Skips every listed slot, one after another; each can still be put back with Undo. */
  const skipAll = async (m: Medicine, slots: Slot[]) => {
    for (const s of slots) {
      try {
        await give.mutateAsync({ id: crypto.randomUUID(), medicine_id: m.id, status: 'skipped', scheduled_for: s.due_at })
      } catch (e) {
        failed(m)(e)
        return
      }
    }
    onToast({ message: t('home.logged') })
  }

  const disclosure = (key: string, label: string, children: React.ReactNode) => (
    <div className="space-y-2">
      <button
        type="button"
        aria-expanded={!!open[key]}
        onClick={() => flip(key)}
        className="flex min-h-11 w-full items-center justify-between rounded-tile bg-surface/70 px-3 text-sm font-bold text-med-ink"
      >
        {label}
        <ChevronDown size={18} aria-hidden="true" className={open[key] ? 'rotate-180 transition' : 'transition'} />
      </button>
      {open[key] && <div className="space-y-3 border-l-2 border-med/30 pl-3">{children}</div>}
    </div>
  )

  const groups = (m: Medicine) => {
    const actionable = m.slots.filter((s) => s.status === 'pending' || s.status === 'partial')
    const done = m.slots.filter((s) => s.status === 'given' || s.status === 'skipped')
    const soon = actionable.filter((s) => Date.parse(s.due_at) <= now + SOON_MS)
    const later = actionable.filter((s) => Date.parse(s.due_at) > now + SOON_MS)
    return { done, soon, later, current: soon.at(-1), missed: soon.slice(0, -1) }
  }

  const structuredDose = (m: Medicine) => m.dose_amount != null && !!m.dose_unit

  const moreButton = (key: string) => (
    <Button size="sm" variant="chip" aria-expanded={!!open[key]} onClick={() => flip(key)}>
      {t('medicines.more')}
      <ChevronDown size={14} aria-hidden="true" className={open[key] ? 'rotate-180 transition' : 'transition'} />
    </Button>
  )

  /**
   * The dose to give: what it is and how far it is, one main button (yellow when a dose is due, else purple), and the
   * rest under More. `ahead` is a dose that is not due yet: only the buttons, since "Next" is already a fact above.
   */
  const currentAction = (m: Medicine, s: Slot, ahead = false) => {
    const left = effectiveRemaining(m, s)
    const waiting = queuedAmount(pending, m.id, s.due_at)
    const partly = s.status === 'partial'
    const due = Date.parse(s.due_at)
    const when = formatClock(s.due_at) + (new Date(due).toDateString() !== new Date(now).toDateString() ? ` (${t('medicines.yesterday')})` : '')
    const reminderAhead = !!s.nudge && Date.parse(s.nudge.remind_at) > now
    const overdue = !ahead && !partly && due <= now
    const line = partly
      ? reminderAhead
        ? t('medicines.restAt', { amount: fmt(m, left), time: formatClock(s.nudge!.remind_at) })
        : restDue(s)
          ? t('medicines.restDue', { amount: fmt(m, left) })
          : t('medicines.rest', { amount: fmt(m, left) })
      : overdue
        ? t('medicines.slotOverdue', { time: when, ago: formatAgo(now - due) })
        : t('medicines.slotDueAt', { time: when })
    const total = round2(s.given_amount + (s.remaining ?? 0))
    const more = `${m.id}:more`
    return (
      <div key={s.due_at} className="space-y-3">
        {!ahead && (
          <div className="flex items-center justify-between gap-2">
            <p className={overdue ? 'text-sm font-semibold text-danger' : 'text-sm font-semibold'}>{line}</p>
            {partly && !reminderAhead && canLog && (
              <Button size="sm" variant="chip" onClick={() => setNudgeFor({ medicine: m, slot: s, left, from: lastPieceAt(s) })}>
                {t('medicines.remindMe')}
              </Button>
            )}
          </div>
        )}
        {partly && total > 0 && (
          <div className="space-y-1">
            <div role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={s.given_amount} className="h-2 overflow-hidden rounded-full bg-surface">
              <div className="h-full rounded-full bg-med" style={{ width: `${Math.min(100, (s.given_amount / total) * 100)}%` }} />
            </div>
            <p className="flex justify-between text-xs text-muted">
              <span>{t('medicines.barLabel', { given: fmt(m, s.given_amount), total: fmt(m, total) })}</span>
              <span>{t('medicines.doseOf', { time: when })}</span>
            </p>
          </div>
        )}
        {waiting > 0 && <p className="text-sm text-muted">{t('medicines.waitingAmount', { amount: fmt(m, waiting) })}</p>}
        {canLog && left > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Button size="sm" variant={tileStatus(m).urgent ? 'warn' : 'primary'} disabled={give.isPending} onClick={() => submit(m, 'given', s, left)}>
                {partly ? t('medicines.giveRest', { amount: fmt(m, left) }) : t('medicines.giveFull')}
              </Button>
              {moreButton(more)}
            </div>
            {open[more] && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="chip" disabled={give.isPending} onClick={() => setPartial({ medicine: m, slot: s, max: left })}>
                  {t('medicines.givePartial')}
                </Button>
                {!ahead && (
                  <Button size="sm" variant="chip" disabled={give.isPending} onClick={() => submit(m, 'skipped', s)}>
                    {t('medicines.skip')}
                  </Button>
                )}
                <Button size="sm" variant="chip" disabled={give.isPending} onClick={() => setPartial({ medicine: m, slot: s, max: left, mode: 'full', askTime: true })}>
                  {t('medicines.atOtherTime')}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  /** One dose at a time: the one due now has the buttons; earlier missed, later and done doses stay out of the way. */
  const scheduledView = (m: Medicine) => {
    const { done, later, current, missed } = groups(m)
    return (
      <div className="space-y-3">
        {current && (structuredDose(m) ? currentAction(m, current) : slotRow(m, current))}
        {!current && later[0] && structuredDose(m) && currentAction(m, later[0], true)}
        {!current && later[0] && !structuredDose(m) && canLog && (
          <div className="flex justify-end">
            <Button size="sm" disabled={give.isPending} onClick={() => submit(m, 'given', later[0], undefined)}>
              {t('medicines.giveAhead')}
            </Button>
          </div>
        )}
        {current && later.length > 0 && (
          <p className="text-sm text-muted">{t('medicines.laterToday', { times: later.map((s) => formatClock(s.due_at)).join(', ') })}</p>
        )}
        {missed.length > 0 && (
          <div className="space-y-2 rounded-tile bg-warn-bg p-3 text-warn-ink">
            <p className="text-sm font-bold">
              {t('medicines.missedList', {
                count: missed.length,
                times: missed
                  .map((s) => formatClock(s.due_at) + (new Date(s.due_at).toDateString() !== new Date(now).toDateString() ? ` (${t('medicines.yesterday')})` : ''))
                  .join(', '),
              })}
            </p>
            {canLog && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="chip" disabled={give.isPending} onClick={() => void skipAll(m, missed)}>
                  {t('medicines.skipAllMissed')}
                </Button>
                <Button size="sm" variant="chip" aria-expanded={!!open[`${m.id}:missed`]} onClick={() => flip(`${m.id}:missed`)}>
                  {t('medicines.reviewMissed')}
                </Button>
              </div>
            )}
            {open[`${m.id}:missed`] && <div className="space-y-3 border-l-2 border-warn-ink/30 pl-3 text-ink">{missed.map((s) => slotRow(m, s))}</div>}
          </div>
        )}
        {done.length > 0 && disclosure(`${m.id}:done`, t('medicines.doneCount', { count: done.length }), done.map((s) => slotRow(m, s)))}
      </div>
    )
  }

  const asNeededRow = (m: Medicine) => {
    const waiting = queuedAsNeeded(pending, m.id)
    const structured = m.dose_amount != null && !!m.dose_unit
    const more = `${m.id}:more`
    return (
      <div className="space-y-2">
        {waiting > 0 && <p className="text-sm text-muted">{t('medicines.waiting')}</p>}
        {canLog && (
          <>
            <div className="flex items-center gap-2">
              <Button size="sm" disabled={give.isPending} onClick={() => giveAsNeeded(m, structured ? m.dose_amount! : undefined)}>
                {t('medicines.giveFull')}
              </Button>
              {structured && moreButton(more)}
            </div>
            {structured && open[more] && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="chip" disabled={give.isPending} onClick={() => setPartial({ medicine: m, max: m.dose_amount! })}>
                  {t('medicines.givePartial')}
                </Button>
                <Button size="sm" variant="chip" disabled={give.isPending} onClick={() => setPartial({ medicine: m, max: m.dose_amount!, mode: 'full', askTime: true })}>
                  {t('medicines.atOtherTime')}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  /** "4:00 PM", with "(tomorrow)" when it is not today. */
  const clockWithDay = (iso: string) => {
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const day = new Date(iso).toDateString()
    return day === tomorrow.toDateString() ? `${formatClock(iso)} (${t('medicines.tomorrow')})` : formatClock(iso)
  }
  /** What comes next, as a small fact: only when nothing is due right now. */
  const nextFact = (m: Medicine): string | null => {
    if (m.schedule_kind === 'as_needed') return sosWaitAt(m) ? null : t('medicines.nextDoseAnytime')
    const { current, later } = groups(m)
    if (current) return null
    return later[0] ? t('medicines.nextDoseLine', { time: clockWithDay(later[0].due_at) }) : t('medicines.nextDoseNone')
  }
  const pill = (key: string, children: React.ReactNode) => (
    <span key={key} className="inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-ink">
      {children}
    </span>
  )
  /** One row of small facts: today's count, the last dose, what is next, a reminder that is set. */
  const facts = (m: Medicine) => {
    const last = m.last_dose
    const next = nextFact(m)
    const upcoming = m.schedule_kind === 'as_needed' ? null : groups(m).current?.nudge
    const nudge = upcoming && Date.parse(upcoming.remind_at) > now ? upcoming : null
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {m.max_per_day != null &&
          pill('count', t(givenToday(m) >= m.max_per_day ? 'medicines.doneToday' : 'medicines.dosesToday', { count: givenToday(m), max: m.max_per_day }))}
        {pill('last', last ? t('medicines.lastDoseLine', { time: formatClock(last.given_at), name: last.by_name.split(' ')[0] }) : t('medicines.noDoseYet'))}
        {next && pill('next', next)}
        {nudge &&
          pill(
            'reminder',
            <>
              <span>{t('medicines.reminderAt', { time: formatClock(nudge.remind_at) })}</span>
              {canLog && (
                <button
                  type="button"
                  aria-label={t('medicines.cancelReminder')}
                  className="-mr-1 grid size-5 place-items-center rounded-full text-muted hover:bg-line"
                  onClick={() => cancelNudge.mutate({ medicineId: m.id, nudgeId: nudge.id })}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              )}
            </>,
          )}
      </div>
    )
  }

  const ordered = [...medicines.filter((m) => m.schedule_kind !== 'as_needed'), ...medicines.filter((m) => m.schedule_kind === 'as_needed')]
  const title = (m: Medicine) => (m.dose_amount != null && m.dose_unit ? `${m.name} · ${fmt(m, m.dose_amount)}` : m.name)
  /** An SOS medicine with a minimum gap: when it is safe to give again, while that is still ahead. */
  const sosWaitAt = (m: Medicine) => {
    const last = m.last_dose
    if (!m.min_gap_hours || last?.status !== 'given') return null
    const safeAt = Date.parse(last.given_at) + m.min_gap_hours * 3_600_000
    return safeAt > now ? new Date(safeAt).toISOString() : null
  }
  const sosWait = (m: Medicine) => (sosWaitAt(m) ? t('medicines.sosWait', { time: formatClock(sosWaitAt(m)!) }) : null)

  /** What a tile says: whether a dose is due, what is next, or that all is done. `urgent` tiles are highlighted. */
  const tileStatus = (m: Medicine): { text: string; urgent: boolean; extra?: string } => {
    if (m.schedule_kind === 'as_needed') {
      const wait = sosWaitAt(m)
      if (wait) return { text: t('medicines.tileWait', { time: formatClock(wait) }), urgent: false }
      return { text: m.last_dose?.status === 'given' ? t('medicines.tileLast', { ago: formatAgo(now - Date.parse(m.last_dose.given_at)) }) : t('medicines.tileNever'), urgent: false }
    }
    const { current, missed, later, done } = groups(m)
    const atMax = m.max_per_day != null && givenToday(m) >= m.max_per_day
    const extra = missed.length > 0 ? t('medicines.tileMissed', { count: missed.length }) : atMax && !current ? t('medicines.tileMax') : undefined
    if (current?.status === 'partial') {
      // part of the dose is given: the tile is about the rest, and is only highlighted once its reminder is due
      const at = current.nudge ? Date.parse(current.nudge.remind_at) : null
      if (at && at > now) return { text: t('medicines.tileRest', { time: formatClock(current.nudge!.remind_at) }), urgent: false, extra }
      if (restDue(current)) return { text: t('medicines.tileDue'), urgent: true, extra }
      return { text: t('medicines.tileRestLeft', { amount: fmt(m, round2(current.remaining ?? 0)) }), urgent: false, extra }
    }
    if (current) return { text: t('medicines.tileDue'), urgent: true, extra }
    if (later[0]) return { text: t('medicines.tileNext', { time: formatClock(later[0].due_at) }), urgent: false, extra }
    return { text: done.length > 0 ? t('medicines.tileDone') : t('medicines.tileNever'), urgent: false, extra }
  }

  // the medicine opened below the grid: the one picked, else the first that needs a dose, else the first
  const needing = ordered.find((m) => m.schedule_kind !== 'as_needed' && tileStatus(m).urgent)
  const selected = ordered.find((m) => m.id === picked) ?? needing ?? ordered[0]

  return (
    <>
      {giveOnly && selected ? (
        <div data-testid="sos-give" className="space-y-2">
          {asNeededRow(selected)}
          {sosWait(selected) && <p className="text-sm font-bold text-warn-ink">{sosWait(selected)}</p>}
        </div>
      ) : (
      <section aria-label={t('medicines.title')} className="space-y-3">
        <h2 className="font-medium">{t('medicines.title')}</h2>
        <div data-testid="medicine-grid" className="grid grid-cols-3 gap-2">
          {ordered.map((m) => {
            const st = tileStatus(m)
            const isSos = m.schedule_kind === 'as_needed'
            return (
              <button
                key={m.id}
                type="button"
                aria-pressed={selected?.id === m.id}
                onClick={() => setPicked(m.id)}
                className={cn(
                  'flex aspect-square flex-col justify-between rounded-tile p-2.5 text-left transition active:scale-[0.97]',
                  st.urgent ? 'bg-warn-bg text-warn-ink' : 'bg-med-bg text-ink',
                  selected?.id === m.id && 'ring-2 ring-primary',
                )}
              >
                <span className="flex items-start justify-between gap-1">
                  <Pill size={16} aria-hidden="true" className={st.urgent ? 'text-warn-ink' : 'text-med'} />
                  {isSos && <span className="rounded-full bg-surface px-1.5 text-[10px] font-bold text-med-ink">{t('medicines.sosBadge')}</span>}
                </span>
                <span className="min-w-0">
                  <span className="line-clamp-2 block text-[13px] leading-tight font-semibold">{m.name}</span>
                  {m.dose_amount != null && m.dose_unit && <span className="block text-[11px] text-muted">{fmt(m, m.dose_amount)}</span>}
                </span>
                <span className="block text-[11px] leading-tight font-semibold">
                  {st.text}
                  {st.extra && <span className="block font-bold text-danger">{st.extra}</span>}
                </span>
              </button>
            )
          })}
        </div>
        {selected && (
          <Card tone="med" data-testid="medicine-detail" className="space-y-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-base font-semibold">{title(selected)}</p>
              <Button size="sm" variant="chip" className="-mr-2 shrink-0" onClick={() => navigate(`/health?tab=medicines&history=${selected.id}`)}>
                {t('medicines.history.open')}
                <ChevronRight size={16} aria-hidden="true" />
              </Button>
            </div>
            {facts(selected)}
            {selected.schedule_kind === 'as_needed' ? (
              <>
                {asNeededRow(selected)}
                {sosWait(selected) && <p className="text-sm font-bold text-warn-ink">{sosWait(selected)}</p>}
              </>
            ) : (
              scheduledView(selected)
            )}
          </Card>
        )}
      </section>
      )}
      {partial && (
        <GiveDoseSheet
          medicine={partial.medicine}
          slot={partial.slot}
          max={partial.max}
          initialMode={partial.mode}
          askTime={partial.askTime}
          onCancel={() => setPartial(null)}
          onSkip={
            partial.slot
              ? () => {
                  const { medicine, slot } = partial
                  setPartial(null)
                  submit(medicine, 'skipped', slot)
                }
              : undefined
          }
          onGive={(amount, nudgeMinutes, givenAt) => {
            const { medicine, slot } = partial
            setPartial(null)
            if (slot) submit(medicine, 'given', slot, amount, nudgeMinutes, givenAt)
            else giveAsNeeded(medicine, amount, givenAt)
          }}
        />
      )}
      {maxAsk && (
        <Sheet tone="med" title={t('medicines.maxTitle')} onClose={() => setMaxAsk(null)}>
          <p>{t('medicines.maxBody', { count: givenToday(maxAsk.medicine), max: maxAsk.medicine.max_per_day ?? 0 })}</p>
          <div className="grid grid-cols-2 gap-3">
            <Button
              onClick={() => {
                const run = maxAsk.run
                setMaxAsk(null)
                run()
              }}
            >
              {t('medicines.giveAnyway')}
            </Button>
            <Button variant="ghost" onClick={() => setMaxAsk(null)}>
              {t('medicines.cancel')}
            </Button>
          </div>
        </Sheet>
      )}
      {confirming && (
        <GiveAsNeededSheet
          medicine={confirming.medicine}
          now={now}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            submit(confirming.medicine, 'given', undefined, confirming.amount, null, confirming.givenAt)
            setConfirming(null)
          }}
        />
      )}
      {nudgeFor && <NudgeSheet left={fmt(nudgeFor.medicine, nudgeFor.left)} from={nudgeFor.from} onPick={pickNudge} onSkip={() => setNudgeFor(null)} />}
    </>
  )
}
