import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import en from '../i18n/en.json'
import { toLocalInput } from '../lib/time'
import { ME_ADMIN, ME_VIEWER, mockApi, renderApp } from '../test/utils'
import Home from './Home'

const today = (h: number, m = 0) => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m) }
const yest = (h: number, m = 0) => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, h, m) }
const D = [
  { id: 'd1', kind: 'wet', at: today(0, 20).toISOString(), note: '', changed_by_name: 'Mom' },
  { id: 'd2', kind: 'dirty', at: today(0, 5).toISOString(), note: 'a lot', changed_by_name: 'Dad' },
  { id: 'd3', kind: 'both', at: today(0, 2).toISOString(), note: '', changed_by_name: 'Nani' },
  { id: 'd4', kind: 'wet', at: yest(22, 0).toISOString(), note: '', changed_by_name: 'Mom' },
]
const api = (me: object = ME_ADMIN, extra: object = {}) => ({
  'GET /api/me': { body: me },
  'GET /api/summary': { status: 500 },
  'GET /api/diapers': { body: D },
  'POST /api/diapers': (b: unknown) => ({ status: 201, body: { ...(b as object), changed_by_name: 'Owner', recent_other: null } }),
  'PATCH /api/diapers/d1': (b: unknown) => ({ body: { ...D[0], ...(b as object) } }),
  'DELETE /api/diapers/d1': { body: { ok: true } },
  'GET /api/timeline': { body: { items: [{ kind: 'diaper', id: 'd1', at: D[0]!.at, data: D[0] }] } },
  ...extra,
})
const near = (iso: unknown, when: Date) => Math.abs(Date.parse(String(iso)) - when.getTime()) < 90_000
const rangeCalls = (calls: { key: string; url: string }[]) => calls.filter((c) => c.key === 'GET /api/diapers').map((c) => new URL(c.url, 'http://x'))

test('the day lists its diapers newest first with 12-hour times and counts by kind', async () => {
  mockApi(api())
  renderApp(<App />, '/diapers')
  expect(await screen.findByRole('heading', { name: en.diapers.title })).toBeInTheDocument()
  const list = await screen.findByRole('list', { name: en.diapers.listLabel })
  const rows = await within(list).findAllByRole('listitem')
  expect(rows).toHaveLength(3) // yesterday's is not on this day
  expect(rows[0]).toHaveTextContent(en.diaperKinds.wet)
  expect(rows[2]).toHaveTextContent(en.diaperKinds.both)
  expect(within(list).getAllByText(/AM|PM/).length).toBeGreaterThanOrEqual(3)
  const counts = screen.getByTestId('diaper-counts')
  expect(counts).toHaveTextContent('3') // total
  expect(within(counts).getByText(en.diaperKinds.dirty).parentElement).toHaveTextContent('1')
})

test('an empty day says so', async () => {
  mockApi(api(ME_ADMIN, { 'GET /api/diapers': { body: [] } }))
  renderApp(<App />, '/diapers')
  expect(await screen.findByText(en.diapers.none)).toBeInTheDocument()
})

test('previous day fetches the earlier range, and there is no day after today', async () => {
  const calls = mockApi(api())
  renderApp(<App />, '/diapers')
  await screen.findByRole('list', { name: en.diapers.listLabel })
  expect(screen.getByRole('button', { name: en.diapers.nextDay })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: en.diapers.prevDay }))
  const yesterday = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - 1).toISOString()
  await waitFor(() => expect(rangeCalls(calls).map((u) => u.searchParams.get('from'))).toContain(yesterday))
  expect(await within(screen.getByRole('list', { name: en.diapers.listLabel })).findAllByRole('listitem')).toHaveLength(1)
  expect(screen.getByRole('button', { name: en.diapers.nextDay })).toBeEnabled()
})

