import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import en from '../i18n/en.json'
import { toLocalInput } from '../lib/time'
import { ME_ADMIN, ME_VIEWER, mockApi, renderApp } from '../test/utils'
import Home from './Home'

const today = (h: number, m = 0) => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m) }
const yest = (h: number, m = 0) => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, h, m) }
const SLEEPS = [
  { id: 's1', started_at: yest(23, 0).toISOString(), ended_at: today(1, 0).toISOString(), started_by_name: 'Mom', ended_by_name: 'Mom', duration_min: 120, note: '' },
  { id: 's2', started_at: yest(14, 0).toISOString(), ended_at: yest(15, 0).toISOString(), started_by_name: 'Dad', ended_by_name: 'Dad', duration_min: 60, note: '' },
]
const api = (me: object = ME_ADMIN, extra: object = {}) => ({
  'GET /api/me': { body: me },
  'GET /api/summary': { status: 500 },
  'GET /api/sleep': { body: SLEEPS },
  'POST /api/sleep/past': (b: unknown) => ({ status: 201, body: { ...(b as object), started_by_name: 'Owner', ended_by_name: 'Owner', duration_min: 60 } }),
  'PATCH /api/sleep/s1': (b: unknown) => ({ body: { ...SLEEPS[0], ...(b as object) } }),
  'DELETE /api/sleep/s1': { body: { ok: true } },
  'GET /api/timeline': { body: { items: [{ kind: 'sleep', id: 's1', at: SLEEPS[0]!.started_at, data: SLEEPS[0] }] } },
  ...extra,
})
const sleepCalls = (calls: { key: string; url: string }[]) => calls.filter((c) => c.key === 'GET /api/sleep').map((c) => new URL(c.url, 'http://x'))
const near = (iso: unknown, when: Date) => Math.abs(Date.parse(String(iso)) - when.getTime()) < 90_000

test('the day screen shows a donut of sleep and awake with the totals', async () => {
  mockApi(api())
  renderApp(<App />, '/sleep')
  expect(await screen.findByRole('heading', { name: en.sleep.dayTitle })).toBeInTheDocument()
  const donut = await screen.findByRole('img', { name: /Slept 1h 0m/ })
  expect(donut).toBeInTheDocument()
  expect(screen.getByText(en.sleep.legendSleep)).toBeInTheDocument()
  expect(screen.getByText(en.sleep.legendAwake)).toBeInTheDocument()
})

test('the day lists its sleeps with 12-hour times', async () => {
  mockApi(api())
  renderApp(<App />, '/sleep')
  const list = await screen.findByRole('list', { name: en.sleep.listLabel })
  expect(await within(list).findAllByRole('listitem')).toHaveLength(1) // only the one that reaches into today
  expect(within(list).getByText(/AM|PM/)).toBeInTheDocument()
  expect(within(list).getByText(/Mom/)).toBeInTheDocument()
})

test('previous day fetches the earlier range and shows that day', async () => {
  const calls = mockApi(api())
  renderApp(<App />, '/sleep')
  await screen.findByRole('img', { name: /Slept/ })
  await userEvent.click(screen.getByRole('button', { name: en.sleep.prevDay }))
  await waitFor(() => expect(new Set(sleepCalls(calls).map((u) => u.searchParams.get('from'))).size).toBe(2))
  expect(await screen.findByRole('img', { name: /Slept 2h 0m/ })).toBeInTheDocument() // 14:00-15:00 and 23:00-24:00
  expect(screen.getByRole('button', { name: en.sleep.nextDay })).toBeEnabled()
})

test('there is no next day after today', async () => {
  mockApi(api())
  renderApp(<App />, '/sleep')
  await screen.findByRole('img', { name: /Slept/ })
  expect(screen.getByRole('button', { name: en.sleep.nextDay })).toBeDisabled()
})

