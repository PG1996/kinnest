import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import en from '../i18n/en.json'
import { ME_ADMIN, ME_VIEWER, mockApi, renderApp } from '../test/utils'
import Home from './Home'
import MedicinesPage from './Medicines'

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
const med = (over: object = {}) => ({
  id: 'm1', name: 'Vitamin D', dose_amount: 5, dose_unit: 'drops', schedule_kind: 'fixed', times: ['09:00'], interval_hours: null, first_dose_at: null,
  min_gap_hours: null, start_date: '2026-11-01', end_date: null, notes: '', ended: false,
  slots: [{ due_at: minsAgo(20), status: 'pending', given_amount: 0, remaining: 5, doses: [], dose_id: null, given_at: null, by_name: null, nudge: null }], last_dose: null, ...over,
})
const sos = (over: object = {}) => med({ id: 'm2', name: 'Paracetamol', dose_amount: 1.5, dose_unit: 'ml', schedule_kind: 'as_needed', times: [], min_gap_hours: 6, slots: [], ...over })
const summary = { last_feed: null, next_feed_due_at: null, last_diaper: null, feeds_today: 0, diapers_today: { wet: 0, dirty: 0, both: 0 }, sleep: { open: null, last: null } }
const base = (medicines: object[] = [], me: object = ME_ADMIN) => ({ 'GET /api/me': { body: me }, 'GET /api/summary': { body: summary }, 'GET /api/medicines': { body: medicines } })

test('the admin has a dedicated Add SOS medicine button, and the form opens on SOS with no times', async () => {
  mockApi(base())
  renderApp(<MedicinesPage />, '/medicines')
  await userEvent.click(await screen.findByRole('button', { name: en.medicines.page.addSos }))
  expect(screen.getByRole('radio', { name: en.medicines.form.kind.as_needed })).toBeChecked()
  expect(screen.queryByLabelText(en.medicines.form.timeN.replace('{{n}}', '1'))).not.toBeInTheDocument()
  expect(screen.getByLabelText(en.medicines.form.minGap)).toBeInTheDocument()
})

test('the SOS option is named SOS so it is easy to find in the kind list', async () => {
  mockApi(base())
  renderApp(<MedicinesPage />, '/medicines')
  await userEvent.click(await screen.findByRole('button', { name: en.medicines.page.add }))
  expect(en.medicines.form.kind.as_needed).toMatch(/SOS/)
  expect(screen.getByRole('radio', { name: en.medicines.form.kind.as_needed })).not.toBeChecked()
})

test('saving an SOS medicine posts schedule_kind as_needed with no times', async () => {
  const calls = mockApi({ ...base(), 'POST /api/medicines': { status: 201, body: sos() } })
  renderApp(<MedicinesPage />, '/medicines')
  await userEvent.click(await screen.findByRole('button', { name: en.medicines.page.addSos }))
  await userEvent.type(screen.getByLabelText(en.medicines.form.name), 'Paracetamol')
  await userEvent.type(screen.getByLabelText(en.medicines.form.doseAmount), '1.5')
  await userEvent.selectOptions(screen.getByLabelText(en.medicines.form.doseUnit), 'ml')
  await userEvent.type(screen.getByLabelText(en.medicines.form.minGap), '6')
  await userEvent.click(screen.getByRole('button', { name: en.medicines.form.save }))
  await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/medicines')).toBe(true))
  const body = calls.find((c) => c.key === 'POST /api/medicines')!.body as Record<string, unknown>
  expect(body).toMatchObject({ name: 'Paracetamol', dose_amount: 1.5, dose_unit: 'ml', schedule_kind: 'as_needed', min_gap_hours: 6 })
  expect(body).not.toHaveProperty('times')
})

test('a viewer and a caregiver have no add buttons', async () => {
  mockApi(base([], ME_VIEWER))
  const { unmount } = renderApp(<MedicinesPage />, '/medicines')
  await screen.findByRole('heading', { name: en.medicines.page.title })
  expect(screen.queryByRole('button', { name: en.medicines.page.addSos })).not.toBeInTheDocument()
  unmount()
  mockApi(base([], { ...ME_ADMIN, role: 'caregiver' }))
  renderApp(<MedicinesPage />, '/medicines')
  await screen.findByRole('heading', { name: en.medicines.page.title })
  expect(screen.queryByRole('button', { name: en.medicines.page.addSos })).not.toBeInTheDocument()
})

test('on Home an SOS medicine is a tile with an SOS badge, next to the scheduled ones', async () => {
  mockApi(base([med(), sos()]))
  renderApp(<Home />)
  const grid = await screen.findByTestId('medicine-grid')
  expect(within(grid).getByRole('button', { name: /Vitamin D/ })).not.toHaveTextContent(en.medicines.sosBadge)
  expect(within(grid).getByRole('button', { name: /Paracetamol/ })).toHaveTextContent(en.medicines.sosBadge)
})

test('tapping the SOS tile opens its dose buttons', async () => {
  mockApi(base([med(), sos()]))
  renderApp(<Home />)
  await userEvent.click(within(await screen.findByTestId('medicine-grid')).getByRole('button', { name: /Paracetamol/ }))
  const detail = screen.getByTestId('medicine-detail')
  expect(within(detail).getByText(/Paracetamol/)).toBeInTheDocument()
  expect(within(detail).getByRole('button', { name: en.medicines.giveFull })).toBeInTheDocument()
  expect(within(detail).queryByRole('button', { name: en.medicines.atOtherTime })).not.toBeInTheDocument() // under More
  await userEvent.click(within(detail).getByRole('button', { name: en.medicines.more }))
  expect(within(detail).getByRole('button', { name: en.medicines.atOtherTime })).toBeInTheDocument()
  expect(within(detail).getByRole('button', { name: en.medicines.givePartial })).toBeInTheDocument()
})

test('with only SOS medicines the one SOS medicine is opened by itself', async () => {
  mockApi(base([sos()]))
  renderApp(<Home />)
  await screen.findByTestId('medicine-grid')
  expect(within(screen.getByTestId('medicine-detail')).getByRole('button', { name: en.medicines.giveFull })).toBeInTheDocument()
})

test('an SOS medicine says when it was last given and how long until it is safe again', async () => {
  mockApi(base([sos({ last_dose: { id: 'd1', status: 'given', amount: 1.5, given_at: minsAgo(120), by_name: 'Mom' } })]))
  renderApp(<Home />)
  const detail = await screen.findByTestId('medicine-detail')
  expect(within(detail).getByText(/Mom/)).toBeInTheDocument()
  expect(within(detail).getByText(new RegExp(en.medicines.sosWait.replace('{{time}}', '.+')))).toBeInTheDocument()
})
