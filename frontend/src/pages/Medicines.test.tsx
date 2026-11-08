import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import en from '../i18n/en.json'
import { formatClock } from '../lib/time'
import { enqueue } from '../offline/queue'
import { ME_ADMIN, ME_VIEWER, mockApi, renderApp } from '../test/utils'
import Home from './Home'
import Settings from './Settings'

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
const minsFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString()
const text = (key: string, vars: Record<string, string>) => Object.entries(vars).reduce((s, [k, v]) => s.replace(`{{${k}}}`, v), key)

const slot = (over: object = {}) => ({ due_at: minsAgo(20), status: 'pending', dose_id: null, given_at: null, by_name: null, ...over })
const med = (over: object = {}) => ({
  id: 'm1', name: 'Vitamin D', dose_amount: 5, dose_unit: 'drops', schedule_kind: 'fixed', times: ['09:00'], interval_hours: null, first_dose_at: null,
  min_gap_hours: null, start_date: '2026-11-01', end_date: null, notes: '', ended: false, slots: [slot()], last_dose: null, ...over,
})
const asNeeded = (lastGivenMinsAgo: number | null, over: object = {}) =>
  med({
    id: 'm2', name: 'Paracetamol', dose_amount: 1.5, dose_unit: 'ml', schedule_kind: 'as_needed', times: [], min_gap_hours: 6, slots: [],
    last_dose: lastGivenMinsAgo === null ? null : { id: 'd9', status: 'given', given_at: minsAgo(lastGivenMinsAgo), by_name: 'Mom' }, ...over,
  })
const summary = { last_feed: null, next_feed_due_at: null, last_diaper: null, feeds_today: 0, diapers_today: { wet: 0, dirty: 0, both: 0 }, sleep: { open: null, last: null } }
const base = (medicines: object[], me = ME_ADMIN) => ({
  'GET /api/me': { body: me },
  'GET /api/summary': { body: summary },
  'GET /api/medicines': { body: medicines },
})
const post = { status: 201, body: { id: 'x', by_name: 'Owner', gap_warning: null } }

test('shows a pending slot with Given and Skip and posts scheduled_for', async () => {
  const s = slot()
  const calls = mockApi({ ...base([med({ slots: [s] })]), 'POST /api/medicines/m1/doses': post })
  renderApp(<Home />)
  expect(await screen.findByText(/Vitamin D/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: en.medicines.given }))
  await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/medicines/m1/doses')).toBe(true))
  const body = calls.find((c) => c.key === 'POST /api/medicines/m1/doses')!.body as Record<string, unknown>
  expect(body).toMatchObject({ status: 'given', scheduled_for: s.due_at })
  expect(body.id).toMatch(/^[0-9a-f-]{36}$/)
})

test('Skip posts a skipped dose for the slot', async () => {
  const s = slot()
  const calls = mockApi({ ...base([med({ slots: [s] })]), 'POST /api/medicines/m1/doses': post })
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.medicines.skip }))
  await waitFor(() => expect(calls.find((c) => c.key === 'POST /api/medicines/m1/doses')?.body).toMatchObject({ status: 'skipped', scheduled_for: s.due_at }))
})

test('a late slot is flagged overdue and a future one is not', async () => {
  mockApi(base([med({ slots: [slot({ due_at: minsAgo(20) }), slot({ due_at: minsFromNow(180) })] })]))
  renderApp(<Home />)
  expect(await screen.findByText(text(en.medicines.overdue, { ago: '20m' }))).toBeInTheDocument()
  expect(screen.getAllByText(en.medicines.overdue.split('{{')[0], { exact: false })).toHaveLength(1)
})

test('a resolved slot shows who gave it and offers undo', async () => {
  const at = minsAgo(30)
  const calls = mockApi({
    ...base([med({ slots: [slot({ status: 'given', dose_id: 'd1', given_at: at, by_name: 'Mom' })] })]),
    'DELETE /api/medicines/m1/doses/d1': { body: { ok: true } },
  })
  renderApp(<Home />)
  expect(await screen.findByText(text(en.medicines.givenBy, { name: 'Mom', time: formatClock(at) }))).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: en.medicines.given })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: en.medicines.undo }))
  await waitFor(() => expect(calls.some((c) => c.key === 'DELETE /api/medicines/m1/doses/d1')).toBe(true))
})

test('a skipped slot says so', async () => {
  const at = minsAgo(30)
  mockApi(base([med({ slots: [slot({ status: 'skipped', dose_id: 'd1', given_at: at, by_name: 'Nanny' })] })]))
  renderApp(<Home />)
  expect(await screen.findByText(text(en.medicines.skippedBy, { name: 'Nanny', time: formatClock(at) }))).toBeInTheDocument()
})

