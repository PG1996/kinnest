import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import en from '../i18n/en.json'
import { ME_ADMIN, mockApi, renderApp } from '../test/utils'
import Home from './Home'
import MedicinesPage from './Medicines'

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
const minsFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString()
const slot = (over: object = {}) => ({ due_at: minsAgo(20), status: 'pending', given_amount: 0, remaining: 2.5, doses: [], dose_id: null, given_at: null, by_name: null, nudge: null, ...over })
const base = (over: object = {}) => ({
  id: 'm1', name: 'Antibiotic', dose_amount: 2.5, dose_unit: 'ml', schedule_kind: 'interval', times: [], interval_hours: 4, first_dose_at: minsAgo(600),
  min_gap_hours: null, max_per_day: 3, day_start: '11:00', given_today: 0, day_ends_at: minsFromNow(600), start_date: '2026-11-01', end_date: null, notes: '', ended: false,
  slots: [slot()], last_dose: null, ...over,
})
const sos = (over: object = {}) => base({ id: 'm2', name: 'Paracetamol', schedule_kind: 'as_needed', interval_hours: null, first_dose_at: null, day_start: null, max_per_day: 2, dose_amount: 1.5, min_gap_hours: null, slots: [], ...over })
const summary = { last_feed: null, next_feed_due_at: null, last_diaper: null, feeds_today: 0, diapers_today: { wet: 0, dirty: 0, both: 0 }, sleep: { open: null, last: null } }
const api = (medicines: object[]) => ({ 'GET /api/me': { body: ME_ADMIN }, 'GET /api/summary': { body: summary }, 'GET /api/medicines': { body: medicines } })
const posted = { status: 201, body: { id: 'x', by_name: 'Owner', gap_warning: null, max_warning: null, slot: { status: 'given', given_amount: 2.5, remaining: 0 } } }
const doseCalls = (calls: { key: string; body?: unknown }[], id: string) => calls.filter((c) => c.key === `POST /api/medicines/${id}/doses`)

// --- the form ---------------------------------------------------------------------------------------------------------

test('an every-few-hours medicine can have a daily maximum and a usual first dose time', async () => {
  const calls = mockApi({ ...api([]), 'POST /api/medicines': { status: 201, body: base() } })
  renderApp(<MedicinesPage />, '/medicines')
  await userEvent.click(await screen.findByRole('button', { name: en.medicines.page.add }))
  await userEvent.type(screen.getByLabelText(en.medicines.form.name), 'Antibiotic')
  await userEvent.type(screen.getByLabelText(en.medicines.form.doseAmount), '2.5')
  await userEvent.selectOptions(screen.getByLabelText(en.medicines.form.doseUnit), 'ml')
  await userEvent.click(screen.getByRole('radio', { name: en.medicines.form.kind.interval }))
  expect(screen.queryByLabelText(en.medicines.form.usualStart)).not.toBeInTheDocument() // only once a maximum is set
  await userEvent.type(screen.getByLabelText(en.medicines.form.maxPerDay), '3')
  fireEvent.change(screen.getByLabelText(en.medicines.form.usualStart), { target: { value: '11:00' } })
  await userEvent.click(screen.getByRole('button', { name: en.medicines.form.save }))
  await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/medicines')).toBe(true))
  expect(calls.find((c) => c.key === 'POST /api/medicines')!.body).toMatchObject({ schedule_kind: 'interval', interval_hours: 8, max_per_day: 3, day_start: '11:00' })
})

test('with no maximum nothing extra is sent', async () => {
  const calls = mockApi({ ...api([]), 'POST /api/medicines': { status: 201, body: base() } })
  renderApp(<MedicinesPage />, '/medicines')
  await userEvent.click(await screen.findByRole('button', { name: en.medicines.page.add }))
  await userEvent.type(screen.getByLabelText(en.medicines.form.name), 'Antibiotic')
  await userEvent.type(screen.getByLabelText(en.medicines.form.doseAmount), '2.5')
  await userEvent.selectOptions(screen.getByLabelText(en.medicines.form.doseUnit), 'ml')
  await userEvent.click(screen.getByRole('radio', { name: en.medicines.form.kind.interval }))
  await userEvent.click(screen.getByRole('button', { name: en.medicines.form.save }))
  await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/medicines')).toBe(true))
  const body = calls.find((c) => c.key === 'POST /api/medicines')!.body as Record<string, unknown>
  expect(body.max_per_day).toBeNull()
  expect(body.day_start).toBeNull()
})

