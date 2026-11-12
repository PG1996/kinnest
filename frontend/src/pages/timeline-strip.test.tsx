import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import en from '../i18n/en.json'
import { ME_ADMIN, mockApi, renderApp } from '../test/utils'
import Timeline from './Timeline'

const midnight = (offset = 0) => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset) }
const at = (offset: number, h: number) => { const d = midnight(offset); d.setHours(h); return d.toISOString() }
const chipName = (d: Date) => d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
// every range asks the same mock, which gives back all of these; each day keeps only its own
const ITEMS = [
  { kind: 'feed', id: 'f1', at: at(0, 0), data: { type: 'formula', quantity_ml: 60, duration_min: null, fed_by_name: 'Mom' } },
  { kind: 'feed', id: 'f2', at: at(-2, 9), data: { type: 'formula', quantity_ml: 90, duration_min: null, fed_by_name: 'Mom' } },
  { kind: 'diaper', id: 'd2', at: at(-2, 10), data: { kind: 'wet', changed_by_name: 'Nani' } },
]
const api = () => ({ 'GET /api/me': { body: ME_ADMIN }, 'GET /api/timeline': { body: { items: ITEMS } } })
const froms = (calls: { key: string; url: string }[]) => calls.filter((c) => c.key === 'GET /api/timeline').map((c) => new URL(c.url, 'http://x').searchParams.get('from'))
const strip = () => screen.getByRole('group', { name: en.dayPager.strip })
const chip = (d: Date) => within(strip()).getByRole('button', { name: new RegExp(`^${chipName(d)}`) })
function swipe(el: Element, dx: number) {
  fireEvent.pointerDown(el, { pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 300 })
  fireEvent.pointerMove(el, { pointerId: 1, pointerType: 'touch', clientX: 200 + dx / 2, clientY: 300 })
  fireEvent.pointerMove(el, { pointerId: 1, pointerType: 'touch', clientX: 200 + dx, clientY: 300 })
  fireEvent.pointerUp(el, { pointerId: 1, pointerType: 'touch', clientX: 200 + dx, clientY: 300 })
}

test('the timeline has a strip of the last three weeks, today chosen', async () => {
  mockApi(api())
  renderApp(<Timeline />)
  await screen.findByText(`${en.feedTypes.formula} · 60 ml`)
  expect(within(strip()).getAllByRole('button')).toHaveLength(21)
  expect(chip(midnight(0))).toHaveAttribute('aria-pressed', 'true')
})

test('each day says what was logged on it', async () => {
  mockApi(api())
  renderApp(<Timeline />)
  await waitFor(() => expect(chip(midnight(-2))).toHaveAccessibleName(`${chipName(midnight(-2))}, ${en.timeline.filters.feed}, ${en.timeline.filters.diaper}`))
  expect(chip(midnight(-1))).toHaveAccessibleName(chipName(midnight(-1)))
})

test('tapping an older day shows only that day, fetched with the night before it', async () => {
  const calls = mockApi(api())
  renderApp(<Timeline />)
  await screen.findByText(`${en.feedTypes.formula} · 60 ml`)
  await userEvent.click(chip(midnight(-2)))
  expect(await screen.findByText(`${en.feedTypes.formula} · 90 ml`)).toBeInTheDocument()
  expect(screen.queryByText(`${en.feedTypes.formula} · 60 ml`)).not.toBeInTheDocument()
  expect(froms(calls)).toContain(midnight(-3).toISOString())
  expect(chip(midnight(-2))).toHaveAttribute('aria-pressed', 'true')
})

test('swiping right on the chart shows the day before', async () => {
  mockApi(api())
  renderApp(<Timeline />)
  await screen.findByText(`${en.feedTypes.formula} · 60 ml`)
  swipe(screen.getByRole('group', { name: en.dayChart.label }).querySelector('svg')!, 260)
  await waitFor(() => expect(chip(midnight(-1))).toHaveAttribute('aria-pressed', 'true'))
})