test('adding a past sleep posts its start and end', async () => {
  const calls = mockApi(api())
  renderApp(<App />, '/sleep')
  await userEvent.click(await screen.findByRole('button', { name: en.sleep.addPast }))
  const form = await screen.findByRole('dialog', { name: en.sleep.addTitle })
  const start = today(3, 0) < new Date() ? today(3, 0) : yest(3, 0)
  const end = new Date(start.getTime() + 90 * 60_000)
  fireEvent.change(within(form).getByLabelText(en.sleep.form.start), { target: { value: toLocalInput(start) } })
  fireEvent.change(within(form).getByLabelText(en.sleep.form.end), { target: { value: toLocalInput(end) } })
  await userEvent.click(within(form).getByRole('button', { name: en.sleep.form.save }))
  await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/sleep/past')).toBe(true))
  const body = calls.find((c) => c.key === 'POST /api/sleep/past')!.body as Record<string, unknown>
  expect(body.id).toMatch(/^[0-9a-f-]{36}$/)
  expect(near(body.started_at, start) && near(body.ended_at, end)).toBe(true)
})

test('an end before the start is refused before anything is sent', async () => {
  const calls = mockApi(api())
  renderApp(<App />, '/sleep')
  await userEvent.click(await screen.findByRole('button', { name: en.sleep.addPast }))
  const form = await screen.findByRole('dialog', { name: en.sleep.addTitle })
  fireEvent.change(within(form).getByLabelText(en.sleep.form.start), { target: { value: toLocalInput(yest(9)) } })
  fireEvent.change(within(form).getByLabelText(en.sleep.form.end), { target: { value: toLocalInput(yest(8)) } })
  await userEvent.click(within(form).getByRole('button', { name: en.sleep.form.save }))
  expect(await within(form).findByText(en.sleep.form.endBeforeStart)).toBeInTheDocument()
  expect(calls.some((c) => c.key === 'POST /api/sleep/past')).toBe(false)
})

test('an overlap with another sleep is explained', async () => {
  mockApi(api(ME_ADMIN, { 'POST /api/sleep/past': { status: 409, body: { detail: 'overlaps another sleep', overlaps: SLEEPS[0] } } }))
  renderApp(<App />, '/sleep')
  await userEvent.click(await screen.findByRole('button', { name: en.sleep.addPast }))
  const form = await screen.findByRole('dialog', { name: en.sleep.addTitle })
  fireEvent.change(within(form).getByLabelText(en.sleep.form.start), { target: { value: toLocalInput(yest(23, 30)) } })
  fireEvent.change(within(form).getByLabelText(en.sleep.form.end), { target: { value: toLocalInput(today(0, 30)) } })
  await userEvent.click(within(form).getByRole('button', { name: en.sleep.form.save }))
  expect(await within(form).findByText(/overlaps/i)).toBeInTheDocument()
})

test('editing a sleep sends the new times', async () => {
  const calls = mockApi(api())
  renderApp(<App />, '/timeline?entry=sleep:s1')
  await userEvent.click(await screen.findByRole('button', { name: en.timeline.edit }))
  const form = await screen.findByRole('dialog', { name: en.sleep.editTitle })
  expect(within(form).getByLabelText(en.sleep.form.start)).toHaveValue(toLocalInput(yest(23, 0)))
  fireEvent.change(within(form).getByLabelText(en.sleep.form.end), { target: { value: toLocalInput(today(1, 30)) } })
  await userEvent.click(within(form).getByRole('button', { name: en.sleep.form.save }))
  await waitFor(() => expect(calls.some((c) => c.key === 'PATCH /api/sleep/s1')).toBe(true))
  expect(near((calls.find((c) => c.key === 'PATCH /api/sleep/s1')!.body as { ended_at: string }).ended_at, today(1, 30))).toBe(true)
})

test('sleeps on the day open in the timeline to be fixed or deleted, and a viewer cannot', async () => {
  mockApi(api())
  const admin = renderApp(<App />, '/sleep')
  const links = await screen.findAllByRole('link', { name: en.timeline.edit })
  expect(links[0]).toHaveAttribute('href', expect.stringMatching(/^\/timeline\?day=\d{4}-\d{2}-\d{2}&entry=sleep:s1$/))
  for (const name of [en.sleep.edit, en.sleep.delete]) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
  admin.unmount()
  mockApi(api(ME_VIEWER))
  renderApp(<App />, '/sleep')
  await screen.findByRole('img', { name: /Slept/ })
  expect(screen.queryByRole('link', { name: en.timeline.edit })).not.toBeInTheDocument()
})

