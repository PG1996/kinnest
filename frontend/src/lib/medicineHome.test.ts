import { describe, expect, test } from 'vitest'
import type { Medicine } from '../api/hooks'
import { onHome } from './medicineHome'

const NOW = Date.parse('2026-11-11T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString()
const med = (over: Partial<Medicine>) => ({ schedule_kind: 'as_needed', last_dose: null, created_at: hoursAgo(24 * 30), ...over }) as Medicine
const given = (h: number) => ({ id: 'd', status: 'given' as const, amount: 1, given_at: hoursAgo(h), by_name: 'Mom' })

describe('which medicines Home shows', () => {
  test('a scheduled medicine always', () => {
    expect(onHome(med({ schedule_kind: 'fixed', created_at: hoursAgo(500) }), NOW)).toBe(true)
    expect(onHome(med({ schedule_kind: 'interval' }), NOW)).toBe(true)
  })
  test('an SOS medicine given in the last 48 hours', () => {
    expect(onHome(med({ last_dose: given(47) }), NOW)).toBe(true)
  })
  test('not an SOS medicine last given more than 48 hours ago', () => {
    expect(onHome(med({ last_dose: given(48) }), NOW)).toBe(false)
    expect(onHome(med({ last_dose: given(200) }), NOW)).toBe(false)
  })
  test('a new SOS medicine for 48 hours after it was added, then not until it is given', () => {
    expect(onHome(med({ created_at: hoursAgo(10) }), NOW)).toBe(true)
    expect(onHome(med({ created_at: hoursAgo(49) }), NOW)).toBe(false)
  })
  test('a dose given counts, not when the medicine was added', () => {
    expect(onHome(med({ created_at: hoursAgo(1), last_dose: given(60) }), NOW)).toBe(false)
  })
  test('from an older server that does not say when it was added, it stays', () => {
    expect(onHome(med({ created_at: undefined }), NOW)).toBe(true)
  })
})
