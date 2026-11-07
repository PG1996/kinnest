import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import en from '../i18n/en.json'
import { toLocalInput } from '../lib/time'
import { ME_ADMIN, mockApi, renderApp } from '../test/utils'
import MedicinesPage from './Medicines'

const text = (key: string, vars: Record<string, string>) => Object.entries(vars).reduce((s, [k, v]) => s.replace(`{{${k}}}`, v), key)
const med = (over: object = {}) => ({
  id: 'm1', name: 'Vitamin D', dose: '5 drops', schedule_kind: 'fixed', times: ['09:00', '21:00'], interval_hours: null, first_dose_at: null,
  min_gap_hours: null, start_date: '2026-11-01', end_date: null, notes: '', ended: false, slots: [], last_dose: null, ...over,
})
const base = (medicines: object[] = [], me: object = ME_ADMIN) => ({ 'GET /api/me': { body: me }, 'GET /api/medicines': { body: medicines } })
const created = { status: 201, body: med() }
const today = () => toLocalInput(new Date()).slice(0, 10)

async function openForm() {
  await userEvent.click(await screen.findByRole('button', { name: en.medicines.page.add }))
}
async function fillBasics(name = 'Vitamin D', dose = '5 drops') {
  await userEvent.type(screen.getByLabelText(en.medicines.form.name), name)
  await userEvent.type(screen.getByLabelText(en.medicines.form.dose), dose)
}
const save = () => userEvent.click(screen.getByRole('button', { name: en.medicines.form.save }))

test('admin adds a fixed medicine with two times and the POST body matches', async () => {
  const calls = mockApi({ ...base(), 'POST /api/medicines': created })
  renderApp(<MedicinesPage />, '/medicines')
  await openForm()
  await fillBasics()
  fireEvent.change(screen.getByLabelText(text(en.medicines.form.timeN, { n: '1' })), { target: { value: '08:00' } })
  await userEvent.click(screen.getByRole('button', { name: en.medicines.form.addTime }))
  fireEvent.change(screen.getByLabelText(text(en.medicines.form.timeN, { n: '2' })), { target: { value: '20:00' } })
  await save()
  await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/medicines')).toBe(true))
  expect(calls.find((c) => c.key === 'POST /api/medicines')!.body).toMatchObject({
    name: 'Vitamin D', dose: '5 drops', schedule_kind: 'fixed', times: ['08:00', '20:00'], start_date: today(), end_date: null,
  })
})

test('duplicate or missing times are refused before anything is sent', async () => {
  const calls = mockApi({ ...base(), 'POST /api/medicines': created })
  renderApp(<MedicinesPage />, '/medicines')
  await openForm()
  await fillBasics()
  fireEvent.change(screen.getByLabelText(text(en.medicines.form.timeN, { n: '1' })), { target: { value: '08:00' } })
  await userEvent.click(screen.getByRole('button', { name: en.medicines.form.addTime }))
  fireEvent.change(screen.getByLabelText(text(en.medicines.form.timeN, { n: '2' })), { target: { value: '08:00' } })
  await save()
  expect(await screen.findByText(en.medicines.form.invalid)).toBeInTheDocument()
  expect(calls.some((c) => c.key === 'POST /api/medicines')).toBe(false)
})

test('interval form requires hours and a first dose, then posts both', async () => {
  const calls = mockApi({ ...base(), 'POST /api/medicines': created })
  renderApp(<MedicinesPage />, '/medicines')
  await openForm()
  await fillBasics('Antibiotic', '2.5 ml')
  await userEvent.click(screen.getByRole('radio', { name: en.medicines.form.kind.interval }))
  const hours = screen.getByLabelText(en.medicines.form.intervalHours)
  await userEvent.clear(hours)
  await save()
  expect(await screen.findByText(en.medicines.form.invalid)).toBeInTheDocument()
  expect(calls.some((c) => c.key === 'POST /api/medicines')).toBe(false)
  await userEvent.type(hours, '6')
  fireEvent.change(screen.getByLabelText(en.medicines.form.firstDose), { target: { value: '2026-11-08T08:00' } })
  await save()
  await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/medicines')).toBe(true))
  expect(calls.find((c) => c.key === 'POST /api/medicines')!.body).toMatchObject({
    schedule_kind: 'interval', interval_hours: 6, first_dose_at: new Date('2026-11-08T08:00').toISOString(),
  })
})

