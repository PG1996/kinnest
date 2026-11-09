import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import en from '../i18n/en.json'
import VisitsTab from '../pages/VisitsTab'
import { ME_ADMIN, mockApi, renderApp } from '../test/utils'
import VitalForm from './VitalForm'

const now = new Date()
const todayAt = (h: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), h).toISOString()
const visit = (id: string, at: string, over: object = {}) => ({ id, scheduled_at: at, doctor: 'Dr. Brinda', place: 'Miracle Hospital', reason: 'Colic', status: 'done', notes: '', prescription_notes: '', vitals: [], ...over })
const api = (visits: object[]) => ({ 'GET /api/me': { body: ME_ADMIN }, 'GET /api/visits': { body: visits } })
const save = () => userEvent.click(screen.getByRole('button', { name: en.vitals.form.save }))
const fillWeight = async () => {
  await userEvent.click(screen.getByRole('button', { name: en.vitals.measurements.weight_kg }))
  await userEvent.type(screen.getByLabelText(new RegExp(en.vitals.measurements.weight_kg)), '3.6')
}

test('a reading at home offers no visit', async () => {
  mockApi(api([visit('v1', todayAt(0))]))
  renderApp(<VitalForm onSave={() => {}} />)
  expect(screen.queryByLabelText(en.vitals.form.visit)).not.toBeInTheDocument()
})

test('at a hospital with no visit that day, it asks: no visit by default, or create one', async () => {
  mockApi(api([visit('old', new Date(Date.now() - 5 * 86_400_000).toISOString())]))
  const onSave = vi.fn()
  renderApp(<VitalForm onSave={onSave} />)
  await userEvent.click(screen.getByRole('button', { name: en.vitals.places.hospital }))
  const pick = await screen.findByLabelText(en.vitals.form.visit)
  expect(pick).toHaveValue('')
  expect(within(pick).queryByRole('option', { name: /Dr\. Brinda/ })).not.toBeInTheDocument() // not on this day
  await userEvent.selectOptions(pick, 'new')
  await fillWeight()
  await save()
  expect(onSave.mock.calls[0]![0]).toMatchObject({ create_visit: true, visit_id: null })
})

test('a visit on the same day is offered and chosen already', async () => {
  mockApi(api([visit('v1', todayAt(0))]))
  const onSave = vi.fn()
  renderApp(<VitalForm onSave={onSave} />)
  await userEvent.click(screen.getByRole('button', { name: en.vitals.places.clinic }))
  await waitFor(() => expect(screen.getByLabelText(en.vitals.form.visit)).toHaveValue('v1'))
  await fillWeight()
  await save()
  expect(onSave.mock.calls[0]![0]).toMatchObject({ visit_id: 'v1', create_visit: false })
})

test('choosing No visit sends no link', async () => {
  mockApi(api([visit('v1', todayAt(0))]))
  const onSave = vi.fn()
  renderApp(<VitalForm onSave={onSave} />)
  await userEvent.click(screen.getByRole('button', { name: en.vitals.places.hospital }))
  await waitFor(() => expect(screen.getByLabelText(en.vitals.form.visit)).toHaveValue('v1'))
  await userEvent.selectOptions(screen.getByLabelText(en.vitals.form.visit), '')
  await fillWeight()
  await save()
  expect(onSave.mock.calls[0]![0]).toMatchObject({ visit_id: null, create_visit: false })
})

test('editing keeps the reading on its visit', async () => {
  mockApi(api([visit('v1', todayAt(0)), visit('v2', todayAt(0), { doctor: 'Dr. Rao' })]))
  const initial = { id: 'x', measured_at: todayAt(0), place_kind: 'hospital', place_name: '', measured_by: '', note: '', visit_id: 'v2', weight_kg: 3.4, height_cm: null, head_cm: null, temperature_c: null, heart_rate: null, resp_rate: null, spo2: null } as never
  renderApp(<VitalForm initial={initial} onSave={() => {}} />)
  await waitFor(() => expect(screen.getByLabelText(en.vitals.form.visit)).toHaveValue('v2'))
})

test('a visit card lists the readings taken at it', async () => {
  const reading = { id: 'r1', measured_at: todayAt(0), place_kind: 'hospital', place_name: '', measured_by: '', note: '', visit_id: 'v1', weight_kg: 3.42, height_cm: null, head_cm: null, temperature_c: null, heart_rate: null, resp_rate: null, spo2: null }
  mockApi(api([visit('v1', todayAt(0), { vitals: [reading] })]))
  renderApp(<VisitsTab />)
  const card = await screen.findByTestId('visit-v1')
  expect(within(card).getByText(/3\.42 kg/)).toBeInTheDocument()
})
