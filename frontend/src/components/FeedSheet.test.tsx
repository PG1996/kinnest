import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import en from '../i18n/en.json'
import { formatTime } from '../lib/time'
import { ME_ADMIN, mockApi, renderApp } from '../test/utils'
import FeedSheet from './FeedSheet'

const MEMBERS = [
  { user_id: 'u1', email: 'owner@x.com', name: 'Owner', role: 'admin', pending: false },
  { user_id: 'u2', email: 'mom@x.com', name: 'Mom', role: 'caregiver', pending: false },
]
const KID = { id: 'k1', name: 'Aanya', birth_date: '2026-10-23', feed_interval_minutes: 180, diaper_alert_minutes: 240 }
const api = () => ({
  'GET /api/me': { body: { ...ME_ADMIN, user: { ...ME_ADMIN.user, id: 'u1', name: 'Owner' } } },
  'GET /api/family/members': { body: MEMBERS },
  'GET /api/kid': { body: KID },
})
const last = { id: 'f', type: 'formula', started_at: '2026-11-08T08:00:00Z', duration_min: null, quantity_ml: 60, note: '', fed_by_user_id: 'u2', fed_by_name: 'Mom', created_by: 'u2' } as const

afterEach(() => vi.useRealTimers())

test('bottle type shows the amount stepper and breast type shows duration', async () => {
  mockApi(api())
  renderApp(<FeedSheet last={last} saving={false} failed={false} onSave={() => {}} onClose={() => {}} />)
  expect(screen.getByLabelText(en.home.amount)).toHaveTextContent('60')
  expect(screen.queryByLabelText(en.home.duration)).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /Amount \+10 ml|\+10 ml/ }))
  expect(screen.getByLabelText(en.home.amount)).toHaveTextContent('70')
  await userEvent.click(screen.getByRole('radio', { name: en.feedTypes.breast_both }))
  expect(screen.queryByLabelText(en.home.amount)).not.toBeInTheDocument()
  expect(screen.getByLabelText(en.home.duration)).toBeInTheDocument()
})

test('fed by defaults to me and can change', async () => {
  mockApi(api())
  const onSave = vi.fn()
  renderApp(<FeedSheet last={last} saving={false} failed={false} onSave={onSave} onClose={() => {}} />)
  expect(await screen.findByRole('button', { name: 'Owner', pressed: true })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Mom' }))
  expect(screen.getByRole('button', { name: 'Mom', pressed: true })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: en.home.saveFeed }))
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ type: 'formula', quantity_ml: 60, fed_by_user_id: 'u2' }))
})

test('saving as myself sends no fed_by_user_id', async () => {
  mockApi(api())
  const onSave = vi.fn()
  renderApp(<FeedSheet last={last} saving={false} failed={false} onSave={onSave} onClose={() => {}} />)
  await screen.findByRole('button', { name: 'Owner', pressed: true })
  await userEvent.click(screen.getByRole('button', { name: en.home.saveFeed }))
  expect(onSave.mock.calls[0]![0]).not.toHaveProperty('fed_by_user_id')
})

test('footer says when the next feed is due', async () => {
  mockApi(api())
  renderApp(<FeedSheet last={null} saving={false} failed={false} onSave={() => {}} onClose={() => {}} />)
  expect(await screen.findByText(/Next feed due about .* \(every 3h\)/)).toBeInTheDocument()
})

test('the next-feed hint counts from the end of a breastfeed', async () => {
  mockApi(api())
  renderApp(<FeedSheet last={null} saving={false} failed={false} onSave={() => {}} onClose={() => {}} />)
  const hint = async () => (await screen.findByText(/Next feed due about/)).textContent!
  await userEvent.click(screen.getByRole('radio', { name: en.feedTypes.breast_left }))
  const before = await hint()
  await userEvent.type(screen.getByLabelText(en.home.duration), '60')
  await waitFor(async () => expect(await hint()).not.toBe(before)) // an hour of feeding pushes the due time an hour later
})

// --- the timer lives on the server -----------------------------------------------------------------------------------

