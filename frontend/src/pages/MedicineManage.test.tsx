import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import en from '../i18n/en.json'
import { DOSE_UNITS } from '../lib/units'
import { toLocalInput } from '../lib/time'
import { ME_ADMIN, mockApi, renderApp, pickTime, pickDateTime } from '../test/utils'
import MedicinesPage from './Medicines'

const text = (key: string, vars: Record<string, string>) => Object.entries(vars).reduce((s, [k, v]) => s.replace(`{{${k}}}`, v), key)
const med = (over: object = {}) => ({
  id: 'm1', name: 'Vitamin D', dose_amount: 5, dose_unit: 'drops', schedule_kind: 'fixed', times: ['09:00', '21:00'], interval_hours: null, first_dose_at: null,
  min_gap_hours: null, start_date: '2026-11-01', end_date: null, notes: '', ended: false, slots: [], last_dose: null, ...over,
})
const base = (medicines: object[] = [], me: object = ME_ADMIN) => ({ 'GET /api/me': { body: me }, 'GET /api/medicines': { body: medicines } })
const created = { status: 201, body: med() }
const today = () => toLocalInput(new Date()).slice(0, 10)

async function openForm() {
  await userEvent.click(await screen.findByRole('button', { name: en.medicines.page.add }))
}
async function fillBasics(name = 'Vitamin D', amount = '5', unit = 'drops') {
  await userEvent.type(screen.getByLabelText(en.medicines.form.name), name)
  await userEvent.type(screen.getByLabelText(en.medicines.form.doseAmount), amount)
  await userEvent.selectOptions(screen.getByLabelText(en.medicines.form.doseUnit), unit)
}
const save = () => userEvent.click(screen.getByRole('button', { name: en.medicines.form.save }))

test('admin adds a fixed medicine with two times and the POST body matches', async () => {
  const calls = mockApi({ ...base(), 'POST /api/medicines': created })
  renderApp(<MedicinesPage />, '/medicines')
  await openForm()
  await fillBasics('Vitamin D', '0.25', 'ml')
  await pickTime(text(en.medicines.form.timeN, { n: '1' }), 8, 0)
  await userEvent.click(screen.getByRole('button', { name: en.medicines.form.addTime }))
  await pickTime(text(en.medicines.form.timeN, { n: '2' }), 20, 0)
  await save()
  await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/medicines')).toBe(true))
  expect(calls.find((c) => c.key === 'POST /api/medicines')!.body).toMatchObject({
    name: 'Vitamin D', dose_amount: 0.25, dose_unit: 'ml', schedule_kind: 'fixed', times: ['08:00', '20:00'], start_date: today(), end_date: null,
  })
})

test('duplicate or missing times are refused before anything is sent', async () => {
  const calls = mockApi({ ...base(), 'POST /api/medicines': created })
  renderApp(<MedicinesPage />, '/medicines')
  await openForm()
  await fillBasics()
  await pickTime(text(en.medicines.form.timeN, { n: '1' }), 8, 0)
  await userEvent.click(screen.getByRole('button', { name: en.medicines.form.addTime }))
  await pickTime(text(en.medicines.form.timeN, { n: '2' }), 8, 0)
  await save()
  expect(await screen.findByText(en.medicines.form.invalid)).toBeInTheDocument()
  expect(calls.some((c) => c.key === 'POST /api/medicines')).toBe(false)
})

test('interval form requires hours and a first dose, then posts both', async () => {
  const calls = mockApi({ ...base(), 'POST /api/medicines': created })
  renderApp(<MedicinesPage />, '/medicines')
  await openForm()
  await fillBasics('Antibiotic', '2.5', 'ml')
  await userEvent.click(screen.getByRole('radio', { name: en.medicines.form.kind.interval }))
  const hours = screen.getByLabelText(en.medicines.form.intervalHours)
  await userEvent.clear(hours)
  await save()
  expect(await screen.findByText(en.medicines.form.invalid)).toBeInTheDocument()
  expect(calls.some((c) => c.key === 'POST /api/medicines')).toBe(false)
  await userEvent.type(hours, '6')
  await pickDateTime(en.medicines.form.firstDose, new Date(2026, 10, 8, 8, 0))
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
  await fillBasics('Paracetamol', '1.5', 'ml')
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
  await fillBasics('Paracetamol', '1.5', 'ml')
  await userEvent.click(screen.getByRole('radio', { name: en.medicines.form.kind.as_needed }))
  await save()
  await waitFor(() => expect(calls.find((c) => c.key === 'POST /api/medicines')?.body).toMatchObject({ min_gap_hours: null }))
})

