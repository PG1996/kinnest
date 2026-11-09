import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import en from '../i18n/en.json'
import { formatAgo, formatClock } from '../lib/time'
import { ME_ADMIN, ME_VIEWER, mockApi, renderApp } from '../test/utils'
import Home from './Home'

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
const minsFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString()

const SUMMARY = (over: object = {}) => ({
  last_feed: {
    id: 'f1', type: 'formula', started_at: minsAgo(130), duration_min: null, quantity_ml: 60,
    note: '', fed_by_user_id: 'u2', fed_by_name: 'Mom', created_by: 'u2',
  },
  next_feed_due_at: minsFromNow(50),
  last_diaper: { id: 'd1', kind: 'wet', at: minsAgo(65), changed_by_name: 'Nanny' },
  feeds_today: 4,
  diapers_today: { wet: 3, dirty: 1, both: 0 },
  ...over,
})

const base = (me = ME_ADMIN, summary: object = SUMMARY()) => ({
  'GET /api/me': { body: me },
  'GET /api/summary': { body: summary },
})

test('formatAgo renders minutes, hours and days', () => {
  expect(formatAgo(30_000)).toBe('<1m')
  expect(formatAgo(5 * 60_000)).toBe('5m')
  expect(formatAgo(130 * 60_000)).toBe('2h 10m')
  expect(formatAgo((26 * 60 + 5) * 60_000)).toBe('1d 2h')
})

test('shows last fed relative time and next due', async () => {
  mockApi(base())
  renderApp(<Home />)
  expect(await screen.findByText(en.home.agoShort.replace('{{ago}}', '2h 10m'))).toBeInTheDocument()
  const detail = screen.getByTestId('feed-detail')
  expect(within(detail).getByText(en.feedTypes.formula)).toBeInTheDocument()
  expect(within(detail).getByText('60 ml')).toBeInTheDocument()
  expect(within(detail).getByText(en.home.by.replace('{{name}}', 'Mom'))).toBeInTheDocument()
  const due = SUMMARY().next_feed_due_at
  expect(screen.getByText(en.home.nextDue.replace('{{time}}', formatClock(due)))).toBeInTheDocument()
  expect(screen.getByText(en.home.agoShort.replace('{{ago}}', '1h 5m'))).toBeInTheDocument()
})

test('the last diaper card shows what it was as a pill, who changed it, and today as small counts', async () => {
  mockApi(base())
  renderApp(<Home />)
  const card = within(await screen.findByTestId('diaper-card'))
  expect(card.getByText(en.home.agoShort.replace('{{ago}}', '1h 5m'))).toBeInTheDocument()
  expect(card.getByText(en.diaperKinds.wet)).toBeInTheDocument() // the kind pill
  expect(card.getByText(en.home.by.replace('{{name}}', 'Nanny'))).toBeInTheDocument()
  const today = within(card.getByTestId('diaper-today'))
  expect(today.getByText(en.home.todayLabel)).toBeInTheDocument()
  expect(today.getByText(en.home.todayWet.replace('{{n}}', '3'))).toBeInTheDocument()
  expect(today.getByText(en.home.todayDirty.replace('{{n}}', '1'))).toBeInTheDocument()
  expect(today.getByText(en.home.todayBoth.replace('{{n}}', '0'))).toBeInTheDocument()
})

test('flags an overdue feed', async () => {
  mockApi(base(ME_ADMIN, SUMMARY({ next_feed_due_at: minsAgo(20) })))
  renderApp(<Home />)
  expect(await screen.findByText(en.home.dueAgo.replace('{{ago}}', '20m'))).toBeInTheDocument()
  expect(screen.getByText(en.home.overdue)).toBeInTheDocument()
})

