import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import en from '../i18n/en.json'
import { enqueue } from '../offline/queue'
import { ME_ADMIN, ME_VIEWER, mockApi, renderApp } from '../test/utils'
import Timeline from './Timeline'

const at = (h: number, m = 0) => new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), h, m).toISOString()
const ITEMS = [
  { kind: 'feed', id: 'f1', at: at(14, 5), data: { type: 'formula', quantity_ml: 60, duration_min: null, fed_by_name: 'Mom' } },
  { kind: 'diaper', id: 'd1', at: at(13, 10), data: { kind: 'wet', changed_by_name: 'Nani' } },
  { kind: 'sleep', id: 's1', at: at(10, 30), data: { started_at: at(10, 30), ended_at: at(12, 20), duration_min: 110, started_by_name: 'Nanny' } },
  { kind: 'dose', id: 'p1', at: at(9, 20), data: { status: 'given', amount: 0.25, dose_unit: 'ml', medicine_name: 'Vitamin D3', by_name: 'Dad' } },
  { kind: 'vital', id: 'v1', at: at(8, 0), data: { weight_kg: 3.42, place_kind: 'home', place_name: '', temperature_c: null, height_cm: null, head_cm: null, heart_rate: null, resp_rate: null, spo2: null } },
]
const api = (items: object[] = ITEMS, me = ME_ADMIN) => ({ 'GET /api/me': { body: me }, 'GET /api/timeline': { body: { items } } })
const timelineCalls = (calls: { key: string; url: string }[]) => calls.filter((c) => c.key === 'GET /api/timeline').map((c) => new URL(c.url, 'http://x'))

test('rows render newest first with titles and who did it', async () => {
  mockApi(api())
  renderApp(<Timeline />)
  await waitFor(() => expect(screen.getByText(`${en.feedTypes.formula} · 60 ml`).closest('button')).not.toBeNull())
  expect(screen.getByText(en.diaperKinds.wet)).toBeInTheDocument()
  expect(screen.getByText(/Vitamin D3 · 0\.25 ml/)).toBeInTheDocument()
  expect(screen.getByText(/3\.42 kg/)).toBeInTheDocument()
  expect(screen.getByText(/Mom/)).toBeInTheDocument()
  const rows = screen.getAllByRole('listitem')
  expect(rows).toHaveLength(5)
  expect(rows[0]).toHaveTextContent('60 ml')
  expect(rows[4]).toHaveTextContent('3.42')
})

test('filter chips ask the server for just those kinds', async () => {
  const calls = mockApi(api())
  renderApp(<Timeline />)
  await screen.findByText(`${en.feedTypes.formula} · 60 ml`)
  await userEvent.click(screen.getByRole('button', { name: en.timeline.filters.feed }))
  await waitFor(() => expect(timelineCalls(calls).some((u) => u.searchParams.get('kinds') === 'feed')).toBe(true))
  expect(screen.getByRole('button', { name: en.timeline.filters.feed, pressed: true })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: en.timeline.filters.health }))
  await waitFor(() => expect(timelineCalls(calls).some((u) => u.searchParams.get('kinds') === 'vaccine,visit')).toBe(true))
})

test('an empty day says so', async () => {
  mockApi(api([]))
  renderApp(<Timeline />)
  expect(await screen.findByText(en.timeline.empty)).toBeInTheDocument()
})

test('entries waiting to sync show as pending sync', async () => {
  mockApi(api([]))
  await enqueue({ kind: 'feed', id: 'q1', payload: { id: 'q1', type: 'formula', started_at: at(15, 0), quantity_ml: 90 } })
  renderApp(<Timeline />)
  expect(await screen.findByText(`${en.feedTypes.formula} · 90 ml`)).toBeInTheDocument()
  expect(screen.getByText(new RegExp(en.timeline.pendingSync))).toBeInTheDocument()
})

test('show earlier day fetches the previous day', async () => {
  const calls = mockApi(api())
  renderApp(<Timeline />)
  await screen.findByText(`${en.feedTypes.formula} · 60 ml`)
  await userEvent.click(screen.getByRole('button', { name: en.timeline.earlier }))
  await waitFor(() => expect(timelineCalls(calls).length).toBeGreaterThanOrEqual(2))
  const yesterday = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - 1).toISOString()
  await waitFor(() => expect(timelineCalls(calls).map((u) => u.searchParams.get('from'))).toContain(yesterday))
  expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(2)
})

test('a viewer can read the timeline', async () => {
  mockApi(api(ITEMS, ME_VIEWER))
  renderApp(<Timeline />)
  expect(await screen.findByText(`${en.feedTypes.formula} · 60 ml`)).toBeInTheDocument()
})