test('adding a past diaper posts its kind, time and note', async () => {
  const calls = mockApi(api())
  renderApp(<App />, '/diapers')
  await userEvent.click(await screen.findByRole('button', { name: en.diapers.addPast }))
  const form = await screen.findByRole('dialog', { name: en.diapers.addTitle })
  await userEvent.click(within(form).getByRole('button', { name: en.diaperKinds.dirty, pressed: false }))
  const when = yest(14, 30)
  fireEvent.change(within(form).getByLabelText(en.diapers.form.when), { target: { value: toLocalInput(when) } })
  await userEvent.type(within(form).getByLabelText(en.diapers.form.note), 'leaked')
  await userEvent.click(within(form).getByRole('button', { name: en.diapers.form.save }))
  await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/diapers')).toBe(true))
  const body = calls.find((c) => c.key === 'POST /api/diapers')!.body as Record<string, unknown>
  expect(body).toMatchObject({ kind: 'dirty', note: 'leaked' })
  expect(body.id).toMatch(/^[0-9a-f-]{36}$/)
  expect(near(body.at, when)).toBe(true)
})

test('a time in the future is refused before anything is sent', async () => {
  const calls = mockApi(api())
  renderApp(<App />, '/diapers')
  await userEvent.click(await screen.findByRole('button', { name: en.diapers.addPast }))
  const form = await screen.findByRole('dialog', { name: en.diapers.addTitle })
  fireEvent.change(within(form).getByLabelText(en.diapers.form.when), { target: { value: toLocalInput(new Date(Date.now() + 3 * 3_600_000)) } })
  await userEvent.click(within(form).getByRole('button', { name: en.diapers.form.save }))
  expect(await within(form).findByText(en.diapers.form.future)).toBeInTheDocument()
  expect(calls.some((c) => c.key === 'POST /api/diapers')).toBe(false)
})

test('editing a diaper sends only what changed', async () => {
  const calls = mockApi(api())
  renderApp(<App />, '/timeline?entry=diaper:d1')
  await userEvent.click(await screen.findByRole('button', { name: en.timeline.edit }))
  const form = await screen.findByRole('dialog', { name: en.diapers.editTitle })
  expect(within(form).getByRole('button', { name: en.diaperKinds.wet, pressed: true })).toBeInTheDocument()
  expect(within(form).getByLabelText(en.diapers.form.when)).toHaveValue(toLocalInput(new Date(D[0]!.at)))
  await userEvent.click(within(form).getByRole('button', { name: en.diaperKinds.both }))
  await userEvent.click(within(form).getByRole('button', { name: en.diapers.form.save }))
  await waitFor(() => expect(calls.some((c) => c.key === 'PATCH /api/diapers/d1')).toBe(true))
  expect(calls.find((c) => c.key === 'PATCH /api/diapers/d1')!.body).toEqual({ kind: 'both' })
})

test('a new time is sent when it was changed', async () => {
  const calls = mockApi(api())
  renderApp(<App />, '/timeline?entry=diaper:d1')
  await userEvent.click(await screen.findByRole('button', { name: en.timeline.edit }))
  const form = await screen.findByRole('dialog', { name: en.diapers.editTitle })
  const when = today(0, 10)
  fireEvent.change(within(form).getByLabelText(en.diapers.form.when), { target: { value: toLocalInput(when) } })
  await userEvent.click(within(form).getByRole('button', { name: en.diapers.form.save }))
  await waitFor(() => expect(calls.some((c) => c.key === 'PATCH /api/diapers/d1')).toBe(true))
  expect(near((calls.find((c) => c.key === 'PATCH /api/diapers/d1')!.body as { at: string }).at, when)).toBe(true)
})

test('diapers on the day open in the timeline to be fixed or deleted, and a viewer cannot', async () => {
  mockApi(api())
  const admin = renderApp(<App />, '/diapers')
  const links = await screen.findAllByRole('link', { name: en.timeline.edit })
  expect(links[0]).toHaveAttribute('href', expect.stringMatching(/^\/timeline\?day=\d{4}-\d{2}-\d{2}&entry=diaper:d1$/))
  for (const name of [en.diapers.edit, en.diapers.delete]) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
  admin.unmount()
  mockApi(api(ME_VIEWER))
  renderApp(<App />, '/diapers')
  await screen.findByRole('list', { name: en.diapers.listLabel })
  expect(screen.queryByRole('link', { name: en.timeline.edit })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: en.diapers.addPast })).not.toBeInTheDocument()
})

