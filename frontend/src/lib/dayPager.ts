import { useMemo } from 'react'

/** The rules for swiping between days, kept apart from the component so they can be tested without a touch screen. */

export type Turn = 'next' | 'prev'

const LOCK_PX = 10
const FLICK_MIN_PX = 30
const FLICK_PX_PER_MS = 0.5
const STRIP_LENGTH = 21
const STRIP_AFTER = 3

/** Which way a drag is going, once it has gone 10px: sideways turns the day, up-and-down is left to the page to scroll. */
export function lockAxis(dx: number, dy: number): 'x' | 'y' | null {
  if (Math.hypot(dx, dy) < LOCK_PX) return null
  return Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
}

/**
 * Whether a finished drag turns the day: past a third of the width, or a quick flick. Dragging left goes to the next day,
 * right to the day before; there is no next day after today (`canNext` false).
 */
export function swipeResult(dx: number, ms: number, width: number, canNext: boolean): Turn | null {
  const far = Math.abs(dx) > width / 3
  const flick = Math.abs(dx) >= FLICK_MIN_PX && Math.abs(dx) / Math.max(ms, 1) >= FLICK_PX_PER_MS
  if (!far && !flick) return null
  if (dx < 0) return canNext ? 'next' : null
  return 'prev'
}

/** How far the day moves under the finger: all the way, except towards the day after today, where it only gives a little. */
export function dragOffset(dx: number, canNext: boolean): number {
  return dx < 0 && !canNext ? dx / 4 : dx
}

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

/** The days in the strip: 21 ending today while `day` is recent, else 21 ending a few days after `day`. */
export function stripDays(day: Date, today: Date): Date[] {
  const after = addDays(day, STRIP_AFTER)
  const end = after.getTime() >= today.getTime() || addDays(today, -(STRIP_LENGTH - STRIP_AFTER)) <= day ? today : after
  return Array.from({ length: STRIP_LENGTH }, (_, i) => addDays(end, i - STRIP_LENGTH + 1))
}

/** The start of `d`'s day, local time. */
export const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

/** The last moment of `d`'s day, local time. */
export const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)

export { addDays }

/** The days in the strip for `day`, and the range that covers them, so a page can fetch what to mark. */
export function useStripRange(day: Date, todayMs: number) {
  const dayMs = day.getTime()
  // keyed by times, not Date objects, so the range (and the query it feeds) stays the same between renders
  return useMemo(() => {
    const days = stripDays(new Date(dayMs), new Date(todayMs))
    return { days, from: days[0]!, to: endOfDay(days.at(-1)!) }
  }, [dayMs, todayMs])
}
