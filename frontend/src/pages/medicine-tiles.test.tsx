import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import en from '../i18n/en.json'
import { ME_ADMIN, ME_VIEWER, mockApi, renderApp } from '../test/utils'
import Home from './Home'

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
const minsFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString()
const slot = (over: object = {}) => ({ due_at: minsAgo(20), status: 'pending', given_amount: 0, remaining: 1, doses: [], dose_id: null, given_at: null, by_name: null, nudge: null, ...over })
const med = (id: string, name: string, slots: object[], over: object = {}) => ({
  id, name, dose_amount: 1, dose_unit: 'ml', schedule_kind: 'fixed', times: ['09:00'], interval_hours: null, first_dose_at: null,
  min_gap_hours: null, start_date: '2026-11-01', end_date: null, notes: '', ended: false, slots, last_dose: null, ...over,
})
const done = (over: object = {}) => slot({ status: 'given', given_amount: 1, remaining: 0, dose_id: 'd1', given_at: minsAgo(30), by_name: 'Mom', ...over })
const sos = (over: object = {}) => med('m4', 'Colicaid', [], { schedule_kind: 'as_needed', times: [], dose_amount: 0.5, ...over })
const summary = { last_feed: null, next_feed_due_at: null, last_diaper: null, feeds_today: 0, diapers_today: { wet: 0, dirty: 0, both: 0 }, sleep: { open: null, last: null } }
const MEDS = [med('m1', 'Vitamin D', [done()]), med('m2', 'Domstal', [slot({ due_at: minsFromNow(180) })]), med('m3', 'Iron', [slot({ due_at: minsAgo(15) })]), sos()]
const base = (medicines: object[], me: object = ME_ADMIN) => ({ 'GET /api/me': { body: me }, 'GET /api/summary': { body: summary }, 'GET /api/medicines': { body: medicines } })
const tiles = () => within(screen.getByTestId('medicine-grid')).getAllByRole('button')

test('every medicine is a small tile in a three-column grid', async () => {
  mockApi(base(MEDS))
  renderApp(<Home />)
  const grid = await screen.findByTestId('medicine-grid')
  expect(grid.className).toContain('grid-cols-3')
  expect(tiles()).toHaveLength(4)
  for (const t of tiles()) expect(t.className).toContain('aspect-square')
})

test('a tile shows the name, the dose and what is going on', async () => {
  mockApi(base(MEDS))
  renderApp(<Home />)
  const grid = await screen.findByTestId('medicine-grid')
  const tile = (name: string) => within(grid).getByRole('button', { name: new RegExp(name) })
  expect(tile('Vitamin D')).toHaveTextContent('1 ml')
  expect(tile('Vitamin D')).toHaveTextContent(en.medicines.tileDone)
  expect(tile('Domstal')).toHaveTextContent(new RegExp(en.medicines.tileNext.replace('{{time}}', '.+')))
  expect(tile('Iron')).toHaveTextContent(en.medicines.tileDue)
  expect(tile('Colicaid')).toHaveTextContent(en.medicines.sosBadge)
})

test('the medicine that needs a dose is opened below the grid by itself', async () => {
  mockApi(base(MEDS))
  renderApp(<Home />)
  const grid = await screen.findByTestId('medicine-grid')
  expect(within(grid).getByRole('button', { name: /Iron/ })).toHaveAttribute('aria-pressed', 'true')
  const detail = screen.getByTestId('medicine-detail')
  expect(within(detail).getByText(/Iron/)).toBeInTheDocument()
  expect(within(detail).getByRole('button', { name: en.medicines.giveFull })).toBeInTheDocument()
  expect(within(detail).queryByText(/Vitamin D/)).not.toBeInTheDocument()
})

test('tapping another tile opens that medicine instead', async () => {
  mockApi(base(MEDS))
  renderApp(<Home />)
  const grid = await screen.findByTestId('medicine-grid')
  await userEvent.click(within(grid).getByRole('button', { name: /Colicaid/ }))
  expect(within(grid).getByRole('button', { name: /Colicaid/ })).toHaveAttribute('aria-pressed', 'true')
  expect(within(grid).getByRole('button', { name: /Iron/ })).toHaveAttribute('aria-pressed', 'false')
  const detail = screen.getByTestId('medicine-detail')
  expect(within(detail).getByText(/Colicaid/)).toBeInTheDocument()
  expect(within(detail).getByRole('button', { name: en.medicines.giveFull })).toBeInTheDocument()
  expect(within(detail).queryByText(/Iron/)).not.toBeInTheDocument()
})

test('with nothing due the first medicine is opened', async () => {
  mockApi(base([MEDS[0]!, MEDS[1]!]))
  renderApp(<Home />)
  const grid = await screen.findByTestId('medicine-grid')
  expect(within(grid).getByRole('button', { name: /Vitamin D/ })).toHaveAttribute('aria-pressed', 'true')
})

test('an SOS tile shows when it was last given', async () => {
  mockApi(base([sos({ last_dose: { id: 'x', status: 'given', amount: 0.5, given_at: minsAgo(120), by_name: 'Mom' } })]))
  renderApp(<Home />)
  const grid = await screen.findByTestId('medicine-grid')
  expect(within(grid).getByRole('button', { name: /Colicaid/ })).toHaveTextContent('2h 0m')
})

test('a missed dose marks its tile so it is not lost in the grid', async () => {
  mockApi(base([med('m1', 'Iron', [slot({ due_at: minsAgo(26 * 60) }), slot({ due_at: minsAgo(15) })])]))
  renderApp(<Home />)
  const grid = await screen.findByTestId('medicine-grid')
  expect(within(grid).getByRole('button', { name: /Iron/ })).toHaveTextContent(en.medicines.tileMissed.replace('{{count}}', '1'))
})

test('a viewer sees the tiles and the details but no dose buttons', async () => {
  mockApi(base(MEDS, ME_VIEWER))
  renderApp(<Home />)
  await screen.findByTestId('medicine-grid')
  expect(screen.queryByRole('button', { name: en.medicines.giveFull })).not.toBeInTheDocument()
  expect(tiles()).toHaveLength(4)
})