test('shows empty states before anything is logged', async () => {
  mockApi(base(ME_ADMIN, SUMMARY({ last_feed: null, next_feed_due_at: null, last_diaper: null })))
  renderApp(<Home />)
  expect(await screen.findByText(en.home.neverFed)).toBeInTheDocument()
  expect(screen.getByText(en.home.noDiaper)).toBeInTheDocument()
})

test('viewer sees no log buttons', async () => {
  mockApi(base(ME_VIEWER))
  renderApp(<Home />)
  await screen.findByText(en.home.agoShort.replace('{{ago}}', '2h 10m'))
  for (const name of [en.home.feed, en.home.diaper, en.sleep.start, en.home.quick.medicine])
    expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: en.home.quick.vital })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: en.home.logFeedNow })).not.toBeInTheDocument()
})

test('diaper wet button posts immediately and offers undo', async () => {
  const calls = mockApi({
    ...base(),
    'POST /api/diapers': { status: 201, body: { id: 'x', recent_other: null } },
    'DELETE /api/diapers/': { body: { ok: true } },
  })
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.home.diaper }))
  await userEvent.click(screen.getByRole('button', { name: en.diaperKinds.wet }))
  const post = await waitFor(() => {
    const c = calls.find((c) => c.key === 'POST /api/diapers')
    expect(c).toBeTruthy()
    return c!
  })
  expect(post.body).toMatchObject({ kind: 'wet' })
  const id = (post.body as { id: string }).id
  expect(id).toMatch(/^[0-9a-f-]{36}$/)
  expect(new Date((post.body as { at: string }).at).getTime()).toBeLessThanOrEqual(Date.now())
  const undo = await screen.findByRole('button', { name: en.home.undo })
  mockApi({ ...base(), [`DELETE /api/diapers/${id}`]: { body: { ok: true } } })
  await userEvent.click(undo)
  await waitFor(() => expect(screen.queryByRole('button', { name: en.home.undo })).not.toBeInTheDocument())
})

test('feed sheet is prefilled from the last feed and saves in one tap', async () => {
  const calls = mockApi({ ...base(), 'POST /api/feeds': { status: 201, body: { id: 'x', recent_other: null } } })
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.home.feed }))
  expect(screen.getByLabelText(en.home.amount)).toHaveTextContent('60')
  await userEvent.click(screen.getByRole('button', { name: en.home.saveFeed }))
  await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/feeds')).toBe(true))
  const body = calls.find((c) => c.key === 'POST /api/feeds')!.body as Record<string, unknown>
  expect(body).toMatchObject({ type: 'formula', quantity_ml: 60 })
  expect(body.id).toMatch(/^[0-9a-f-]{36}$/)
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

test('feed sheet hides ml for breast types', async () => {
  mockApi(base())
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.home.feed }))
  expect(screen.getByLabelText(en.home.amount)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('radio', { name: en.feedTypes.breast_left }))
  expect(screen.queryByLabelText(en.home.amount)).not.toBeInTheDocument()
  expect(screen.getByLabelText(en.home.duration)).toBeInTheDocument()
})

test('warns when someone else just logged the same thing, and says when', async () => {
  const at = '2026-11-04T10:05:00.000Z'
  mockApi({
    ...base(),
    'POST /api/feeds': { status: 201, body: { id: 'x', recent_other: { user_name: 'Mom', at } } },
  })
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.home.feed }))
  await userEvent.click(screen.getByRole('button', { name: en.home.saveFeed }))
  const warning = await screen.findByText(/Mom also logged/)
  expect(warning).toHaveTextContent(formatClock(at))
})

test('feed hero shows the gauge with time to the next feed', async () => {
  mockApi(base())
  renderApp(<Home />)
  expect(await screen.findByRole('img', { name: /72%|7\d%/ })).toBeInTheDocument()
  expect(screen.getByText('50m')).toBeInTheDocument()
  expect(screen.getByText(en.home.toNextFeed)).toBeInTheDocument()
})

