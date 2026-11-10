import { screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import en from '../i18n/en.json'
import { formatTime } from '../lib/time'
import { feedStats } from '../lib/feedDay'
import { ME_ADMIN, ME_VIEWER, mockApi, renderApp } from '../test/utils'
import Home from './Home'

const today = (h: number, m = 0) => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m) }
const feed = (id: string, at: Date, over: object = {}) => ({ id, type: 'formula', started_at: at.toISOString(), duration_min: null, quantity_ml: 60, note: '', fed_by_user_id: 'u1', fed_by_name: 'Mom', ...over })
const F = [
  feed('f1', today(0, 10)),
  feed('f2', today(0, 40), { type: 'breast_left', quantity_ml: null, duration_min: 20, fed_by_name: 'Pankhuri' }),
  feed('f3', today(2, 10), { quantity_ml: 90 }),
]
const api = (me: object = ME_ADMIN, extra: object = {}) => ({
  'GET /api/me': { body: me },
  'GET /api/summary': { status: 500 },
  'GET /api/feeds': { body: F },
  'GET /api/family/members': { body: [] },
  ...extra,
})
const feedCalls = (calls: { key: string; url: string }[]) => calls.filter((c) => c.key === 'GET /api/feeds').map((c) => new URL(c.url, 'http://x'))

test('feedStats counts feeds, bottle ml, breast minutes and the average gap between starts', () => {
  const s = feedStats([F[2]!, F[1]!, F[0]!] as never)
  expect(s).toEqual({ count: 3, ml: 150, minutes: 20, avgGapMin: 60 }) // 00:10 → 00:40 → 02:10 are 30 and 90 minutes apart
  expect(feedStats([F[0]!] as never).avgGapMin).toBeNull()
  expect(feedStats([])).toEqual({ count: 0, ml: 0, minutes: 0, avgGapMin: null })
})

test('the day lists its feeds newest first with 12-hour times, what and who', async () => {
  mockApi(api())
  renderApp(<App />, '/feeds')
  const list = await screen.findByRole('list', { name: en.feeds.listLabel })
  await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(3))
  const rows = within(list).getAllByRole('listitem')
  expect(rows[0]).toHaveTextContent('90 ml')
  expect(rows[0]).toHaveTextContent(formatTime(today(2, 10)))
  expect(rows[1]).toHaveTextContent('20 min')
  expect(rows[1]).toHaveTextContent('Pankhuri')
})

test('a feed with breaks says how long they were', async () => {
  const withBreaks = [feed('b1', today(1, 0), { type: 'breast_left', quantity_ml: null, duration_min: 35, break_min: 15 })]
  mockApi(api(ME_ADMIN, { 'GET /api/feeds': { body: withBreaks } }))
  renderApp(<App />, '/feeds')
  const list = await screen.findByRole('list', { name: en.feeds.listLabel })
  expect(await within(list).findByText(new RegExp(en.feed.breakTotal.replace('{{n}}', '15')))).toBeInTheDocument()
})

test('the totals sit above the list', async () => {
  mockApi(api())
  renderApp(<App />, '/feeds')
  const stats = await screen.findByTestId('feed-stats')
  await waitFor(() => expect(stats).toHaveTextContent('150 ml'))
  expect(stats).toHaveTextContent('3')
  expect(stats).toHaveTextContent('150 ml')
  expect(stats).toHaveTextContent('20 min')
  expect(stats).toHaveTextContent(/1h/)
})

test('previous day fetches the earlier range, and there is no day after today', async () => {
  const calls = mockApi(api())
  renderApp(<App />, '/feeds')
  await screen.findByRole('list', { name: en.feeds.listLabel })
  expect(screen.getByRole('button', { name: en.feeds.nextDay })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: en.feeds.prevDay }))
  await waitFor(() => expect(feedCalls(calls).length).toBeGreaterThan(1))
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1)
  expect(new Date(feedCalls(calls).at(-1)!.searchParams.get('from')!).getDate()).toBe(yesterday.getDate())
})

test('Add a past feed opens the feed form', async () => {
  mockApi(api())
  renderApp(<App />, '/feeds')
  await userEvent.click(await screen.findByRole('button', { name: en.feeds.addPast }))
  expect(await screen.findByRole('dialog', { name: en.timeline.feedAddTitle })).toBeInTheDocument()
})

test('feeds open in the timeline to be fixed or deleted, and a viewer cannot', async () => {
  mockApi(api())
  const admin = renderApp(<App />, '/feeds')
  const links = await screen.findAllByRole('link', { name: en.timeline.edit })
  expect(links[0]).toHaveAttribute('href', expect.stringMatching(/^\/timeline\?day=\d{4}-\d{2}-\d{2}&entry=feed:f3$/))
  admin.unmount()
  mockApi(api(ME_VIEWER))
  renderApp(<App />, '/feeds')
  await screen.findByRole('list', { name: en.feeds.listLabel })
  expect(screen.queryByRole('link', { name: en.timeline.edit })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: en.feeds.addPast })).not.toBeInTheDocument()
})

test('the last-fed card on Home opens the feeds screen', async () => {
  const summary = { last_feed: F[2], next_feed_due_at: new Date(Date.now() + 3_600_000).toISOString(), last_diaper: null, feeds_today: 3, diapers_today: { wet: 0, dirty: 0, both: 0 }, sleep: { open: null, last: null } }
  mockApi({ 'GET /api/me': { body: ME_ADMIN }, 'GET /api/summary': { body: summary } })
  renderApp(<Home />)
  expect(await screen.findByRole('link', { name: en.feeds.title })).toHaveAttribute('href', '/feeds')
})

test('the feeds screen shows the feed clock and the gaps', async () => {
  mockApi(api({ ...ME_ADMIN }, { 'GET /api/kid': { body: { id: 'k1', name: 'Baby', birth_date: null, feed_interval_minutes: 180, diaper_alert_minutes: 240 } } }))
  renderApp(<App />, '/feeds')
  expect(await screen.findByRole('img', { name: /3 feeds/ })).toBeInTheDocument()
  expect(await screen.findByRole('img', { name: en.feeds.gapsLabel })).toBeInTheDocument()
})