// --- correcting entries from the timeline -------------------------------------------------------------------------

const tenMinAgo = new Date(Date.now() - 600_000).toISOString()
const SLEEP_FULL = { id: 's1', started_at: at(10, 30), ended_at: at(12, 20), duration_min: 110, started_by_name: 'Nanny', note: '' }
const FULL = [
  { kind: 'feed', id: 'f1', at: tenMinAgo, data: { id: 'f1', type: 'formula', quantity_ml: 60, duration_min: null, fed_by_name: 'Mom', note: '', started_at: tenMinAgo } }, // never in the future, whatever the time of day
  { kind: 'diaper', id: 'd1', at: at(13, 10), data: { id: 'd1', kind: 'wet', at: at(13, 10), changed_by_name: 'Nani', note: '' } },
  { kind: 'sleep', id: 's1', at: at(10, 30), data: SLEEP_FULL },
  { kind: 'dose', id: 'p1', at: at(9, 20), data: { id: 'p1', medicine_id: 'm1', status: 'given', amount: 0.25, dose_unit: 'ml', medicine_name: 'Vitamin D3', by_name: 'Dad', given_at: at(9, 20), scheduled_for: null, note: '' } },
  { kind: 'vital', id: 'v1', at: at(8, 0), data: { id: 'v1', measured_at: at(8, 0), weight_kg: 3.42, place_kind: 'home', place_name: '', measured_by: '', note: '', temperature_c: null, height_cm: null, head_cm: null, heart_rate: null, resp_rate: null, spo2: null } },
]
const MED = { id: 'm1', name: 'Vitamin D3', dose_amount: 0.25, dose_unit: 'ml', schedule_kind: 'fixed', times: ['09:00'], interval_hours: null, first_dose_at: null, min_gap_hours: null, start_date: '2026-11-01', end_date: null, notes: '', ended: false, slots: [], last_dose: null }
const apiFull = (me = ME_ADMIN) => ({
  ...api(FULL, me),
  'GET /api/medicines': { body: [MED] },
  'DELETE /api/sleep/s1': { body: { ok: true } },
  'DELETE /api/diapers/d1': { body: { ok: true } },
  'DELETE /api/feeds/f1': { body: { ok: true } },
  'DELETE /api/vitals/v1': { body: { ok: true } },
  'DELETE /api/medicines/m1/doses/p1': { body: { ok: true } },
  'PATCH /api/feeds/f1': (b: unknown) => ({ body: { ...FULL[0].data, ...(b as object) } }),
})
const open = async (title: string | RegExp) => {
  // rows turn into buttons once we know who is signed in, so wait for that before tapping
  await waitFor(() => expect(screen.getByText(title).closest('button')).not.toBeNull())
  await userEvent.click(screen.getByText(title))
  return screen.findByRole('dialog')
}

test('tapping a row opens it with Edit and Delete', async () => {
  mockApi(apiFull())
  renderApp(<Timeline />)
  const d = await open(en.diaperKinds.wet)
  expect(within(d).getByRole('button', { name: en.timeline.edit })).toBeInTheDocument()
  expect(within(d).getByRole('button', { name: en.timeline.delete })).toBeInTheDocument()
})

test.each([
  ['diaper', en.diaperKinds.wet, 'DELETE /api/diapers/d1'],
  ['sleep', new RegExp(`Slept`), 'DELETE /api/sleep/s1'],
  ['feed', `${en.feedTypes.formula} · 60 ml`, 'DELETE /api/feeds/f1'],
  ['vital', /3\.42 kg/, 'DELETE /api/vitals/v1'],
  ['dose', /Vitamin D3 · 0\.25 ml/, 'DELETE /api/medicines/m1/doses/p1'],
])('deleting a %s needs a second confirm and then calls the server', async (_kind, title, key) => {
  const calls = mockApi(apiFull())
  renderApp(<Timeline />)
  const d = await open(title)
  await userEvent.click(within(d).getByRole('button', { name: en.timeline.delete }))
  expect(calls.some((c) => c.key === key)).toBe(false)
  await userEvent.click(within(d).getByRole('button', { name: en.timeline.confirmDelete }))
  await waitFor(() => expect(calls.some((c) => c.key === key)).toBe(true))
})

test('editing a sleep opens its form with the stored times', async () => {
  mockApi(apiFull())
  renderApp(<Timeline />)
  const d = await open(/Slept/)
  await userEvent.click(within(d).getByRole('button', { name: en.timeline.edit }))
  expect(await screen.findByLabelText(en.sleep.form.start)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: en.sleep.form.end })).toHaveTextContent('12:20 PM')
})

