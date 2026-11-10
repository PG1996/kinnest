import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import en from '../i18n/en.json'
import { ME_ADMIN, clickAction, mockApi, renderApp } from '../test/utils'
import Home from './Home'

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
const summary = { last_feed: null, next_feed_due_at: null, last_diaper: null, feeds_today: 0, diapers_today: { wet: 0, dirty: 0, both: 0 }, sleep: { open: null, last: null } }
const med = {
  id: 'm1', name: 'Syrup', dose_amount: 1, dose_unit: 'ml', schedule_kind: 'fixed', times: ['09:00'], interval_hours: null, first_dose_at: null,
  min_gap_hours: null, start_date: '2026-11-01', end_date: null, notes: '', ended: false, last_dose: null,
  slots: [{ due_at: minsAgo(20), status: 'pending', given_amount: 0, remaining: 1, doses: [], dose_id: null, given_at: null, by_name: null, nudge: null }],
}
const api = () => ({ 'GET /api/me': { body: ME_ADMIN }, 'GET /api/summary': { body: summary }, 'GET /api/medicines': { body: [med] } })
const toneOf = (name: string) => screen.findByRole('dialog', { name }).then((d) => d.getAttribute('data-sheet-tone'))

test('the diaper sheet wears the diaper colour', async () => {
  mockApi(api())
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.home.diaper }))
  expect(await toneOf(en.home.diaperTitle)).toBe('diaper')
})

test('the feed sheet wears the feed colour', async () => {
  mockApi(api())
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.home.feed }))
  expect(await toneOf(en.home.feed)).toBe('feed')
})

test('the dose screen wears the medicine colour', async () => {
  mockApi(api())
  renderApp(<Home />)
  await clickAction(en.medicines.givePartial)
  expect(await toneOf(en.medicines.giveTitle)).toBe('med')
})
