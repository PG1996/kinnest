import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import en from '../i18n/en.json'
import { enqueue } from '../offline/queue'
import { ME_ADMIN, ME_VIEWER, mockApi, renderApp } from '../test/utils'
import Home from './Home'
import VitalsTab from './VitalsTab'

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString()
const VITAL = (over: object = {}) => ({
  id: 'v1', measured_at: hoursAgo(2), place_kind: 'hospital', place_name: 'City Hospital', measured_by: 'Nurse',
  note: '', weight_kg: 3.42, height_cm: null, head_cm: null, temperature_c: 36.8, heart_rate: null, resp_rate: null,
  spo2: null, entered_by_name: 'Mom', ...over,
})

const routes = (me = ME_ADMIN, vitals: object[] = [VITAL()]) => ({
  'GET /api/me': { body: me },
  'GET /api/vitals': { body: vitals },
  'POST /api/vitals': (b: unknown) => ({ status: 201, body: b }),
  'PATCH /api/vitals/v1': (b: unknown) => ({ body: { ...VITAL(), ...(b as object) } }),
  'DELETE /api/vitals/v1': { body: { ok: true } },
})

const chip = (name: string) => screen.getByRole('button', { name })
const input = (key: keyof typeof en.vitals.measurements) =>
  screen.getByLabelText(new RegExp(`^${en.vitals.measurements[key]}`))

async function openForm() {
  await userEvent.click(await screen.findByRole('button', { name: en.vitals.add }))
  return screen.getByRole('dialog')
}

test('adds a weight and temperature entry with place and posts the right body', async () => {
  const calls = mockApi(routes(ME_ADMIN, []))
  renderApp(<VitalsTab />)
  await openForm()
  await userEvent.click(chip(en.vitals.measurements.weight_kg))
  await userEvent.click(chip(en.vitals.measurements.temperature_c))
  await userEvent.type(input('weight_kg'), '3.42')
  await userEvent.type(input('temperature_c'), '36.8')
  await userEvent.click(chip(en.vitals.places.hospital))
  await userEvent.type(screen.getByLabelText(en.vitals.form.placeName), 'City Hospital')
  await userEvent.type(screen.getByLabelText(en.vitals.form.measuredBy), 'Nurse')
  await userEvent.click(screen.getByRole('button', { name: en.vitals.form.save }))
  await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/vitals')).toBe(true))
  const body = calls.find((c) => c.key === 'POST /api/vitals')!.body as Record<string, unknown>
  expect(body).toMatchObject({
    weight_kg: 3.42, temperature_c: 36.8, place_kind: 'hospital', place_name: 'City Hospital', measured_by: 'Nurse',
  })
  expect(body.height_cm).toBeNull()
  expect(typeof body.id).toBe('string')
  expect(Math.abs(Date.parse(String(body.measured_at)) - Date.now())).toBeLessThan(120_000)
})

test('at least one measurement required', async () => {
  const calls = mockApi(routes(ME_ADMIN, []))
  renderApp(<VitalsTab />)
  await openForm()
  await userEvent.click(screen.getByRole('button', { name: en.vitals.form.save }))
  expect(await screen.findByText(en.vitals.errors.none)).toBeInTheDocument()
  expect(calls.some((c) => c.key === 'POST /api/vitals')).toBe(false)
})

test('shows the range in the error and refuses 98.6', async () => {
  const calls = mockApi(routes(ME_ADMIN, []))
  renderApp(<VitalsTab />)
  await openForm()
  await userEvent.click(chip(en.vitals.measurements.temperature_c))
  expect(screen.getByText(/30.45/)).toBeInTheDocument() // the allowed range is shown beside the input
  await userEvent.type(input('temperature_c'), '98.6')
  await userEvent.click(screen.getByRole('button', { name: en.vitals.form.save }))
  expect(await screen.findByText(/Fahrenheit/)).toBeInTheDocument()
  expect(calls.some((c) => c.key === 'POST /api/vitals')).toBe(false)
})