const SUMMARY = (timer: object | null) => ({
  last_feed: null, next_feed_due_at: null, last_diaper: null, feeds_today: 0, diapers_today: { wet: 0, dirty: 0, both: 0 },
  sleep: { open: null, last: null }, feed_timer: timer,
})
const running = (minsAgo: number, over: object = {}) => ({ id: 'tm1', type: 'breast_left', started_at: new Date(Date.now() - minsAgo * 60_000 - 5_000).toISOString(), ended_at: null, started_by_name: 'Mom', ...over })
/** The summary answers with whatever `state.timer` is now, like the server, so a started or stopped timer shows after the refetch. */
const timerApi = (state: { timer: object | null }) => ({
  ...api(),
  'GET /api/summary': () => ({ body: SUMMARY(state.timer) }),
  'POST /api/feed-timer': (b: unknown) => { state.timer = { ...(b as object), ended_at: null, started_by_name: 'Owner' }; return { status: 201, body: state.timer } },
  'PATCH /api/feed-timer': (b: unknown) => {
    // like the server: a pause starts a break, resuming ends it
    const { paused, ...rest } = b as { paused?: boolean }
    state.timer = { ...(state.timer as object), ...rest, ...(paused === undefined ? {} : { paused_at: paused ? new Date().toISOString() : null }) }
    return { body: state.timer }
  },
  'DELETE /api/feed-timer': () => { state.timer = null; return { body: { ok: true } } },
})
const sheet = (onSave = vi.fn()) => renderApp(<FeedSheet last={null} saving={false} failed={false} onSave={onSave} onClose={() => {}} />)

test('Start timer starts it on the server, with the chosen type and the moment it was tapped', async () => {
  const state = { timer: null as object | null }
  const calls = mockApi(timerApi(state))
  sheet()
  await userEvent.click(screen.getByRole('radio', { name: en.feedTypes.breast_right }))
  await userEvent.click(await screen.findByRole('button', { name: en.home.timerStart }))
  await waitFor(() => expect(calls.find((c) => c.key === 'POST /api/feed-timer')).toBeTruthy())
  const body = calls.find((c) => c.key === 'POST /api/feed-timer')!.body as { id: string; type: string; started_at: string }
  expect(body.type).toBe('breast_right')
  expect(body.id).toMatch(/^[0-9a-f-]{36}$/)
  expect(Math.abs(Date.parse(body.started_at) - Date.now())).toBeLessThan(5_000)
  expect(await screen.findByRole('button', { name: new RegExp(en.home.timerStop) })).toBeInTheDocument() // now running, from the server's copy
})

test('a timer already running (started on another phone, or before a refresh) picks up where it was', async () => {
  const state = { timer: running(7) }
  mockApi(timerApi(state))
  sheet()
  expect(await screen.findByRole('button', { name: new RegExp(`${en.home.timerStop} · 7:0`) })).toBeInTheDocument()
  expect(screen.getByLabelText(en.home.duration)).toHaveValue(7) // and the duration follows it
  expect(screen.getByRole('radio', { name: en.feedTypes.breast_left })).toBeChecked() // the type it was started with
})

test('Stop timer stops it on the server and keeps the time; Resume carries on', async () => {
  const state = { timer: running(7) }
  const calls = mockApi(timerApi(state))
  sheet()
  await userEvent.click(await screen.findByRole('button', { name: new RegExp(en.home.timerStop) }))
  await waitFor(() => expect(calls.find((c) => c.key === 'PATCH /api/feed-timer')?.body).toMatchObject({ ended_at: expect.any(String) }))
  expect(await screen.findByRole('button', { name: new RegExp(en.home.timerResume) })).toBeInTheDocument()
  expect(screen.getByLabelText(en.home.duration)).toHaveValue(7)
  await userEvent.click(screen.getByRole('button', { name: new RegExp(en.home.timerResume) }))
  await waitFor(() => expect(calls.filter((c) => c.key === 'PATCH /api/feed-timer').at(-1)?.body).toEqual({ ended_at: null }))
})

test('changing the type while timing tells the server', async () => {
  const state = { timer: running(2) }
  const calls = mockApi(timerApi(state))
  sheet()
  await screen.findByRole('button', { name: new RegExp(en.home.timerStop) })
  await userEvent.click(screen.getByRole('radio', { name: en.feedTypes.breast_both }))
  await waitFor(() => expect(calls.find((c) => c.key === 'PATCH /api/feed-timer')?.body).toEqual({ type: 'breast_both' }))
})