test('the diaper card on Home opens the diaper day screen', async () => {
  mockApi({ 'GET /api/me': { body: ME_ADMIN }, 'GET /api/summary': { body: { last_feed: null, next_feed_due_at: null, last_diaper: { id: 'd', kind: 'wet', at: new Date().toISOString(), changed_by_name: 'Mom' }, feeds_today: 0, diapers_today: { wet: 1, dirty: 0, both: 0 }, sleep: { open: null, last: null } } } })
  renderApp(<Home />)
  expect(await screen.findByRole('link', { name: new RegExp(en.home.lastDiaperLabel) })).toHaveAttribute('href', '/diapers')
})

test('the diapers screen shows the week and asks for seven days of diapers', async () => {
  const calls = mockApi(api())
  renderApp(<App />, '/diapers')
  expect(await screen.findByRole('img', { name: en.diapers.weekLabel })).toBeInTheDocument()
  const froms = rangeCalls(calls).map((u) => new Date(u.searchParams.get('from')!).getTime())
  const sixDaysAgo = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - 6).getTime()
  expect(froms).toContain(sixDaysAgo)
})


// --- who changed it ---------------------------------------------------------------------------------------------------

const PEOPLE = [
  { user_id: 'u1', email: 'owner@x.com', name: 'Owner', role: 'admin', relation: 'dad', pending: false },
  { user_id: 'u3', email: 'nanny@x.com', name: 'Nanny', role: 'caregiver', relation: 'nanny', pending: false },
  { user_id: 'u4', email: 'aunt@x.com', name: 'Aunt', role: 'viewer', relation: null, pending: false },
]
const withPeople = (extra: object = {}) => api(ME_ADMIN, { 'GET /api/family/members': { body: PEOPLE }, ...extra })

test('adding a past diaper can name who changed it', async () => {
  const calls = mockApi(withPeople())
  renderApp(<App />, '/diapers')
  await userEvent.click(await screen.findByRole('button', { name: en.diapers.addPast }))
  const form = await screen.findByRole('dialog', { name: en.diapers.addTitle })
  expect(await within(form).findByRole('button', { name: 'Owner', pressed: true })).toBeInTheDocument()
  expect(within(form).queryByRole('button', { name: 'Aunt' })).not.toBeInTheDocument()
  await userEvent.click(within(form).getByRole('button', { name: 'Nanny' }))
  await userEvent.click(within(form).getByRole('button', { name: en.diapers.form.save }))
  await waitFor(() => expect(calls.find((c) => c.key === 'POST /api/diapers')?.body).toMatchObject({ changed_by_user_id: 'u3' }))
})

test('editing a diaper shows who changed it and sends a new person only when picked', async () => {
  const calls = mockApi(
    withPeople({
      'GET /api/timeline': { body: { items: [{ kind: 'diaper', id: 'd1', at: D[0]!.at, data: { ...D[0], changed_by_user_id: 'u3' } }] } },
    }),
  )
  renderApp(<App />, '/timeline?entry=diaper:d1')
  await userEvent.click(await screen.findByRole('button', { name: en.timeline.edit }))
  const form = await screen.findByRole('dialog', { name: en.diapers.editTitle })
  expect(await within(form).findByRole('button', { name: 'Nanny', pressed: true })).toBeInTheDocument()
  await userEvent.click(within(form).getByRole('button', { name: 'Owner' }))
  await userEvent.click(within(form).getByRole('button', { name: en.diapers.form.save }))
  await waitFor(() => expect(calls.find((c) => c.key === 'PATCH /api/diapers/d1')?.body).toEqual({ changed_by_user_id: 'u1' }))
})