test('as needed form posts the optional minimum gap', async () => {
  const calls = mockApi({ ...base(), 'POST /api/medicines': created })
  renderApp(<MedicinesPage />, '/medicines')
  await openForm()
  await fillBasics('Paracetamol', '1.5 ml')
  await userEvent.click(screen.getByRole('radio', { name: en.medicines.form.kind.as_needed }))
  await userEvent.type(screen.getByLabelText(en.medicines.form.minGap), '6')
  await save()
  await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/medicines')).toBe(true))
  expect(calls.find((c) => c.key === 'POST /api/medicines')!.body).toMatchObject({ schedule_kind: 'as_needed', min_gap_hours: 6 })
})

test('as needed without a gap posts null', async () => {
  const calls = mockApi({ ...base(), 'POST /api/medicines': created })
  renderApp(<MedicinesPage />, '/medicines')
  await openForm()
  await fillBasics('Paracetamol', '1.5 ml')
  await userEvent.click(screen.getByRole('radio', { name: en.medicines.form.kind.as_needed }))
  await save()
  await waitFor(() => expect(calls.find((c) => c.key === 'POST /api/medicines')?.body).toMatchObject({ min_gap_hours: null }))
})

test('caregiver sees the list without add, edit or delete', async () => {
  mockApi(base([med()], { ...ME_ADMIN, role: 'caregiver' }))
  renderApp(<MedicinesPage />, '/medicines')
  expect(await screen.findByText(/Vitamin D/)).toBeInTheDocument()
  expect(screen.getByText(text(en.medicines.page.fixed, { times: '09:00, 21:00' }))).toBeInTheDocument()
  for (const name of [en.medicines.page.add, en.medicines.page.edit, en.medicines.page.delete]) {
    expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
  }
})

test('delete needs a second confirm', async () => {
  const calls = mockApi({ ...base([med()]), 'DELETE /api/medicines/m1': { body: { ok: true } } })
  renderApp(<MedicinesPage />, '/medicines')
  await userEvent.click(await screen.findByRole('button', { name: en.medicines.page.delete }))
  expect(calls.some((c) => c.key === 'DELETE /api/medicines/m1')).toBe(false)
  await userEvent.click(screen.getByRole('button', { name: en.medicines.page.confirmDelete }))
  await waitFor(() => expect(calls.some((c) => c.key === 'DELETE /api/medicines/m1')).toBe(true))
})

test('past medicines are listed separately', async () => {
  mockApi(base([med(), med({ id: 'm2', name: 'Old antibiotic', ended: true, end_date: '2026-10-30' })]))
  renderApp(<MedicinesPage />, '/medicines')
  const heading = await screen.findByText(en.medicines.page.past)
  expect(heading).toBeInTheDocument()
  expect(screen.getByText(/Old antibiotic/)).toBeInTheDocument()
  expect(screen.getAllByText(/Vitamin D/)).toHaveLength(1)
})

test('editing prefills the form and PATCHes the change', async () => {
  const calls = mockApi({ ...base([med()]), 'PATCH /api/medicines/m1': { body: med({ dose: '10 drops' }) } })
  renderApp(<MedicinesPage />, '/medicines')
  await userEvent.click(await screen.findByRole('button', { name: en.medicines.page.edit }))
  expect(screen.getByLabelText(en.medicines.form.name)).toHaveValue('Vitamin D')
  expect(screen.getByLabelText(text(en.medicines.form.timeN, { n: '2' }))).toHaveValue('21:00')
  const dose = screen.getByLabelText(en.medicines.form.dose)
  await userEvent.clear(dose)
  await userEvent.type(dose, '10 drops')
  await save()
  await waitFor(() => expect(calls.find((c) => c.key === 'PATCH /api/medicines/m1')?.body).toMatchObject({ dose: '10 drops', schedule_kind: 'fixed' }))
})

test('a server refusal is shown instead of closing the form', async () => {
  mockApi({ ...base(), 'POST /api/medicines': { status: 422, body: { detail: 'bad' } } })
  renderApp(<MedicinesPage />, '/medicines')
  await openForm()
  await fillBasics()
  await save()
  expect(await screen.findByText(en.common.error)).toBeInTheDocument()
  expect(screen.getByLabelText(en.medicines.form.name)).toBeInTheDocument()
})
