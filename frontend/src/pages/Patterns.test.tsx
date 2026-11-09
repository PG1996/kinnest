import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import en from '../i18n/en.json'
import { ME_ADMIN, mockApi, renderApp } from '../test/utils'
import Patterns from './Patterns'

const back = (days: number, h: number, m = 0) => {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - days, h, m)
}
const feed = (id: string, at: Date) => ({ kind: 'feed', id, at: at.toISOString(), data: { type: 'formula' } })
const sleepItem = (id: string, start: Date, end: Date) => ({
  kind: 'sleep', id, at: start.toISOString(),
  data: { started_at: start.toISOString(), ended_at: end.toISOString(), duration_min: Math.round((end.getTime() - start.getTime()) / 60000), started_by_name: 'Mom' },
})
const diaper = (id: string, at: Date) => ({ kind: 'diaper', id, at: at.toISOString(), data: { kind: 'wet' } })

// two days of data: 3 feeds two days ago, 5 yesterday
const ITEMS = [
  feed('a', back(2, 8)), feed('b', back(2, 12)), feed('c', back(2, 20)),
  feed('d', back(1, 1)), feed('e', back(1, 5)), feed('f', back(1, 9, 30)), feed('g', back(1, 13)), feed('h', back(1, 21)),
  sleepItem('s1', back(2, 23, 40), back(1, 2, 50)),
  sleepItem('s2', back(1, 10), back(1, 11)),
  diaper('x', back(1, 9)),
]
const api = (items: object[] = ITEMS) => ({ 'GET /api/me': { body: ME_ADMIN }, 'GET /api/timeline': { body: { items } } })

test('the heatmap has a row per day and a cell per two hours', async () => {
  mockApi(api())
  renderApp(<Patterns />)
  expect(await screen.findAllByRole('row')).toHaveLength(7)
  expect(screen.getAllByRole('gridcell')).toHaveLength(84)
})

test('tapping a cell shows its details', async () => {
  mockApi(api())
  renderApp(<Patterns />)
  // two days both have one feed between 8 and 10 AM
  const [cell] = await screen.findAllByRole('gridcell', { name: /8 AM.*1 feed/ })
  await userEvent.click(cell!)
  expect(within(screen.getByRole('status')).getByText(/1 feed/)).toBeInTheDocument()
})

test('switching to sleep changes the legend and the cell details', async () => {
  mockApi(api())
  renderApp(<Patterns />)
  await screen.findAllByRole('gridcell')
  expect(document.querySelectorAll('[data-legend]')).toHaveLength(3)
  await userEvent.click(screen.getByRole('radio', { name: en.patterns.modes.sleep }))
  expect(document.querySelectorAll('[data-legend]')).toHaveLength(5)
  expect(screen.getAllByRole('gridcell', { name: /asleep/ }).length).toBeGreaterThan(0)
})

test('with two days of data the averages use those two days and a note says patterns get clearer', async () => {
  mockApi(api())
  renderApp(<Patterns />)
  const card = (await screen.findByText(en.patterns.stats.feeds)).parentElement!
  await waitFor(() => expect(card).toHaveTextContent('4.0'))
  expect(screen.getByText(en.patterns.clearer)).toBeInTheDocument()
})

test('longest sleep is shown', async () => {
  mockApi(api())
  renderApp(<Patterns />)
  expect(await screen.findByText(en.patterns.longest.replace('{{duration}}', '3h 10m'))).toBeInTheDocument()
})

test('no data at all gives calm zeros and no NaN', async () => {
  mockApi(api([]))
  renderApp(<Patterns />)
  expect(await screen.findByText(en.patterns.clearer)).toBeInTheDocument()
  expect(screen.queryByText(en.patterns.longest.replace('{{duration}}', ''))).not.toBeInTheDocument()
  expect(document.body.textContent).not.toMatch(/NaN|undefined|Infinity/)
})
