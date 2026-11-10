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

test('the last feed card shows how long its breaks were', async () => {
  const last = { ...SUMMARY().last_feed, type: 'breast_left', quantity_ml: null, duration_min: 35, break_min: 15 }
  mockApi(base(ME_ADMIN, SUMMARY({ last_feed: last })))
  renderApp(<Home />)
  expect(await screen.findByText(en.feed.breakTotal.replace('{{n}}', '15'))).toBeInTheDocument()
})

test('flags an overdue feed', async () => {
  mockApi(base(ME_ADMIN, SUMMARY({ next_feed_due_at: minsAgo(20) })))
  renderApp(<Home />)
  expect(await screen.findByText(en.home.dueAgo.replace('{{ago}}', '20m'))).toBeInTheDocument()
  expect(screen.getByText(en.home.overdue)).toBeInTheDocument()
})

// --- a feed in progress: the feed card must not call the feed overdue ---------------------------------------------------

const RUNNING = { id: 'tm1', type: 'formula', started_at: minsAgo(4), ended_at: null, started_by_name: 'Pankhuri' }

test('while a feed is being timed the feed card is not overdue and offers no "Log a feed" button', async () => {
  mockApi(base(ME_ADMIN, SUMMARY({ next_feed_due_at: minsAgo(20), feed_timer: RUNNING })))
  renderApp(<Home />)
  await screen.findByTestId('feed-timer-banner')
  expect(screen.queryByText(en.home.overdue)).not.toBeInTheDocument()
  expect(screen.queryByText(en.home.dueAgo.replace('{{ago}}', '20m'))).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: en.home.logFeedNow })).not.toBeInTheDocument()
  expect(screen.getByText(en.home.lastFedLabel)).toBeInTheDocument() // still says when the last feed was
  expect(screen.getByText(en.home.agoShort.replace('{{ago}}', '2h 10m'))).toBeInTheDocument()
})

test('a feed that is not overdue keeps its next-due pill, but not while a feed is being timed', async () => {
  mockApi(base(ME_ADMIN, SUMMARY({ feed_timer: RUNNING })))
  renderApp(<Home />)
  await screen.findByTestId('feed-timer-banner')
  expect(screen.queryByText(new RegExp(en.home.nextDue.replace('{{time}}', '.+')))).not.toBeInTheDocument()
  expect(screen.queryByText(en.home.toNextFeed)).not.toBeInTheDocument()
})

test('a viewer has no banner, so the feed card itself says a feed is in progress', async () => {
  mockApi(base(ME_VIEWER, SUMMARY({ next_feed_due_at: minsAgo(20), feed_timer: RUNNING })))
  renderApp(<Home />)
  const live = await screen.findByText(en.home.timerBanner)
  expect(live.closest('[data-badge]')!.querySelector('.animate-ping')).not.toBeNull()
  expect(screen.queryByText(en.home.overdue)).not.toBeInTheDocument()
})

test('once the timer is gone an overdue feed is flagged again', async () => {
  mockApi(base(ME_ADMIN, SUMMARY({ next_feed_due_at: minsAgo(20), feed_timer: null })))
  renderApp(<Home />)
  expect(await screen.findByText(en.home.overdue)).toBeInTheDocument()
})

// --- the timer on the Home card: start, pause, stop, as icons ----------------------------------------------------------------

const timerRoutes = (state: { timer: object | null }, me = ME_ADMIN) => ({
  ...base(me, SUMMARY()),
  'GET /api/summary': () => ({ body: SUMMARY({ feed_timer: state.timer }) }),
  'POST /api/feed-timer': (b: unknown) => { state.timer = { ...(b as object), ended_at: null, paused_at: null, paused_total_s: 0, started_by_name: 'Owner' }; return { status: 201, body: state.timer } },
  'PATCH /api/feed-timer': (b: unknown) => {
    const { paused, ...rest } = b as { paused?: boolean }
    state.timer = { ...(state.timer as object), ...rest, ...(paused === undefined ? {} : { paused_at: paused ? new Date().toISOString() : null }) }
    return { body: state.timer }
  },
})
const RUN = (over: object = {}) => ({ id: 'tm1', type: 'breast_left', started_at: minsAgo(10), ended_at: null, paused_at: null, paused_total_s: 0, started_by_name: 'Pankhuri', ...over })