test('editing a diaper opens its form', async () => {
  mockApi(apiFull())
  renderApp(<Timeline />)
  const d = await open(en.diaperKinds.wet)
  await userEvent.click(within(d).getByRole('button', { name: en.timeline.edit }))
  expect(await screen.findByLabelText(en.diapers.form.when)).toBeInTheDocument()
})

test('editing a feed sends only what changed', async () => {
  const calls = mockApi(apiFull())
  renderApp(<Timeline />)
  const d = await open(`${en.feedTypes.formula} · 60 ml`)
  await userEvent.click(within(d).getByRole('button', { name: en.timeline.edit }))
  await userEvent.click(await screen.findByRole('button', { name: /\+10 ml/ }))
  await userEvent.click(screen.getByRole('button', { name: en.timeline.save }))
  await waitFor(() => expect(calls.find((c) => c.key === 'PATCH /api/feeds/f1')?.body).toEqual({ quantity_ml: 70 }))
})

test('editing a vital opens the vitals form', async () => {
  mockApi(apiFull())
  renderApp(<Timeline />)
  const d = await open(/3\.42 kg/)
  await userEvent.click(within(d).getByRole('button', { name: en.timeline.edit }))
  expect(await screen.findByRole('dialog', { name: en.vitals.form.editTitle })).toBeInTheDocument()
})

test('editing a dose opens the dose fixer for admins only', async () => {
  mockApi(apiFull())
  const first = renderApp(<Timeline />)
  const d = await open(/Vitamin D3/)
  await userEvent.click(within(d).getByRole('button', { name: en.timeline.edit }))
  expect(await screen.findByRole('dialog', { name: en.medicines.history.editTitle })).toBeInTheDocument()
  first.unmount()
  mockApi(apiFull({ ...ME_ADMIN, role: 'caregiver' }))
  renderApp(<Timeline />)
  await screen.findByText(en.diaperKinds.wet)
  expect(screen.getByText(/Vitamin D3/).closest('button')).toBeNull()
})

test('viewers and rows waiting to sync cannot be opened', async () => {
  mockApi(apiFull(ME_VIEWER))
  const v = renderApp(<Timeline />)
  await screen.findByText(en.diaperKinds.wet)
  expect(screen.getByText(en.diaperKinds.wet).closest('button')).toBeNull()
  v.unmount()
  await enqueue({ kind: 'diaper', id: 'q1', payload: { id: 'q1', kind: 'dirty', at: at(15, 0) } })
  mockApi(apiFull())
  renderApp(<Timeline />)
  expect((await screen.findByText(en.diaperKinds.dirty)).closest('button')).toBeNull()
})

test('a vaccine or visit points to the Health page instead of editing here', async () => {
  const items = [{ kind: 'visit', id: 'x1', at: at(11, 0), data: { id: 'x1', doctor: 'Dr Rao', reason: 'Check', place: 'Clinic' } }]
  mockApi({ ...api(items), 'GET /api/medicines': { body: [] } })
  renderApp(<Timeline />)
  const d = await open(/Dr Rao/)
  expect(within(d).getByRole('link', { name: en.timeline.openInHealth })).toHaveAttribute('href', '/health?tab=visits')
})

test('Add past entry offers the kinds and opens the matching form', async () => {
  mockApi(apiFull())
  renderApp(<Timeline />)
  await userEvent.click(await screen.findByRole('button', { name: en.timeline.addPast }))
  const picker = await screen.findByRole('dialog', { name: en.timeline.addPast })
  for (const k of ['feed', 'diaper', 'sleep', 'dose', 'vital'] as const) expect(within(picker).getByRole('button', { name: en.timeline.addKind[k] })).toBeInTheDocument()
  await userEvent.click(within(picker).getByRole('button', { name: en.timeline.addKind.diaper }))
  expect(await screen.findByLabelText(en.diapers.form.when)).toBeInTheDocument()
})

test('Add past entry is hidden from viewers', async () => {
  mockApi(apiFull(ME_VIEWER))
  renderApp(<Timeline />)
  await screen.findByText(en.diaperKinds.wet)
  expect(screen.queryByRole('button', { name: en.timeline.addPast })).not.toBeInTheDocument()
})

test('a link with ?entry= opens that entry straight away', async () => {
  mockApi(apiFull())
  renderApp(<Timeline />, '/timeline?entry=diaper:d1')
  expect(await screen.findByRole('dialog')).toHaveTextContent(en.diaperKinds.wet)
})

test('a link with ?day= shows that day', async () => {
  const calls = mockApi(apiFull())
  renderApp(<Timeline />, '/timeline?day=2026-10-01&entry=diaper:d1')
  await waitFor(() => expect(timelineCalls(calls).some((u) => new Date(u.searchParams.get('from')!).getMonth() === 9)).toBe(true))
})