test('overdue feed shows log feed now, which opens the feed screen', async () => {
  mockApi(base(ME_ADMIN, SUMMARY({ next_feed_due_at: minsAgo(20) })))
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.home.logFeedNow }))
  expect(await screen.findByRole('dialog')).toBeInTheDocument()
})

const diaperDays = (counts: number[]) =>
  counts.flatMap((n, back) =>
    Array.from({ length: n }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - back); d.setHours(8, i, 0, 0)
      return { kind: 'diaper', id: `d-${back}-${i}`, at: d.toISOString(), data: { kind: 'wet' } }
    }),
  )

test('diaper card shows a seven-day sparkline and the average of finished days', async () => {
  // counts[0] is today (unfinished), then six earlier days
  mockApi({ ...base(), 'GET /api/timeline': { body: { items: diaperDays([6, 7, 7, 7, 7, 7, 7]) } } })
  renderApp(<Home />)
  expect(await screen.findByRole('img', { name: /7, 7, 7, 7, 7, 7, 6/ })).toBeInTheDocument()
  expect(screen.getByText(en.home.sparkAvg.replace('{{avg}}', '7.0'))).toBeInTheDocument()
})

test('on day two the average counts only days that have data and not today', async () => {
  // today 3 so far, yesterday 8: the average is 8, not (3+8)/7
  mockApi({ ...base(), 'GET /api/timeline': { body: { items: diaperDays([3, 8]) } } })
  renderApp(<Home />)
  expect(await screen.findByText(en.home.sparkAvg.replace('{{avg}}', '8.0'))).toBeInTheDocument()
})

test('no finished day yet hides the average instead of showing a tiny one', async () => {
  mockApi({ ...base(), 'GET /api/timeline': { body: { items: diaperDays([3]) } } })
  renderApp(<Home />)
  await screen.findByText(en.home.agoShort.replace('{{ago}}', '1h 5m'))
  expect(screen.queryByText(/avg/i)).not.toBeInTheDocument()
})

test('quick log shows five tiles for a caregiver', async () => {
  mockApi(base())
  renderApp(<Home />)
  for (const name of [en.home.feed, en.home.diaper, en.sleep.start, en.home.quick.medicine])
    expect(await screen.findByRole('button', { name })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: en.home.quick.vital })).toHaveAttribute('href', '/health?tab=vitals&add=1')
})

test('header shows the baby name, age and family', async () => {
  const born = new Date(Date.now() - 16 * 24 * 3600_000)
  const iso = `${born.getFullYear()}-${String(born.getMonth() + 1).padStart(2, '0')}-${String(born.getDate()).padStart(2, '0')}`
  mockApi({
    ...base(),
    'GET /api/kid': { body: { id: 'k1', name: 'Aanya', birth_date: iso, feed_interval_minutes: 180, diaper_alert_minutes: 240 } },
    'GET /api/family/members': { body: [{ user_id: 'u1', email: 'o@x.com', name: 'Owner', role: 'admin', pending: false }, { user_id: 'u2', email: 'm@x.com', name: 'Mom', role: 'caregiver', pending: false }] },
  })
  renderApp(<Home />)
  expect(await screen.findByRole('heading', { name: 'Aanya' })).toBeInTheDocument()
  expect(screen.getByText(/16 days old/)).toBeInTheDocument()
  expect(screen.getByRole('group', { name: 'Owner, Mom' })).toBeInTheDocument()
})

test('empty family home has calm empty states and no NaN', async () => {
  mockApi(base(ME_ADMIN, SUMMARY({ last_feed: null, next_feed_due_at: null, last_diaper: null, feeds_today: 0, diapers_today: { wet: 0, dirty: 0, both: 0 } })))
  renderApp(<Home />)
  expect(await screen.findByText(en.home.neverFed)).toBeInTheDocument()
  expect(screen.getByText(en.home.noDiaper)).toBeInTheDocument()
  expect(document.body.textContent).not.toMatch(/NaN|undefined/)
})