test('edit prefills and PATCHes', async () => {
  const calls = mockApi(routes())
  renderApp(<VitalsTab />)
  await userEvent.click(await screen.findByRole('button', { name: en.vitals.list.edit }))
  expect(input('weight_kg')).toHaveValue(3.42)
  expect(screen.getByLabelText(en.vitals.form.placeName)).toHaveValue('City Hospital')
  await userEvent.clear(input('weight_kg'))
  await userEvent.type(input('weight_kg'), '3.5')
  await userEvent.click(chip(en.vitals.measurements.temperature_c)) // drop the temperature from this entry
  await userEvent.click(screen.getByRole('button', { name: en.vitals.form.save }))
  await waitFor(() => expect(calls.some((c) => c.key === 'PATCH /api/vitals/v1')).toBe(true))
  expect(calls.find((c) => c.key === 'PATCH /api/vitals/v1')!.body).toMatchObject({ weight_kg: 3.5, temperature_c: null })
})

test('delete needs a second confirm', async () => {
  const calls = mockApi(routes())
  renderApp(<VitalsTab />)
  await userEvent.click(await screen.findByRole('button', { name: en.vitals.list.delete }))
  expect(calls.some((c) => c.key === 'DELETE /api/vitals/v1')).toBe(false)
  await userEvent.click(screen.getByRole('button', { name: en.vitals.list.confirmDelete }))
  await waitFor(() => expect(calls.some((c) => c.key === 'DELETE /api/vitals/v1')).toBe(true))
})

test('filters list by place', async () => {
  mockApi(routes())
  renderApp(<VitalsTab />)
  expect(await screen.findByText(/City Hospital/)).toBeInTheDocument()
  await userEvent.selectOptions(screen.getByLabelText(en.vitals.list.place), 'hospital')
  await waitFor(() =>
    expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u) === '/api/vitals?place_kind=hospital')).toBe(true),
  )
})

test('Home card shows the latest value of each measurement with its place', async () => {
  const summary = {
    last_feed: null, next_feed_due_at: null, last_diaper: null, feeds_today: 0,
    diapers_today: { wet: 0, dirty: 0, both: 0 }, sleep: { open: null, last: null },
    vitals: {
      latest: {
        weight_kg: VITAL({ weight_kg: 4.2 }),
        height_cm: VITAL({ id: 'v2', height_cm: 54, place_kind: 'clinic', place_name: '' }),
        head_cm: null,
        temperature_c: VITAL({ id: 'v3', temperature_c: 36.8, place_kind: 'home', place_name: '' }),
      },
    },
  }
  mockApi({ 'GET /api/me': { body: ME_ADMIN }, 'GET /api/summary': { body: summary }, 'GET /api/medicines': { body: [] } })
  renderApp(<Home />)
  const card = await screen.findByRole('region', { name: en.vitals.card.title })
  expect(within(card).getByText('4.2 kg · 54 cm · 36.8 °C')).toBeInTheDocument()
  expect(within(card).getByText(new RegExp(en.vitals.places.clinic))).toBeInTheDocument()
  expect(within(card).getByText(/City Hospital/)).toBeInTheDocument()
  expect(within(card).getByRole('link', { name: en.vitals.add })).toHaveAttribute('href', '/health?tab=vitals&add=1')
})

test('viewer sees no buttons', async () => {
  mockApi(routes(ME_VIEWER))
  renderApp(<VitalsTab />)
  expect(await screen.findByText(/City Hospital/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: en.vitals.add })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: en.vitals.list.edit })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: en.vitals.list.delete })).not.toBeInTheDocument()
})

test('queued entry shows waiting to sync', async () => {
  await enqueue({
    kind: 'vital', id: 'q1',
    payload: { id: 'q1', measured_at: hoursAgo(1), place_kind: 'home', weight_kg: 3.6 },
  })
  mockApi(routes(ME_ADMIN, []))
  renderApp(<VitalsTab />)
  expect(await screen.findByText(en.vitals.list.waiting)).toBeInTheDocument()
  expect(screen.getByText(/3\.6 kg/)).toBeInTheDocument()
})

test('the add form opens from a link with ?add=1', async () => {
  mockApi(routes(ME_ADMIN, []))
  renderApp(<VitalsTab />, '/health?tab=vitals&add=1')
  expect(await screen.findByRole('dialog')).toBeInTheDocument()
})