test('viewer sees medicines but no buttons', async () => {
  mockApi(base([med(), asNeeded(120)], ME_VIEWER))
  renderApp(<Home />)
  await screen.findByText(/Vitamin D/)
  for (const name of [en.medicines.given, en.medicines.skip, en.medicines.giveNow, en.medicines.undo]) {
    expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
  }
})

test('as-needed inside the minimum gap asks to confirm, and still posts when confirmed', async () => {
  const calls = mockApi({ ...base([asNeeded(120)]), 'POST /api/medicines/m2/doses': post })
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.medicines.giveNow }))
  const dialog = await screen.findByRole('dialog')
  expect(dialog).toHaveTextContent('2h')
  expect(calls.some((c) => c.key === 'POST /api/medicines/m2/doses')).toBe(false)
  await userEvent.click(screen.getByRole('button', { name: en.medicines.giveAnyway }))
  await waitFor(() => expect(calls.find((c) => c.key === 'POST /api/medicines/m2/doses')?.body).toMatchObject({ status: 'given' }))
  expect(calls.find((c) => c.key === 'POST /api/medicines/m2/doses')!.body).not.toHaveProperty('scheduled_for')
})

test('declining the confirm saves nothing', async () => {
  const calls = mockApi({ ...base([asNeeded(120)]), 'POST /api/medicines/m2/doses': post })
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.medicines.giveNow }))
  await userEvent.click(await screen.findByRole('button', { name: en.medicines.cancel }))
  expect(calls.some((c) => c.key === 'POST /api/medicines/m2/doses')).toBe(false)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('as-needed outside the gap posts straight away', async () => {
  const calls = mockApi({ ...base([asNeeded(8 * 60)]), 'POST /api/medicines/m2/doses': post })
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.medicines.giveNow }))
  await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/medicines/m2/doses')).toBe(true))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('a dose another phone already recorded says who gave it', async () => {
  mockApi({ ...base([med()]), 'POST /api/medicines/m1/doses': { status: 200, body: { id: 'x', by_name: 'Nanny', gap_warning: null } } })
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.medicines.given }))
  expect(await screen.findByText(text(en.medicines.alreadyGave, { name: 'Nanny' }))).toBeInTheDocument()
})

test('a refused dose (409) explains and refreshes instead of failing silently', async () => {
  mockApi({ ...base([med()]), 'POST /api/medicines/m1/doses': { status: 409, body: { detail: 'that dose is not due' } } })
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.medicines.given }))
  expect(await screen.findByText(en.medicines.notDue)).toBeInTheDocument()
})

test('a queued dose shows waiting to sync and hides its buttons', async () => {
  const s = slot()
  await enqueue({ kind: 'dose', id: 'q1', payload: { id: 'q1', medicine_id: 'm1', status: 'given', scheduled_for: s.due_at } })
  mockApi(base([med({ slots: [s] })]))
  renderApp(<Home />)
  expect(await screen.findByText(en.medicines.waiting)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: en.medicines.given })).not.toBeInTheDocument()
})

test('no medicines means no medicines card', async () => {
  mockApi(base([]))
  renderApp(<Home />)
  await screen.findByText(en.sleep.none)
  expect(screen.queryByText(en.medicines.title)).not.toBeInTheDocument()
})

test('tapping a medicine notification (?log=medicine) scrolls to the medicines card', async () => {
  const scroll = vi.fn()
  Element.prototype.scrollIntoView = scroll
  mockApi(base([med()]))
  renderApp(<Home />, '/?log=medicine')
  await waitFor(() => expect(scroll).toHaveBeenCalled())
})

test('Settings saves the medicine reminders toggle with the other preferences', async () => {
  const kid = { id: 'k1', name: 'Baby', birth_date: null, feed_interval_minutes: 180, diaper_alert_minutes: 240 }
  const calls = mockApi({
    'GET /api/me': { body: ME_ADMIN },
    'GET /api/kid': { body: kid },
    'GET /api/notification-prefs': { body: { feed: true, diaper: true, medicine: true } },
    'PUT /api/notification-prefs': { body: { feed: true, diaper: true, medicine: false } },
  })
  renderApp(<Settings />)
  await userEvent.click(await screen.findByRole('checkbox', { name: en.settings.medicineReminders }))
  await waitFor(() => expect(calls.find((c) => c.key === 'PUT /api/notification-prefs')?.body).toEqual({ feed: true, diaper: true, medicine: false }))
})