test('an SOS medicine can have a maximum in 24 hours but no usual time', async () => {
  const calls = mockApi({ ...api([]), 'POST /api/medicines': { status: 201, body: sos() } })
  renderApp(<MedicinesPage />, '/medicines')
  await userEvent.click(await screen.findByRole('button', { name: en.medicines.page.addSos }))
  await userEvent.type(screen.getByLabelText(en.medicines.form.name), 'Paracetamol')
  await userEvent.type(screen.getByLabelText(en.medicines.form.doseAmount), '1.5')
  await userEvent.selectOptions(screen.getByLabelText(en.medicines.form.doseUnit), 'ml')
  await userEvent.type(screen.getByLabelText(en.medicines.form.maxPerDaySos), '2')
  expect(screen.queryByLabelText(en.medicines.form.usualStart)).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: en.medicines.form.save }))
  await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/medicines')).toBe(true))
  expect(calls.find((c) => c.key === 'POST /api/medicines')!.body).toMatchObject({ schedule_kind: 'as_needed', max_per_day: 2 })
})

test('a maximum outside 1 to 24 is refused before anything is sent', async () => {
  const calls = mockApi({ ...api([]), 'POST /api/medicines': { status: 201, body: base() } })
  renderApp(<MedicinesPage />, '/medicines')
  await userEvent.click(await screen.findByRole('button', { name: en.medicines.page.add }))
  await userEvent.type(screen.getByLabelText(en.medicines.form.name), 'A')
  await userEvent.type(screen.getByLabelText(en.medicines.form.doseAmount), '1')
  await userEvent.selectOptions(screen.getByLabelText(en.medicines.form.doseUnit), 'ml')
  await userEvent.click(screen.getByRole('radio', { name: en.medicines.form.kind.interval }))
  await userEvent.type(screen.getByLabelText(en.medicines.form.maxPerDay), '30')
  await userEvent.click(screen.getByRole('button', { name: en.medicines.form.save }))
  expect(await screen.findByText(en.medicines.form.invalid)).toBeInTheDocument()
  expect(calls.some((c) => c.key === 'POST /api/medicines')).toBe(false)
})

// --- giving past the maximum -------------------------------------------------------------------------------------------

test('giving an SOS dose after the maximum asks first and says how many were given', async () => {
  const calls = mockApi({ ...api([sos({ given_today: 2 })]), 'POST /api/medicines/m2/doses': posted })
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.medicines.giveFull }))
  const dialog = await screen.findByRole('dialog', { name: en.medicines.maxTitle })
  expect(dialog).toHaveTextContent(en.medicines.maxBody.replace('{{count}}', '2').replace('{{max}}', '2'))
  expect(doseCalls(calls, 'm2')).toHaveLength(0)
  await userEvent.click(within(dialog).getByRole('button', { name: en.medicines.giveAnyway }))
  await waitFor(() => expect(doseCalls(calls, 'm2')).toHaveLength(1))
})

test('cancelling the maximum warning gives nothing', async () => {
  const calls = mockApi({ ...api([sos({ given_today: 2 })]), 'POST /api/medicines/m2/doses': posted })
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.medicines.giveFull }))
  const dialog = await screen.findByRole('dialog', { name: en.medicines.maxTitle })
  await userEvent.click(within(dialog).getByRole('button', { name: en.medicines.cancel }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(doseCalls(calls, 'm2')).toHaveLength(0)
})

test('below the maximum a dose is given without a question', async () => {
  const calls = mockApi({ ...api([sos({ given_today: 1 })]), 'POST /api/medicines/m2/doses': posted })
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.medicines.giveFull }))
  await waitFor(() => expect(doseCalls(calls, 'm2')).toHaveLength(1))
  expect(screen.queryByRole('dialog', { name: en.medicines.maxTitle })).not.toBeInTheDocument()
})

test('an extra every-few-hours dose after the maximum asks first too', async () => {
  const calls = mockApi({ ...api([base({ given_today: 3 })]), 'POST /api/medicines/m1/doses': posted })
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.medicines.giveFull }))
  expect(await screen.findByRole('dialog', { name: en.medicines.maxTitle })).toBeInTheDocument()
  expect(doseCalls(calls, 'm1')).toHaveLength(0)
})