test('the feed card has a start icon that starts a timer with the type of the last feed', async () => {
  const state = { timer: null as object | null }
  const calls = mockApi(timerRoutes(state))
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.home.timerStart }))
  await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/feed-timer')).toBe(true))
  const body = calls.find((c) => c.key === 'POST /api/feed-timer')!.body as { type: string; started_at: string; id: string }
  expect(body.type).toBe('formula') // the type of the last feed
  expect(Math.abs(Date.parse(body.started_at) - Date.now())).toBeLessThan(5_000)
  expect(await screen.findByTestId('feed-timer-banner')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: en.home.timerStart })).not.toBeInTheDocument() // one at a time
})

test('a viewer has no start icon, and a failed start says so', async () => {
  mockApi(timerRoutes({ timer: null }, ME_VIEWER))
  renderApp(<Home />)
  await screen.findByText(en.home.lastFedLabel)
  expect(screen.queryByRole('button', { name: en.home.timerStart })).not.toBeInTheDocument()
})

test('if the timer cannot be started the card says so', async () => {
  mockApi({ ...timerRoutes({ timer: null }), 'POST /api/feed-timer': { status: 500, body: {} } })
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.home.timerStart }))
  expect(await screen.findByText(en.home.timerFailed)).toBeInTheDocument()
})

test('the banner has pause and stop icons; pause pauses on the server and the badge stops pulsing', async () => {
  const state = { timer: RUN() as object | null }
  const calls = mockApi(timerRoutes(state))
  renderApp(<Home />)
  const banner = await screen.findByTestId('feed-timer-banner')
  expect(within(banner).getByText(en.home.timerBanner).closest('[data-badge]')!.querySelector('.animate-ping')).not.toBeNull()
  await userEvent.click(within(banner).getByRole('button', { name: en.home.timerPause }))
  await waitFor(() => expect(calls.find((c) => c.key === 'PATCH /api/feed-timer')?.body).toEqual({ paused: true }))
  const paused = await within(banner).findByText(en.home.timerPaused)
  expect(paused.closest('[data-badge]')!.querySelector('.animate-ping')).toBeNull()
  await userEvent.click(within(banner).getByRole('button', { name: en.home.timerResume }))
  await waitFor(() => expect(calls.filter((c) => c.key === 'PATCH /api/feed-timer').at(-1)?.body).toEqual({ paused: false }))
})

test('a paused banner shows the frozen feeding time, not the time on the clock', async () => {
  // started 10 min ago, 2 min of breaks done, a break began 3 min ago: 5 minutes of feeding
  mockApi(timerRoutes({ timer: RUN({ paused_total_s: 120, paused_at: minsAgo(3) }) }))
  renderApp(<Home />)
  expect((await screen.findByTestId('feed-timer-elapsed')).textContent).toMatch(/^5:0\d$/)
})

test('Stop on the banner stops the timer and opens the feed form on the breaks question', async () => {
  const state = { timer: RUN() as object | null }
  const calls = mockApi(timerRoutes(state))
  renderApp(<Home />)
  const banner = await screen.findByTestId('feed-timer-banner')
  await userEvent.click(within(banner).getByRole('button', { name: en.home.timerStop }))
  await waitFor(() => expect(calls.find((c) => c.key === 'PATCH /api/feed-timer')?.body).toMatchObject({ ended_at: expect.any(String) }))
  const sheet = await screen.findByRole('dialog', { name: en.home.feed })
  expect(await within(sheet).findByRole('group', { name: en.feed.breaksTitle })).toBeInTheDocument()
})

test('a stopped timer that was not saved can be resumed or opened from the banner', async () => {
  mockApi(timerRoutes({ timer: RUN({ ended_at: minsAgo(2) }) }))
  renderApp(<Home />)
  const banner = await screen.findByTestId('feed-timer-banner')
  expect(within(banner).getByText(en.home.timerHalted)).toBeInTheDocument()
  expect(within(banner).getByRole('button', { name: en.home.timerResume })).toBeInTheDocument()
  expect(within(banner).queryByRole('button', { name: en.home.timerPause })).not.toBeInTheDocument()
})