test('caregiver sees the list without add, edit or delete', async () => {
  mockApi(base([med()], { ...ME_ADMIN, role: 'caregiver' }))
  renderApp(<MedicinesPage />, '/medicines')
  expect(await screen.findByText(/Vitamin D/)).toBeInTheDocument()
  await userEvent.click(screen.getByTestId('medicine-m1'))
  expect(within(await screen.findByRole('dialog', { name: en.medicines.history.title })).getByText(text(en.medicines.page.fixed, { times: '09:00, 21:00' }))).toBeInTheDocument()
  for (const name of [en.medicines.page.add, en.medicines.page.edit, en.medicines.page.delete]) {
    expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
  }
})

test('delete needs a second confirm', async () => {
  const calls = mockApi({ ...base([med()]), 'DELETE /api/medicines/m1': { body: { ok: true } } })
  renderApp(<MedicinesPage />, '/medicines')
  await userEvent.click(await screen.findByTestId('medicine-m1'))
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

const sos = (over: object = {}) =>
  med({ id: 's1', name: 'Paracetamol', dose_amount: 1.5, dose_unit: 'ml', schedule_kind: 'as_needed', times: [], min_gap_hours: null, ...over })
const section = (name: string) => screen.getByRole('region', { name })

test('the page has active, SOS and past medicines, each in its own section', async () => {
  mockApi(base([med(), sos(), med({ id: 'm2', name: 'Old antibiotic', ended: true })]))
  renderApp(<MedicinesPage />, '/medicines')
  await screen.findByText(/Vitamin D/)
  expect(within(section(en.medicines.page.active)).getByText(/Vitamin D/)).toBeInTheDocument()
  expect(within(section(en.medicines.page.sos)).getByText(/Paracetamol/)).toBeInTheDocument()
  expect(within(section(en.medicines.page.past)).getByText(/Old antibiotic/)).toBeInTheDocument()
  expect(within(section(en.medicines.page.active)).queryByText(/Paracetamol/)).not.toBeInTheDocument()
})

test('a caregiver gives an SOS dose from the medicines page', async () => {
  const calls = mockApi({
    ...base([sos()], { ...ME_ADMIN, role: 'caregiver' }),
    'POST /api/medicines/s1/doses': { status: 201, body: { id: 'x', by_name: 'Owner', gap_warning: null, slot: null } },
  })
  renderApp(<MedicinesPage />, '/medicines')
  const sosSection = await screen.findByRole('region', { name: en.medicines.page.sos })
  // like every other medicine on the page: a tile that opens a popup, no dose buttons on the page itself
  expect(within(sosSection).queryByRole('button', { name: en.medicines.giveFull })).not.toBeInTheDocument()
  await userEvent.click(within(sosSection).getByTestId('medicine-s1'))
  const d = await screen.findByRole('dialog', { name: en.medicines.history.title })
  await userEvent.click(within(d).getByRole('button', { name: en.medicines.giveFull }))
  await waitFor(() => expect(calls.find((c) => c.key === 'POST /api/medicines/s1/doses')?.body).toMatchObject({ status: 'given', amount: 1.5 }))
})

test('the popup of a scheduled, past or viewer-seen SOS medicine has no give buttons', async () => {
  mockApi(base([med(), sos({ id: 's2', ended: true })]))
  renderApp(<MedicinesPage />, '/medicines')
  for (const id of ['medicine-m1', 'medicine-s2']) {
    await userEvent.click(await screen.findByTestId(id))
    const d = await screen.findByRole('dialog', { name: en.medicines.history.title })
    expect(within(d).queryByTestId('sos-give')).not.toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  }
})

test('End now needs a second tap, then ends the medicine', async () => {
  const calls = mockApi({ ...base([med()]), 'POST /api/medicines/m1/end': { body: med({ ended: true, ended_at: new Date().toISOString() }) } })
  renderApp(<MedicinesPage />, '/medicines')
  await userEvent.click(await screen.findByTestId('medicine-m1'))
  const d = await screen.findByRole('dialog', { name: en.medicines.history.title })
  await userEvent.click(within(d).getByRole('button', { name: en.medicines.page.endNow }))
  expect(calls.some((c) => c.key === 'POST /api/medicines/m1/end')).toBe(false)
  await userEvent.click(within(d).getByRole('button', { name: en.medicines.page.confirmEnd }))
  await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/medicines/m1/end')).toBe(true))
})

test('a medicine ended early says when, and the admin can resume it', async () => {
  const endedAt = new Date(2026, 10, 9, 15, 0).toISOString()
  const calls = mockApi({ ...base([med({ ended: true, ended_at: endedAt })]), 'POST /api/medicines/m1/resume': { body: med() } })
  renderApp(<MedicinesPage />, '/medicines')
  await userEvent.click(await screen.findByTestId('medicine-m1'))
  const d = await screen.findByRole('dialog', { name: en.medicines.history.title })
  expect(within(d).getByText(text(en.medicines.page.endedOn, { date: '2026-11-09' }))).toBeInTheDocument()
  expect(within(d).queryByRole('button', { name: en.medicines.page.endNow })).not.toBeInTheDocument()
  await userEvent.click(within(d).getByRole('button', { name: en.medicines.page.resume }))
  await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/medicines/m1/resume')).toBe(true))
})

test('a caregiver cannot end or resume a medicine', async () => {
  mockApi(base([med(), med({ id: 'm2', name: 'Iron', ended: true, ended_at: new Date().toISOString() })], { ...ME_ADMIN, role: 'caregiver' }))
  renderApp(<MedicinesPage />, '/medicines')
  await userEvent.click(await screen.findByTestId('medicine-m1'))
  await screen.findByRole('dialog', { name: en.medicines.history.title })
  expect(screen.queryByRole('button', { name: en.medicines.page.endNow })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: en.medicines.page.resume })).not.toBeInTheDocument()
})

