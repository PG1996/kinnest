import type { DoseRow } from '../api/hooks'
import { groupDoses } from './doseGroups'

const row = (id: string, over: Partial<DoseRow> = {}): DoseRow => ({
  id, medicine_id: 'm1', status: 'given', amount: 1, scheduled_for: null, given_at: '2026-11-08T10:00:00', by_user_id: 'u', by_name: 'Mom', note: '', ...over,
})
const local = (day: number, hh: number, mm = 0) => new Date(2026, 10, day, hh, mm).toISOString()

test('pieces of one slot are grouped under the time the dose was for, newest piece first', () => {
  const slot = local(8, 8)
  const days = groupDoses([
    row('b', { scheduled_for: slot, given_at: local(8, 8, 40), amount: 0.5 }),
    row('a', { scheduled_for: slot, given_at: local(8, 8, 10), amount: 1 }),
  ])
  expect(days).toHaveLength(1)
  expect(days[0]!.groups).toHaveLength(1)
  expect(days[0]!.groups[0]!.at).toBe(slot)
  expect(days[0]!.groups[0]!.rows.map((r) => r.id)).toEqual(['b', 'a'])
})

test('a dose with no slot is its own group at the time it was given', () => {
  const days = groupDoses([row('x', { given_at: local(8, 14) }), row('y', { given_at: local(8, 15) })])
  expect(days[0]!.groups.map((g) => g.rows.map((r) => r.id))).toEqual([['y'], ['x']]) // newest first
})

test('groups are newest first by their reference time, not by when they were logged', () => {
  const days = groupDoses([
    row('late', { scheduled_for: local(8, 8), given_at: local(8, 23) }), // 8 AM dose logged at night
    row('noon', { scheduled_for: local(8, 12), given_at: local(8, 12, 5) }),
  ])
  expect(days[0]!.groups.map((g) => g.rows[0]!.id)).toEqual(['noon', 'late'])
})

test('days are newest first and split at local midnight', () => {
  const days = groupDoses([row('d1', { given_at: local(7, 23, 30) }), row('d2', { given_at: local(8, 0, 30) })])
  expect(days.map((d) => d.groups[0]!.rows[0]!.id)).toEqual(['d2', 'd1'])
})

test('a group adds up the amounts given and ignores skipped pieces', () => {
  const slot = local(8, 8)
  const [day] = groupDoses([
    row('a', { scheduled_for: slot, amount: 0.25 }),
    row('b', { scheduled_for: slot, amount: 0.5, given_at: '2026-11-08T11:00:00' }),
    row('c', { scheduled_for: slot, status: 'skipped', amount: null, given_at: '2026-11-08T12:00:00' }),
  ])
  expect(day!.groups[0]!.total).toBe(0.75)
  expect(day!.groups[0]!.allSkipped).toBe(false)
  expect(groupDoses([row('s', { status: 'skipped', amount: null })])[0]!.groups[0]!.allSkipped).toBe(true)
})
