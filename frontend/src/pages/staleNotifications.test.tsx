import { waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ME_ADMIN, mockApi, renderApp } from '../test/utils'
import Home from './Home'

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
const minsFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString()
const note = (url: string) => ({ data: { url }, close: vi.fn() })
const KID = { id: 'k1', name: 'Baby', birth_date: null, feed_interval_minutes: 180, diaper_alert_minutes: 240 }
const slot = (status: string, dueMinsAgo: number) => ({ due_at: minsAgo(dueMinsAgo), status, given_amount: 0, remaining: 1, doses: [], dose_id: null, given_at: null, by_name: null, nudge: null })
const med = (id: string, slots: object[]) => ({
  id, name: id, dose_amount: 1, dose_unit: 'ml', schedule_kind: 'fixed', times: ['09:00'], interval_hours: null, first_dose_at: null,
  min_gap_hours: null, start_date: '2026-11-01', end_date: null, notes: '', ended: false, slots, last_dose: null,
})
const summary = (over: object = {}) => ({
  last_feed: { id: 'f', type: 'formula', started_at: minsAgo(30), duration_min: null, quantity_ml: 60, note: '', fed_by_name: 'Mom' },
  next_feed_due_at: minsFromNow(150), // fed recently: nothing due
  last_diaper: { id: 'd', kind: 'wet', at: minsAgo(20), changed_by_name: 'Mom' },
  feeds_today: 1, diapers_today: { wet: 1, dirty: 0, both: 0 }, sleep: { open: null, last: null }, ...over,
})
const run = (notes: ReturnType<typeof note>[], s: object, medicines: object[] = []) => {
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { serviceWorker: { ready: Promise.resolve({ getNotifications: async () => notes }) } }))
  mockApi({ 'GET /api/me': { body: ME_ADMIN }, 'GET /api/summary': { body: s }, 'GET /api/kid': { body: KID }, 'GET /api/medicines': { body: medicines } })
  renderApp(<Home />)
}
afterEach(() => vi.unstubAllGlobals())

test('a feed reminder already on the phone is cleared once a feed has been logged', async () => {
  const feed = note('/?log=feed')
  const diaper = note('/?log=diaper')
  run([feed, diaper], summary())
  await waitFor(() => expect(feed.close).toHaveBeenCalled())
  expect(diaper.close).toHaveBeenCalled() // changed 20 minutes ago, so its alert no longer applies either
})

test('reminders for things that are still due stay', async () => {
  const feed = note('/?log=feed')
  const diaper = note('/?log=diaper')
  run([feed, diaper], summary({ next_feed_due_at: minsAgo(10), last_diaper: { id: 'd', kind: 'wet', at: minsAgo(300), changed_by_name: 'Mom' } }))
  await new Promise((r) => setTimeout(r, 200))
  expect(feed.close).not.toHaveBeenCalled()
  expect(diaper.close).not.toHaveBeenCalled()
})

test('a medicine reminder is cleared when that medicine has nothing left to give, kept when it has', async () => {
  const done = note('/?log=medicine&med=m1')
  const owed = note('/?log=medicine&med=m2')
  run([done, owed], summary(), [med('m1', [{ ...slot('given', 40), remaining: 0 }]), med('m2', [slot('pending', 40)])])
  await waitFor(() => expect(done.close).toHaveBeenCalled())
  expect(owed.close).not.toHaveBeenCalled()
})

test('vaccine and visit reminders are left alone', async () => {
  const vaccine = note('/?log=vaccine')
  const visit = note('/?log=visit')
  run([vaccine, visit], summary())
  await new Promise((r) => setTimeout(r, 200))
  expect(vaccine.close).not.toHaveBeenCalled()
  expect(visit.close).not.toHaveBeenCalled()
})

test('without a service worker nothing breaks', async () => {
  mockApi({ 'GET /api/me': { body: ME_ADMIN }, 'GET /api/summary': { body: summary() }, 'GET /api/kid': { body: KID }, 'GET /api/medicines': { body: [] } })
  expect(() => renderApp(<Home />)).not.toThrow()
})
