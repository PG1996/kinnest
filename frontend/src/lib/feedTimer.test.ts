import type { FeedTimerInfo } from '../api/hooks'
import { feedingSeconds, isPaused, recordedBreakMinutes, wallMinutes } from './feedTimer'

const NOW = Date.parse('2026-11-10T21:00:00Z')
const at = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString()
const timer = (over: Partial<FeedTimerInfo> = {}): FeedTimerInfo => ({ id: 't', type: 'breast_left', started_at: at(20), ended_at: null, started_by_name: 'Mom', ...over })

test('a running timer counts the time since the start, less the finished breaks', () => {
  expect(feedingSeconds(timer(), NOW)).toBe(20 * 60)
  expect(feedingSeconds(timer({ paused_total_s: 300 }), NOW)).toBe(15 * 60)
})

test('a paused timer is frozen at the moment the break began', () => {
  const t = timer({ paused_at: at(6), paused_total_s: 120 })
  expect(feedingSeconds(t, NOW)).toBe(12 * 60) // 14 minutes up to the pause, less 2 of earlier breaks
  expect(feedingSeconds(t, NOW + 600_000)).toBe(12 * 60)
  expect(isPaused(t)).toBe(true)
})

test('a stopped timer counts up to the stop, and a stop is never paused', () => {
  const t = timer({ ended_at: at(5), paused_total_s: 60 })
  expect(feedingSeconds(t, NOW)).toBe(14 * 60)
  expect(wallMinutes(t)).toBe(15)
  expect(isPaused(timer({ ended_at: at(5), paused_at: at(8) }))).toBe(false)
})

test('the clock never goes below zero, and recorded breaks are whole minutes', () => {
  expect(feedingSeconds(timer({ started_at: at(1), paused_total_s: 600 }), NOW)).toBe(0)
  expect(recordedBreakMinutes(timer({ paused_total_s: 330 }))).toBe(6)
  expect(recordedBreakMinutes(timer())).toBe(0)
  expect(wallMinutes(timer())).toBe(0)
})