test('without a maximum nothing is asked however many were given', async () => {
  const calls = mockApi({ ...api([sos({ max_per_day: null, given_today: 9 })]), 'POST /api/medicines/m2/doses': posted })
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.medicines.giveFull }))
  await waitFor(() => expect(doseCalls(calls, 'm2')).toHaveLength(1))
})

// --- what the tile and detail say -------------------------------------------------------------------------------------

test('the tile says Max reached and the next dose once the day is done', async () => {
  mockApi(api([base({ given_today: 3, slots: [slot({ due_at: minsFromNow(16 * 60) })] })]))
  renderApp(<Home />)
  const tile = within(await screen.findByTestId('medicine-grid')).getByRole('button', { name: /Antibiotic/ })
  expect(tile).toHaveTextContent(en.medicines.tileMax)
  expect(tile).toHaveTextContent(new RegExp(en.medicines.tileNext.replace('{{time}}', '.+')))
})

test('the detail shows how many doses of the maximum have been given', async () => {
  mockApi(api([base({ given_today: 2 })]))
  renderApp(<Home />)
  const detail = await screen.findByTestId('medicine-detail')
  expect(within(detail).getByText(en.medicines.dosesToday.replace('{{count}}', '2').replace('{{max}}', '3'))).toBeInTheDocument()
})

test('when all the doses of the day are given the detail says 3/3 done', async () => {
  mockApi(api([base({ given_today: 3, slots: [slot({ due_at: minsFromNow(16 * 60) })] })]))
  renderApp(<Home />)
  const detail = await screen.findByTestId('medicine-detail')
  expect(within(detail).getByText(en.medicines.doneToday.replace('{{count}}', '3').replace('{{max}}', '3'))).toBeInTheDocument()
})

test('after midnight the count is back to 0 even before the list is fetched again', async () => {
  const calls = mockApi({ ...api([base({ given_today: 3, day_ends_at: minsAgo(5), slots: [slot({ due_at: minsFromNow(60) })] })]), 'POST /api/medicines/m1/doses': posted })
  renderApp(<Home />)
  const detail = await screen.findByTestId('medicine-detail')
  expect(within(detail).getByText(en.medicines.dosesToday.replace('{{count}}', '0').replace('{{max}}', '3'))).toBeInTheDocument()
  await userEvent.click(within(detail).getByRole('button', { name: en.medicines.giveAhead }))
  await waitFor(() => expect(doseCalls(calls, 'm1')).toHaveLength(1)) // no "maximum reached" question on a new day
  expect(screen.queryByRole('dialog', { name: en.medicines.maxTitle })).not.toBeInTheDocument()
})

// --- giving a dose whenever you want, from Home ---------------------------------------------------------------------------

test('a dose that is not due yet can be given now from Home, and counts for the next slot', async () => {
  const due = minsFromNow(5 * 60)
  const calls = mockApi({ ...api([base({ given_today: 1, slots: [slot({ due_at: due })] })]), 'POST /api/medicines/m1/doses': posted })
  renderApp(<Home />)
  const detail = await screen.findByTestId('medicine-detail')
  expect(within(detail).queryByRole('button', { name: en.medicines.giveFull })).not.toBeInTheDocument() // nothing is due yet
  await userEvent.click(within(detail).getByRole('button', { name: en.medicines.giveAhead }))
  await waitFor(() => expect(doseCalls(calls, 'm1')).toHaveLength(1))
  expect(doseCalls(calls, 'm1')[0].body).toMatchObject({ status: 'given', scheduled_for: due, amount: 2.5 })
})

test('giving ahead of time after the day is full still asks about the maximum first', async () => {
  const calls = mockApi({ ...api([base({ given_today: 3, slots: [slot({ due_at: minsFromNow(16 * 60) })] })]), 'POST /api/medicines/m1/doses': posted })
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.medicines.giveAhead }))
  expect(await screen.findByRole('dialog', { name: en.medicines.maxTitle })).toBeInTheDocument()
  expect(doseCalls(calls, 'm1')).toHaveLength(0)
})

test('a viewer cannot give a dose ahead of time', async () => {
  mockApi({ ...api([base({ slots: [slot({ due_at: minsFromNow(5 * 60) })] })]), 'GET /api/me': { body: { ...ME_ADMIN, role: 'viewer' } } })
  renderApp(<Home />)
  await screen.findByTestId('medicine-detail')
  expect(screen.queryByRole('button', { name: en.medicines.giveAhead })).not.toBeInTheDocument()
})