test('saving while it runs logs the feed from when the timer began and names the timer, so the server ends it', async () => {
  const state = { timer: running(7) }
  mockApi(timerApi(state))
  const onSave = vi.fn()
  sheet(onSave)
  await screen.findByRole('button', { name: new RegExp(en.home.timerStop) })
  await userEvent.click(screen.getByRole('button', { name: en.home.saveFeed }))
  const saved = onSave.mock.calls[0]![0]
  expect(saved).toMatchObject({ type: 'breast_left', timer_id: 'tm1', duration_min: 7 })
  expect(saved.started_at).toBe((state.timer as { started_at: string }).started_at)
})

test('Discard timer throws it away on the server', async () => {
  const state = { timer: running(3) }
  const calls = mockApi(timerApi(state))
  sheet()
  await userEvent.click(await screen.findByRole('button', { name: en.home.timerDiscard }))
  await waitFor(() => expect(calls.some((c) => c.key === 'DELETE /api/feed-timer')).toBe(true))
  expect(await screen.findByRole('button', { name: en.home.timerStart })).toBeInTheDocument()
})

test('a running timer shows its own start in Time, and Discard keeps that start for a typed duration', async () => {
  const state = { timer: running(33) }
  mockApi(timerApi(state))
  const onSave = vi.fn()
  sheet(onSave)
  const started = new Date((state.timer as { started_at: string }).started_at)
  await screen.findByRole('button', { name: new RegExp(en.home.timerStop) })
  expect(screen.getByRole('button', { name: en.home.time })).toHaveTextContent(formatTime(started))
  await userEvent.click(screen.getByRole('button', { name: en.home.timerDiscard }))
  await screen.findByRole('button', { name: en.home.timerStart })
  expect(screen.getByRole('button', { name: en.home.time })).toHaveTextContent(formatTime(started))
  await userEvent.clear(screen.getByLabelText(en.home.duration))
  await userEvent.type(screen.getByLabelText(en.home.duration), '25')
  await userEvent.click(screen.getByRole('button', { name: en.home.saveFeed }))
  const saved = onSave.mock.calls[0]![0]
  expect(saved).toMatchObject({ type: 'breast_left', duration_min: 25 })
  expect(saved).not.toHaveProperty('timer_id')
  // the start is the timer's, to the minute, not the moment of saving
  expect(Math.abs(Date.parse(saved.started_at) - started.getTime())).toBeLessThan(60_000)
})

test('closing the sheet leaves the timer running', async () => {
  const state = { timer: running(3) }
  const calls = mockApi(timerApi(state))
  const onClose = vi.fn()
  renderApp(<FeedSheet last={null} saving={false} failed={false} onSave={() => {}} onClose={onClose} />)
  await screen.findByRole('button', { name: new RegExp(en.home.timerStop) })
  await userEvent.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalled()
  expect(calls.some((c) => c.key === 'DELETE /api/feed-timer')).toBe(false)
})

test('if the timer cannot be started it says so', async () => {
  mockApi({ ...timerApi({ timer: null }), 'POST /api/feed-timer': { status: 500, body: {} } })
  sheet()
  await userEvent.click(await screen.findByRole('button', { name: en.home.timerStart }))
  expect(await screen.findByText(en.home.timerFailed)).toBeInTheDocument()
})

// --- who fed: breast is always mom -----------------------------------------------------------------------------------

const FAMILY = [
  { user_id: 'u1', email: 'owner@x.com', name: 'Owner', role: 'admin', relation: 'dad', pending: false },
  { user_id: 'u2', email: 'mom@x.com', name: 'Pankhuri', role: 'admin', relation: 'mom', pending: false },
  { user_id: 'u3', email: 'nanny@x.com', name: 'Nanny', role: 'caregiver', relation: 'nanny', pending: false },
  { user_id: 'u4', email: 'aunt@x.com', name: 'Aunt', role: 'viewer', relation: null, pending: false },
]
const familyApi = () => ({ ...api(), 'GET /api/family/members': { body: FAMILY } })

test('a breast feed says it is fed by mom and offers no other choice', async () => {
  mockApi(familyApi())
  const onSave = vi.fn()
  renderApp(<FeedSheet last={null} saving={false} failed={false} onSave={onSave} onClose={() => {}} />)
  await userEvent.click(screen.getByRole('radio', { name: en.feedTypes.breast_left }))
  expect(await screen.findByText(en.feed.fedByMom.replace('{{name}}', 'Pankhuri'))).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Nanny' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: en.home.saveFeed }))
  expect(onSave.mock.calls[0]![0]).not.toHaveProperty('fed_by_user_id')
})