test('the notification\'s Stop button opens the app, stops the timer and asks about breaks', async () => {
  const state = { timer: RUN() as object | null }
  const calls = mockApi(timerRoutes(state))
  renderApp(<Home />, '/?log=feed&timer=stop')
  await waitFor(() => expect(calls.find((c) => c.key === 'PATCH /api/feed-timer')?.body).toMatchObject({ ended_at: expect.any(String) }))
  const sheet = await screen.findByRole('dialog', { name: en.home.feed })
  expect(await within(sheet).findByRole('group', { name: en.feed.breaksTitle })).toBeInTheDocument()
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

const NANNY = { user_id: 'u3', email: 'nanny@x.com', name: 'Nanny', role: 'caregiver', relation: 'nanny', pending: false }
const DAD = { user_id: 'u1', email: 'owner@x.com', name: 'Owner', role: 'admin', relation: 'dad', pending: false }
const AUNT = { user_id: 'u4', email: 'aunt@x.com', name: 'Aunt', role: 'viewer', relation: null, pending: false }

test('the diaper sheet asks who changed it: me by default, any admin or caregiver, never a viewer', async () => {
  const calls = mockApi({
    ...base(),
    'GET /api/family/members': { body: [DAD, NANNY, AUNT] },
    'POST /api/diapers': { status: 201, body: { id: 'x', recent_other: null } },
  })
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.home.diaper }))
  const dialog = await screen.findByRole('dialog')
  expect(await within(dialog).findByRole('button', { name: 'Owner', pressed: true })).toBeInTheDocument()
  expect(within(dialog).queryByRole('button', { name: 'Aunt' })).not.toBeInTheDocument()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Nanny' }))
  await userEvent.click(within(dialog).getByRole('button', { name: en.diaperKinds.dirty }))
  const post = await waitFor(() => calls.find((c) => c.key === 'POST /api/diapers')!)
  expect(post.body).toMatchObject({ kind: 'dirty', changed_by_user_id: 'u3' })
})

test('logging a diaper as myself sends no changed-by', async () => {
  const calls = mockApi({
    ...base(),
    'GET /api/family/members': { body: [DAD, NANNY] },
    'POST /api/diapers': { status: 201, body: { id: 'x', recent_other: null } },
  })
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.home.diaper }))
  await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Nanny' })
  await userEvent.click(screen.getByRole('button', { name: en.diaperKinds.wet }))
  const post = await waitFor(() => calls.find((c) => c.key === 'POST /api/diapers')!)
  expect(post.body).not.toHaveProperty('changed_by_user_id')
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


test('a feed being timed shows on Home with who started it and opens the feed sheet', async () => {
  const timer = { id: 'tm1', type: 'breast_left', started_at: minsAgo(4), ended_at: null, started_by_name: 'Pankhuri' }
  mockApi(base(ME_ADMIN, SUMMARY({ feed_timer: timer })))
  renderApp(<Home />)
  const banner = await screen.findByTestId('feed-timer-banner')
  expect(within(banner).getByText(en.feedTypes.breast_left)).toBeInTheDocument()
  expect(within(banner).getByText(en.home.by.replace('{{name}}', 'Pankhuri'))).toBeInTheDocument()
  expect(within(banner).getByTestId('feed-timer-elapsed').textContent).toMatch(/^4:\d\d$/)
  const live = within(banner).getByText(en.home.timerBanner)
  expect(live.closest('[data-badge]')!.querySelector('.animate-ping')).not.toBeNull() // a live, pulsing badge while it runs
  // the badge and the Open button share the first row, left-aligned with the timer below
  const badgeRow = live.closest('[data-badge]')!.parentElement!
  expect(within(badgeRow).getByRole('button', { name: en.home.timerOpen })).toBeInTheDocument()
  await userEvent.click(within(banner).getByRole('button', { name: en.home.timerOpen }))
  const sheet = await screen.findByRole('dialog', { name: en.home.feed })
  expect(sheet.getAttribute('data-sheet-tone')).toBe('feed') // the feed form wears the feed card's colour
})

test('a stopped timer is no longer a live badge: it says stopped and does not pulse', async () => {
  const timer = { id: 'tm1', type: 'formula', started_at: minsAgo(9), ended_at: minsAgo(4), started_by_name: 'Pankhuri' }
  mockApi(base(ME_ADMIN, SUMMARY({ feed_timer: timer })))
  renderApp(<Home />)
  const banner = await screen.findByTestId('feed-timer-banner')
  const badge = within(banner).getByText(en.home.timerHalted).closest('[data-badge]')!
  expect(badge.querySelector('.animate-ping')).toBeNull()
  expect(within(banner).queryByText(en.home.timerBanner)).not.toBeInTheDocument()
})

test('no banner when nothing is being timed', async () => {
  mockApi(base(ME_ADMIN, SUMMARY({ feed_timer: null })))
  renderApp(<Home />)
  await screen.findByText(en.home.agoShort.replace('{{ago}}', '2h 10m'))
  expect(screen.queryByTestId('feed-timer-banner')).not.toBeInTheDocument()
})