test('a viewer can look but not add, edit or delete', async () => {
  mockApi(api(ME_VIEWER))
  renderApp(<App />, '/sleep')
  await screen.findByRole('img', { name: /Slept/ })
  for (const name of [en.sleep.addPast, en.sleep.edit, en.sleep.delete]) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
})

test('the sleep card on Home opens the day screen', async () => {
  mockApi({ 'GET /api/me': { body: ME_ADMIN }, 'GET /api/summary': { body: { last_feed: null, next_feed_due_at: null, last_diaper: null, feeds_today: 0, diapers_today: { wet: 0, dirty: 0, both: 0 }, sleep: { open: null, last: null } } } })
  renderApp(<Home />)
  expect(await screen.findByRole('link', { name: new RegExp(en.sleep.title) })).toHaveAttribute('href', '/sleep')
})

// --- editing short sleeps and clearing the wake-up time ----------------------------------------------------------------

const SHORT = { id: 's9', started_at: new Date(today(0, 30).getTime() + 37_000).toISOString(), ended_at: new Date(today(0, 30).getTime() + 40_000).toISOString(), started_by_name: 'Mom', ended_by_name: 'Mom', duration_min: 0, note: '' }
const shortApi = (extra: object = {}) => api(ME_ADMIN, { 'GET /api/sleep': { body: [SHORT] }, 'GET /api/timeline': { body: { items: [{ kind: 'sleep', id: 's9', at: SHORT.started_at, data: SHORT }] } }, 'PATCH /api/sleep/s9': (b: unknown) => ({ body: { ...SHORT, ...(b as object) } }), ...extra })

test('editing only the note of a sleep a few seconds long saves without a time error', async () => {
  const calls = mockApi(shortApi())
  renderApp(<App />, '/timeline?entry=sleep:s9')
  await userEvent.click(await screen.findByRole('button', { name: en.timeline.edit }))
  const form = await screen.findByRole('dialog', { name: en.sleep.editTitle })
  await userEvent.type(within(form).getByLabelText(en.sleep.form.note), 'tap test')
  await userEvent.click(within(form).getByRole('button', { name: en.sleep.form.save }))
  await waitFor(() => expect(calls.some((c) => c.key === 'PATCH /api/sleep/s9')).toBe(true))
  const body = calls.find((c) => c.key === 'PATCH /api/sleep/s9')!.body as Record<string, unknown>
  expect(body).toEqual({ note: 'tap test' }) // untouched times are not rounded to the minute and resent
})

test('emptying Woke up on a finished sleep marks it as still asleep', async () => {
  const calls = mockApi(shortApi())
  renderApp(<App />, '/timeline?entry=sleep:s9')
  await userEvent.click(await screen.findByRole('button', { name: en.timeline.edit }))
  const form = await screen.findByRole('dialog', { name: en.sleep.editTitle })
  fireEvent.change(within(form).getByLabelText(en.sleep.form.end), { target: { value: '' } })
  await userEvent.click(within(form).getByRole('button', { name: en.sleep.form.save }))
  await waitFor(() => expect(calls.some((c) => c.key === 'PATCH /api/sleep/s9')).toBe(true))
  expect(calls.find((c) => c.key === 'PATCH /api/sleep/s9')!.body).toMatchObject({ ended_at: null })
})

test('when another sleep is already going, reopening says so instead of a vague error', async () => {
  mockApi(shortApi({ 'PATCH /api/sleep/s9': { status: 409, body: { detail: 'already asleep', open: { ...SHORT, id: 'other', started_by_name: 'Nanny' } } } }))
  renderApp(<App />, '/timeline?entry=sleep:s9')
  await userEvent.click(await screen.findByRole('button', { name: en.timeline.edit }))
  const form = await screen.findByRole('dialog', { name: en.sleep.editTitle })
  fireEvent.change(within(form).getByLabelText(en.sleep.form.end), { target: { value: '' } })
  await userEvent.click(within(form).getByRole('button', { name: en.sleep.form.save }))
  expect(await within(form).findByText(en.sleep.alreadyAsleep.replace('{{name}}', 'Nanny'))).toBeInTheDocument()
})
