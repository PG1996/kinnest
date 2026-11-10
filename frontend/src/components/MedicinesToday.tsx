import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Pill } from 'lucide-react'
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
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Medicines on Home: today's slots with full or partial dosing, progress, and a reminder for the rest of a dose. */
export default function MedicinesToday({ medicines, pending, canLog, myName, now, onToast, focusId }: Props) {
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
  const [nudgeFor, setNudgeFor] = useState<{ medicine: Medicine; slot: Slot; left: number } | null>(null)
  if (medicines.length === 0) return null
  const queued = queuedDoseSlots(pending)

  /** Doses given on today's calendar date; a list fetched before midnight counts as zero once the day has ended. */
  const givenToday = (m: Medicine) => (m.day_ends_at && now >= Date.parse(m.day_ends_at) ? 0 : (m.given_today ?? 0))
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
    give.mutate(
      { id: crypto.randomUUID(), medicine_id: m.id, status, scheduled_for: slot?.due_at, amount, ...(givenAt ? { given_at: givenAt } : {}) },
      {
        onSuccess: (r) => {
          saved(r)
          // a piece that leaves something to give: offer a one-off reminder for the rest
          if (slot && amount !== undefined && status === 'given') {
            const left = r.slot ? r.slot.remaining : round2(effectiveRemaining(m, slot) - amount)
            const partlyGiven = r.slot ? r.slot.status === 'partial' : r.queued && (left ?? 0) > 0
            if (partlyGiven && left) {
              // a reminder already chosen on the dose screen is created now; otherwise offer one
              if (nudgeMinutes) makeNudge(m, slot, nudgeMinutes)
              else setNudgeFor({ medicine: m, slot, left })
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

  const makeNudge = (m: Medicine, slot: Slot, minutes: number) => {
    const remindAt = new Date(Date.now() + minutes * 60_000)
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
    makeNudge(nudgeFor.medicine, nudgeFor.slot, minutes)
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
            <Button variant="ghost" disabled={give.isPending} onClick={() => setPartial({ medicine: m, slot: s, max: left, mode: 'full', askTime: true })}>
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

  /** One dose at a time: the one due now has the buttons; earlier missed, later and done doses stay out of the way. */
  const scheduledView = (m: Medicine) => {
    const { done, later, current, missed } = groups(m)
    return (
      <div className="space-y-3">
        {current && slotRow(m, current)}
        {!current && later[0] && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold text-med-ink">{t('medicines.nextDose', { time: formatClock(later[0].due_at) })}</p>
            {canLog && (
              <Button variant="soft" disabled={give.isPending} onClick={() => submit(m, 'given', later[0], structuredDose(m) ? effectiveRemaining(m, later[0]) : undefined)}>
                {t('medicines.giveAhead')}
              </Button>
            )}
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
                <Button variant="outline" disabled={give.isPending} onClick={() => void skipAll(m, missed)}>
                  {t('medicines.skipAllMissed')}
                </Button>
                <Button variant="ghost" aria-expanded={!!open[`${m.id}:missed`]} onClick={() => flip(`${m.id}:missed`)}>
                  {t('medicines.reviewMissed')}
                </Button>
              </div>
            )}
            {open[`${m.id}:missed`] && <div className="space-y-3 border-l-2 border-warn-ink/30 pl-3 text-ink">{missed.map((s) => slotRow(m, s))}</div>}
          </div>
        )}
        {/* nothing left to do: show the last thing recorded (with Undo); otherwise all done doses wait under "Done" */}
        {!current && done.length > 0 && slotRow(m, done.at(-1)!)}
        {(() => {
          const rest = current ? done : done.slice(0, -1)
          return rest.length > 0 ? disclosure(`${m.id}:done`, t('medicines.doneCount', { count: rest.length }), rest.map((s) => slotRow(m, s))) : null
        })()}
      </div>
    )
  }

  const asNeededRow = (m: Medicine) => {
    const waiting = queuedAsNeeded(pending, m.id)
    const structured = m.dose_amount != null && !!m.dose_unit
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        {waiting > 0 && <p className="text-sm text-muted">{t('medicines.waiting')}</p>}
        {canLog &&
          (structured ? (
            <div className="flex gap-2">
              <Button variant="soft" disabled={give.isPending} onClick={() => giveAsNeeded(m, m.dose_amount!)}>
                {t('medicines.giveFull')}
              </Button>
              <Button variant="ghost" disabled={give.isPending} onClick={() => setPartial({ medicine: m, max: m.dose_amount! })}>
                {t('medicines.givePartial')}
              </Button>
              <Button variant="ghost" disabled={give.isPending} onClick={() => setPartial({ medicine: m, max: m.dose_amount!, mode: 'full', askTime: true })}>
                {t('medicines.atOtherTime')}
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

  /** "4:00 PM", with "(tomorrow)" when it is not today. */
  const clockWithDay = (iso: string) => {
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const day = new Date(iso).toDateString()
    return day === tomorrow.toDateString() ? `${formatClock(iso)} (${t('medicines.tomorrow')})` : formatClock(iso)
  }
  /** The last dose and the next one, in two short lines for the open card. */
  const doseTimes = (m: Medicine) => {
    const last = m.last_dose
    const lastLine = !last
      ? t('medicines.noDoseYet')
      : last.status === 'given'
        ? t('medicines.lastDoseLine', { time: formatClock(last.given_at), ago: formatAgo(now - Date.parse(last.given_at)), name: last.by_name })
        : t('medicines.lastDoseSkipped', { time: formatClock(last.given_at) })
    let nextLine: string
    if (m.schedule_kind === 'as_needed') {
      const wait = sosWaitAt(m)
      nextLine = wait ? t('medicines.nextDoseFrom', { time: formatClock(wait) }) : t('medicines.nextDoseAnytime')
    } else {
      const { current, later } = groups(m)
      const next = current ?? later[0]
      nextLine = !next
        ? t('medicines.nextDoseNone')
        : Date.parse(next.due_at) <= now
          ? t('medicines.nextDoseNow')
          : t('medicines.nextDoseLine', { time: clockWithDay(next.due_at) })
    }
    return { lastLine, nextLine }
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
    if (current) return { text: t('medicines.tileDue'), urgent: true, extra }
    if (later[0]) return { text: t('medicines.tileNext', { time: formatClock(later[0].due_at) }), urgent: false, extra }
    return { text: done.length > 0 ? t('medicines.tileDone') : t('medicines.tileNever'), urgent: false, extra }
  }

  // the medicine opened below the grid: the one picked, else the first that needs a dose, else the first
  const needing = ordered.find((m) => m.schedule_kind !== 'as_needed' && tileStatus(m).urgent)
  const selected = ordered.find((m) => m.id === picked) ?? needing ?? ordered[0]

  return (
    <>
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
              <Button variant="outline" onClick={() => navigate(`/health?tab=medicines&history=${selected.id}`)}>
                {t('medicines.history.open')}
              </Button>
            </div>
            <div className="space-y-0.5 text-sm">
              <p className="text-muted">{doseTimes(selected).lastLine}</p>
              <p className="font-semibold text-med-ink">{doseTimes(selected).nextLine}</p>
            </div>
            {selected.max_per_day != null && (
              <p className="text-xs font-semibold text-muted">
                {t(givenToday(selected) >= selected.max_per_day ? 'medicines.doneToday' : 'medicines.dosesToday', { count: givenToday(selected), max: selected.max_per_day })}
              </p>
            )}
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
        <Sheet title={t('medicines.maxTitle')} onClose={() => setMaxAsk(null)}>
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
      {nudgeFor && <NudgeSheet left={fmt(nudgeFor.medicine, nudgeFor.left)} onPick={pickNudge} onSkip={() => setNudgeFor(null)} />}
    </>
  )
}
