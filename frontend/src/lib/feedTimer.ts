import type { FeedTimerInfo } from '../api/hooks'

const ms = (iso: string) => Date.parse(iso)

/** Seconds of actual feeding: the time on the clock, without the breaks (a break in progress is not counted either). */
export function feedingSeconds(timer: FeedTimerInfo, now: number): number {
  const end = timer.ended_at ? ms(timer.ended_at) : timer.paused_at ? ms(timer.paused_at) : now
  return Math.max(0, Math.floor((end - ms(timer.started_at)) / 1000) - (timer.paused_total_s ?? 0))
}

/** Minutes between the start and the stop, breaks included: what the clock showed. Only for a stopped timer. */
export function wallMinutes(timer: FeedTimerInfo): number {
  return timer.ended_at ? Math.max(0, Math.round((ms(timer.ended_at) - ms(timer.started_at)) / 60_000)) : 0
}

/** Minutes of breaks recorded with Pause so far. */
export const recordedBreakMinutes = (timer: FeedTimerInfo) => Math.round((timer.paused_total_s ?? 0) / 60)

export const isPaused = (timer: FeedTimerInfo) => !!timer.paused_at && !timer.ended_at