test('past medicines are newest first, by when they ended', async () => {
  mockApi(base([
    med({ id: 'p1', name: 'First course', ended: true, end_date: '2026-10-01' }),
    med({ id: 'p2', name: 'Stopped early', ended: true, end_date: null, ended_at: new Date(2026, 10, 9, 15).toISOString() }),
    med({ id: 'p3', name: 'Second course', ended: true, end_date: '2026-10-20' }),
  ]))
  renderApp(<MedicinesPage />, '/medicines')
  await screen.findByText(/First course/)
  const ids = within(screen.getByRole('region', { name: en.medicines.page.past })).getAllByTestId(/^medicine-p/).map((el) => el.dataset.testid)
  expect(ids).toEqual(['medicine-p2', 'medicine-p3', 'medicine-p1'])
})

test('editing prefills the form and PATCHes the change', async () => {
  const calls = mockApi({ ...base([med()]), 'PATCH /api/medicines/m1': { body: med({ dose_amount: 7.5, dose_unit: 'mg' }) } })
  renderApp(<MedicinesPage />, '/medicines')
  await userEvent.click(await screen.findByTestId('medicine-m1'))
  await userEvent.click(await screen.findByRole('button', { name: en.medicines.page.edit }))
  expect(screen.getByLabelText(en.medicines.form.name)).toHaveValue('Vitamin D')
  expect(screen.getByLabelText(text(en.medicines.form.timeN, { n: '2' }))).toHaveTextContent('9:00 PM')
  expect(screen.getByLabelText(en.medicines.form.doseAmount)).toHaveValue(5)
  expect(screen.getByLabelText(en.medicines.form.doseUnit)).toHaveValue('drops')
  const amount = screen.getByLabelText(en.medicines.form.doseAmount)
  await userEvent.clear(amount)
  await userEvent.type(amount, '7.5')
  await userEvent.selectOptions(screen.getByLabelText(en.medicines.form.doseUnit), 'mg')
  await save()
  await waitFor(() =>
    expect(calls.find((c) => c.key === 'PATCH /api/medicines/m1')?.body).toMatchObject({ dose_amount: 7.5, dose_unit: 'mg', schedule_kind: 'fixed' }),
  )
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


test('a dose amount of 0, three decimals, nothing, or no unit is refused before sending', async () => {
  const calls = mockApi({ ...base(), 'POST /api/medicines': created })
  renderApp(<MedicinesPage />, '/medicines')
  await openForm()
  await userEvent.type(screen.getByLabelText(en.medicines.form.name), 'Syrup')
  const amount = screen.getByLabelText(en.medicines.form.doseAmount)
  const unit = screen.getByLabelText(en.medicines.form.doseUnit)
  await userEvent.selectOptions(unit, 'ml')
  for (const bad of ['', '0', '0.001', '1.005', '-1', '10001']) {
    await userEvent.clear(amount)
    if (bad) await userEvent.type(amount, bad)
    await save()
    expect(await screen.findByText(en.medicines.form.invalid), `amount "${bad}"`).toBeInTheDocument()
  }
  await userEvent.clear(amount)
  await userEvent.type(amount, '1')
  await userEvent.selectOptions(unit, '') // back to the placeholder: no unit chosen
  await save()
  expect(await screen.findByText(en.medicines.form.invalid)).toBeInTheDocument()
  expect(calls.some((c) => c.key === 'POST /api/medicines')).toBe(false)
})

test('the unit list offers all eight units and a placeholder', async () => {
  mockApi(base())
  renderApp(<MedicinesPage />, '/medicines')
  await openForm()
  const options = [...screen.getByLabelText(en.medicines.form.doseUnit).querySelectorAll('option')].map((o) => o.getAttribute('value'))
  expect(options).toEqual(['', ...DOSE_UNITS])
})

test('cards show the dose with its unit', async () => {
  mockApi(base([med({ dose_amount: 0.25, dose_unit: 'ml' }), med({ id: 'm2', name: 'Iron', dose_amount: 1, dose_unit: 'drops' })]))
  renderApp(<MedicinesPage />, '/medicines')
  expect(await screen.findByText('Vitamin D · 0.25 ml')).toBeInTheDocument()
  expect(screen.getByText('Iron · 1 drop')).toBeInTheDocument()
})

test('a medicine saved before structured doses asks for a dose, and editing requires one', async () => {
  const calls = mockApi({ ...base([med({ dose_amount: null, dose_unit: null })]), 'PATCH /api/medicines/m1': { body: med() } })
  renderApp(<MedicinesPage />, '/medicines')
  expect(await screen.findByText(en.medicines.page.setDose)).toBeInTheDocument()
  await userEvent.click(screen.getByTestId('medicine-m1'))
  await userEvent.click(screen.getByRole('button', { name: en.medicines.page.edit }))
  expect(screen.getByLabelText(en.medicines.form.doseAmount)).toHaveValue(null)
  await save()
  expect(await screen.findByText(en.medicines.form.invalid)).toBeInTheDocument()
  expect(calls.some((c) => c.key === 'PATCH /api/medicines/m1')).toBe(false)
  await userEvent.type(screen.getByLabelText(en.medicines.form.doseAmount), '5')
  await userEvent.selectOptions(screen.getByLabelText(en.medicines.form.doseUnit), 'drops')
  await save()
  await waitFor(() => expect(calls.find((c) => c.key === 'PATCH /api/medicines/m1')?.body).toMatchObject({ dose_amount: 5, dose_unit: 'drops' }))
})

test('the set-a-dose notice is only for the admin', async () => {
  mockApi(base([med({ dose_amount: null, dose_unit: null })], { ...ME_ADMIN, role: 'caregiver' }))
  renderApp(<MedicinesPage />, '/medicines')
  await screen.findByText(/Vitamin D/)
  expect(screen.queryByText(en.medicines.page.setDose)).not.toBeInTheDocument()
})

test('medicines are square tiles, two per row', async () => {
  mockApi(base([med(), med({ id: 'm2', name: 'Iron' })]))
  renderApp(<MedicinesPage />, '/medicines')
  const grid = await screen.findByTestId('medicine-tiles')
  expect(grid.className).toContain('grid-cols-2')
  for (const id of ['m1', 'm2']) expect(screen.getByTestId(`medicine-${id}`).className).toContain('aspect-square')
})

test('tapping a tile opens its dose history, with edit and delete for the medicine', async () => {
  mockApi(base([med()]))
  renderApp(<MedicinesPage />, '/medicines')
  await userEvent.click(await screen.findByTestId('medicine-m1'))
  const d = await screen.findByRole('dialog', { name: en.medicines.history.title })
  expect(within(d).getByText('Vitamin D')).toBeInTheDocument()
  for (const name of [en.medicines.page.edit, en.medicines.page.delete]) expect(within(d).getByRole('button', { name })).toBeInTheDocument()
})

test('Add medicine and Add SOS medicine open the form as a popup', async () => {
  mockApi(base())
  renderApp(<MedicinesPage />, '/medicines')
  await userEvent.click(await screen.findByRole('button', { name: en.medicines.page.add }))
  const d = await screen.findByRole('dialog', { name: en.medicines.page.add })
  expect(within(d).getByLabelText(en.medicines.form.name)).toBeInTheDocument()
  await userEvent.click(within(d).getByRole('button', { name: en.medicines.form.cancel }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: en.medicines.page.addSos }))
  expect(await screen.findByRole('dialog', { name: en.medicines.page.addSos })).toBeInTheDocument()
})

test('saving the popup form closes it', async () => {
  mockApi({ ...base(), 'POST /api/medicines': created })
  renderApp(<MedicinesPage />, '/medicines')
  await openForm()
  await fillBasics()
  await save()
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})