test('a bottle feed can be given by any admin or caregiver, never a viewer', async () => {
  mockApi(familyApi())
  const onSave = vi.fn()
  renderApp(<FeedSheet last={last} saving={false} failed={false} onSave={onSave} onClose={() => {}} />)
  expect(await screen.findByRole('button', { name: 'Nanny' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Pankhuri' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Aunt' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Nanny' }))
  await userEvent.click(screen.getByRole('button', { name: en.home.saveFeed }))
  expect(onSave.mock.calls[0]![0]).toMatchObject({ fed_by_user_id: 'u3' })
})

test('without a mom set, a breast feed still shows who is logging it', async () => {
  mockApi({ ...api(), 'GET /api/family/members': { body: FAMILY.map((m) => ({ ...m, relation: m.relation === 'mom' ? null : m.relation })) } })
  renderApp(<FeedSheet last={null} saving={false} failed={false} onSave={() => {}} onClose={() => {}} />)
  await userEvent.click(screen.getByRole('radio', { name: en.feedTypes.breast_left }))
  expect(await screen.findByRole('button', { name: 'Owner', pressed: true })).toBeInTheDocument()
})

// --- the type picker is grouped -----------------------------------------------------------------------------------

test('feed types are grouped: Mom\'s feed with L, R and Both, then Expressed milk and Formula', async () => {
  mockApi(api())
  renderApp(<FeedSheet last={null} saving={false} failed={false} onSave={() => {}} onClose={() => {}} />)
  const mom = screen.getByRole('group', { name: en.feed.momGroup })
  const radios = within(mom).getAllByRole('radio')
  expect(radios.map((r) => r.parentElement!.textContent)).toEqual(['L', 'R', 'Both'])
  // the full wording is what a screen reader hears
  expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual([en.feedTypes.breast_left, en.feedTypes.breast_right, en.feedTypes.breast_both])
  const bottle = screen.getByRole('group', { name: en.feed.bottleGroup })
  expect(within(bottle).getAllByRole('radio').map((r) => r.parentElement!.textContent)).toEqual([en.feedTypes.expressed, en.feedTypes.formula])
})

test('only one type can be chosen across both groups', async () => {
  mockApi(api())
  renderApp(<FeedSheet last={null} saving={false} failed={false} onSave={() => {}} onClose={() => {}} />)
  await userEvent.click(screen.getByRole('radio', { name: en.feedTypes.breast_right }))
  expect(screen.getByRole('radio', { name: en.feedTypes.breast_right })).toBeChecked()
  await userEvent.click(screen.getByRole('radio', { name: en.feedTypes.expressed }))
  expect(screen.getByRole('radio', { name: en.feedTypes.expressed })).toBeChecked()
  expect(screen.getByRole('radio', { name: en.feedTypes.breast_right })).not.toBeChecked()
})

// --- pausing, and breaks asked once at the end -------------------------------------------------------------------------

const stoppedTimer = (wallMin: number, over: object = {}) => {
  const started = Date.now() - (wallMin + 5) * 60_000
  return { id: 'tm1', type: 'breast_left', started_at: new Date(started).toISOString(), ended_at: new Date(started + wallMin * 60_000).toISOString(), paused_at: null, paused_total_s: 0, started_by_name: 'Mom', ...over }
}
const chipsOf = () => within(screen.getByRole('group', { name: en.feed.breaksTitle }))
const breakChip = (min: number) => chipsOf().getByRole('button', { name: en.feed.breaksMin.replace('{{n}}', String(min)) })

test('Pause pauses it on the server, and Resume (while paused) ends the break', async () => {
  const state: { timer: object | null } = { timer: running(10, { paused_at: null, paused_total_s: 0 }) }
  const calls = mockApi(timerApi(state))
  sheet()
  await userEvent.click(await screen.findByRole('button', { name: en.home.timerPause }))
  await waitFor(() => expect(calls.find((c) => c.key === 'PATCH /api/feed-timer')?.body).toEqual({ paused: true }))
  await userEvent.click(await screen.findByRole('button', { name: new RegExp(en.home.timerResume) }))
  await waitFor(() => expect(calls.filter((c) => c.key === 'PATCH /api/feed-timer').at(-1)?.body).toEqual({ paused: false }))
})

test('while paused the clock is frozen and the breaks are not counted as feeding', async () => {
  // 10 minutes ago it started, 2 minutes of breaks are done and a break began 3 minutes ago: 5 minutes of feeding
  const state = { timer: running(10, { paused_total_s: 120, paused_at: new Date(Date.now() - 3 * 60_000).toISOString() }) }
  mockApi(timerApi(state))
  sheet()
  expect(await screen.findByRole('button', { name: new RegExp(`${en.home.timerResume} · 5:0`) })).toBeInTheDocument()
  expect(screen.getByLabelText(en.home.duration)).toHaveValue(5)
})

test('after Stop the breaks are asked once: None is chosen and the feed is the whole time on the clock', async () => {
  mockApi(timerApi({ timer: stoppedTimer(40) }))
  const onSave = vi.fn()
  sheet(onSave)
  expect(await screen.findByText(en.feed.onClock.replace('{{n}}', '40'))).toBeInTheDocument()
  expect(chipsOf().getByRole('button', { name: en.feed.breaksNone, pressed: true })).toBeInTheDocument()
  expect(screen.getByLabelText(en.home.duration)).toHaveValue(40)
  await userEvent.click(screen.getByRole('button', { name: en.home.saveFeed }))
  expect(onSave.mock.calls[0]![0]).toMatchObject({ duration_min: 40, break_min: 0, timer_id: 'tm1' })
})

test('choosing breaks takes them off the feeding time and saves them with the feed', async () => {
  mockApi(timerApi({ timer: stoppedTimer(50) }))
  const onSave = vi.fn()
  sheet(onSave)
  await userEvent.click(await screen.findByText(en.feed.onClock.replace('{{n}}', '50')).then(() => breakChip(15)))
  expect(screen.getByText(en.feed.feedingTime.replace('{{n}}', '35'))).toBeInTheDocument()
  expect(screen.getByLabelText(en.home.duration)).toHaveValue(35)
  await userEvent.click(screen.getByRole('button', { name: en.home.saveFeed }))
  expect(onSave.mock.calls[0]![0]).toMatchObject({ duration_min: 35, break_min: 15 })
})

test('Other takes any number of minutes, and a break longer than the feed cannot be chosen', async () => {
  mockApi(timerApi({ timer: stoppedTimer(12) }))
  const onSave = vi.fn()
  sheet(onSave)
  await screen.findByText(en.feed.onClock.replace('{{n}}', '12'))
  expect(breakChip(15)).toBeDisabled()
  expect(breakChip(20)).toBeDisabled()
  expect(breakChip(10)).toBeEnabled()
  await userEvent.click(chipsOf().getByRole('button', { name: en.feed.breaksOther }))
  await userEvent.type(screen.getByLabelText(en.feed.breaksOtherLabel), '4')
  expect(screen.getByLabelText(en.home.duration)).toHaveValue(8)
  await userEvent.click(screen.getByRole('button', { name: en.home.saveFeed }))
  expect(onSave.mock.calls[0]![0]).toMatchObject({ duration_min: 8, break_min: 4 })
})

test('breaks someone paused for are already chosen when the question comes', async () => {
  mockApi(timerApi({ timer: stoppedTimer(45, { paused_total_s: 600 }) }))
  const onSave = vi.fn()
  sheet(onSave)
  await screen.findByText(en.feed.onClock.replace('{{n}}', '45'))
  expect(breakChip(10)).toHaveAttribute('aria-pressed', 'true')
  await userEvent.click(screen.getByRole('button', { name: en.home.saveFeed }))
  expect(onSave.mock.calls[0]![0]).toMatchObject({ duration_min: 35, break_min: 10 })
})

test('saving while it still runs keeps the recorded breaks out of the feeding time', async () => {
  mockApi(timerApi({ timer: running(20, { paused_total_s: 300, paused_at: null }) }))
  const onSave = vi.fn()
  sheet(onSave)
  await screen.findByRole('button', { name: new RegExp(en.home.timerStop) })
  await userEvent.click(screen.getByRole('button', { name: en.home.saveFeed }))
  expect(onSave.mock.calls[0]![0]).toMatchObject({ duration_min: 15, break_min: 5, timer_id: 'tm1' })
})

test('the breaks question only appears once the timer is stopped', async () => {
  mockApi(timerApi({ timer: running(10) }))
  sheet()
  await screen.findByRole('button', { name: new RegExp(en.home.timerStop) })
  expect(screen.queryByRole('group', { name: en.feed.breaksTitle })).not.toBeInTheDocument()
})
