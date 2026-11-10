import { toLocalInput } from './time'

/** Something that already happened can't be in the future; something planned can. */
export type PickMode = 'past' | 'planned'
/** Why a picked time was changed: a time later than now today was taken as last night, or a later day as now. */
export type Moved = 'yesterday' | 'now' | null

const DAY_MS = 86_400_000
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
const toMinute = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes())

/**
 * A time of day on `day`. For something that already happened, a time later than now today means last night (logging
 * at 1 AM a feed at 11:30 PM), and a later day is pulled back to now.
 */
export function withTime(day: Date, hour: number, minute: number, mode: PickMode, now: Date): { at: Date; moved: Moved } {
  const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute)
  if (mode === 'planned' || at.getTime() <= now.getTime()) return { at, moved: null }
  if (sameDay(day, now)) return { at: new Date(at.getTime() - DAY_MS), moved: 'yesterday' }
  return { at: toMinute(now), moved: 'now' }
}

/** The "YYYY-MM-DDTHH:mm" the forms keep, and back; empty or broken is no time. */
export const toInput = toLocalInput
export function fromInput(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]))
}
