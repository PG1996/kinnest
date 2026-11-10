import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import en from '../i18n/en.json'
import { ME_ADMIN, mockApi, renderApp } from '../test/utils'

const midnight = (offset = 0) => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset) }
const at = (offset: number, h: number) => { const d = midnight(offset); d.setHours(h); return d }
const chipName = (d: Date) => d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
const feed = (id: string, when: Date) => ({ id, type: 'formula', started_at: when.toISOString(), duration_min: null, quantity_ml: 60, note: '', fed_by_user_id: 'u1', fed_by_name: 'Mom' })
// the mock gives back every feed whatever the range asked for, like a server that ignores it; the page keeps only its day's
const FEEDS = [feed('f1', at(0, 0)), feed('f2', at(-2, 9))]
const api = () => ({
  'GET /api/me': { body: ME_ADMIN },
  'GET /api/summary': { status: 500 },
  'GET /api/feeds': { body: FEEDS },
  'GET /api/family/members': { body: [] },
  'GET /api/diapers': { body: [] },
  'GET /api/sleep': { body: [] },
})
const froms = (calls: { key: string; url: string }[], key: string) =>
  calls.filter((c) => c.key === key).map((c) => new URL(c.url, 'http://x').searchParams.get('from'))

const strip = () => screen.getByRole('group', { name: en.dayPager.strip })
const dayShown = () => screen.getByTestId('day-label').textContent
const swipeArea = () => screen.getByTestId('day-swipe')
function swipe(el: Element, dx: number, dy = 0, startX = 500) {
  fireEvent.pointerDown(el, { pointerId: 1, pointerType: 'touch', clientX: startX, clientY: 300 })
  fireEvent.pointerMove(el, { pointerId: 1, pointerType: 'touch', clientX: startX + dx / 2, clientY: 300 + dy / 2 })
  fireEvent.pointerMove(el, { pointerId: 1, pointerType: 'touch', clientX: startX + dx, clientY: 300 + dy })
  fireEvent.pointerUp(el, { pointerId: 1, pointerType: 'touch', clientX: startX + dx, clientY: 300 + dy })
}

test('the strip shows the last three weeks, today chosen', async () => {
  mockApi(api())
  renderApp(<App />, '/feeds')
  await screen.findByRole('list', { name: en.feeds.listLabel })
  const chips = within(strip()).getAllByRole('button')
  expect(chips).toHaveLength(21)
  expect(chips.at(-1)).toHaveAttribute('aria-pressed', 'true')
  expect(chips.at(-1)).toHaveAccessibleName(new RegExp(chipName(midnight(0))))
})

test('a day with entries has a dot, a day without does not', async () => {
  mockApi(api())
  renderApp(<App />, '/feeds')
  const s = await screen.findByRole('group', { name: en.dayPager.strip })
  await waitFor(() => expect(within(s).getByRole('button', { name: new RegExp(`${chipName(midnight(-2))}.*${en.dayPager.logged}`) })).toBeInTheDocument())
  expect(within(s).getByRole('button', { name: chipName(midnight(-1)) })).toBeInTheDocument()
})

test('tapping a day in the strip shows that day', async () => {
  const calls = mockApi(api())
  renderApp(<App />, '/feeds')
  await screen.findByRole('list', { name: en.feeds.listLabel })
  await userEvent.click(within(strip()).getByRole('button', { name: new RegExp(chipName(midnight(-2))) }))
  await waitFor(() => expect(dayShown()).toBe(chipName(midnight(-2))))
  expect(froms(calls, 'GET /api/feeds')).toContain(midnight(-2).toISOString())
  expect(within(strip()).getByRole('button', { name: new RegExp(chipName(midnight(-2))) })).toHaveAttribute('aria-pressed', 'true')
})

test('picking a date goes to that day', async () => {
  mockApi(api())
  renderApp(<App />, '/feeds')
  await screen.findByRole('list', { name: en.feeds.listLabel })
  const picker = screen.getByLabelText(en.dayPager.pick)
  const old = midnight(-40)
  fireEvent.change(picker, { target: { value: `${old.getFullYear()}-${String(old.getMonth() + 1).padStart(2, '0')}-${String(old.getDate()).padStart(2, '0')}` } })
  await waitFor(() => expect(dayShown()).toBe(chipName(old)))
  expect(within(strip()).getByRole('button', { name: new RegExp(chipName(old)) })).toHaveAttribute('aria-pressed', 'true')
})

test('the day before and after are loaded ahead, so a swipe shows them at once', async () => {
  const calls = mockApi(api())
  renderApp(<App />, '/feeds')
  await screen.findByRole('list', { name: en.feeds.listLabel })
  await waitFor(() => expect(froms(calls, 'GET /api/feeds')).toContain(midnight(-1).toISOString()))
})

test('swiping right shows the day before, swiping left comes back', async () => {
  mockApi(api())
  renderApp(<App />, '/feeds')
  await screen.findByRole('list', { name: en.feeds.listLabel })
  swipe(swipeArea(), 400)
  await waitFor(() => expect(dayShown()).toBe(chipName(midnight(-1))))
  swipe(swipeArea(), -400)
  await waitFor(() => expect(dayShown()).toBe(en.timeline.today))
})

test('swiping left on today does nothing: there is no day after today', async () => {
  mockApi(api())
  renderApp(<App />, '/feeds')
  await screen.findByRole('list', { name: en.feeds.listLabel })
  swipe(swipeArea(), -400)
  await new Promise((r) => setTimeout(r, 50))
  expect(dayShown()).toBe(en.timeline.today)
})

test('an up-and-down drag scrolls, and does not change the day', async () => {
  mockApi(api())
  renderApp(<App />, '/feeds')
  await screen.findByRole('list', { name: en.feeds.listLabel })
  const el = swipeArea()
  fireEvent.pointerDown(el, { pointerId: 1, pointerType: 'touch', clientX: 500, clientY: 300 })
  fireEvent.pointerMove(el, { pointerId: 1, pointerType: 'touch', clientX: 520, clientY: 360 })
  fireEvent.pointerMove(el, { pointerId: 1, pointerType: 'touch', clientX: 700, clientY: 600 })
  expect(el.style.transform).toBe('') // the content stays put while the page scrolls
  fireEvent.pointerUp(el, { pointerId: 1, pointerType: 'touch', clientX: 700, clientY: 600 })
  await new Promise((r) => setTimeout(r, 50))
  expect(dayShown()).toBe(en.timeline.today)
})

test('a swipe from the screen edge is left to the browser', async () => {
  mockApi(api())
  renderApp(<App />, '/feeds')
  await screen.findByRole('list', { name: en.feeds.listLabel })
  swipe(swipeArea(), 400, 0, 5)
  await new Promise((r) => setTimeout(r, 50))
  expect(dayShown()).toBe(en.timeline.today)
})

test('a swipe on the diaper strips belongs to the strips', async () => {
  mockApi(api())
  renderApp(<App />, '/diapers')
  const zoom = await screen.findByRole('radiogroup', { name: en.diapers.zoomLabel })
  swipe(zoom, 400)
  await new Promise((r) => setTimeout(r, 50))
  expect(dayShown()).toBe(en.timeline.today)
})

test('sleep and diapers have the strip too', async () => {
  const calls = mockApi(api())
  renderApp(<App />, '/sleep')
  await screen.findByRole('group', { name: en.dayPager.strip })
  swipe(swipeArea(), 400)
  await waitFor(() => expect(dayShown()).toBe(chipName(midnight(-1))))
  await waitFor(() => expect(froms(calls, 'GET /api/sleep')).toContain(midnight(-2).toISOString()))
})
