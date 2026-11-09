import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { cloneElement, type ReactElement } from 'react'
import App from '../App'
import en from '../i18n/en.json'
import { ME_ADMIN, mockApi, renderApp } from '../test/utils'

vi.mock('recharts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('recharts')>()
  return {
    ...mod,
    ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) => (
      <div style={{ width: 400, height: 300 }}>{cloneElement(children, { width: 400, height: 300 })}</div>
    ),
  }
})

const VITAL = (over: object = {}) => ({
  id: 'v1', measured_at: new Date(Date.now() - 3_600_000).toISOString(), place_kind: 'home', place_name: '', measured_by: '', note: '',
  weight_kg: null, height_cm: null, head_cm: null, temperature_c: 37, heart_rate: null, resp_rate: null, spo2: null, entered_by_name: 'Mom', ...over,
})
const api = (vitals: object[] = [VITAL()]) => ({
  'GET /api/me': { body: ME_ADMIN },
  'GET /api/summary': { status: 500 },
  'GET /api/vitals': { body: vitals },
  'GET /api/vitals/growth/weight': { status: 409, body: {} },
  'GET /api/vitals/growth/height': { status: 409, body: {} },
  'GET /api/vitals/growth/head': { status: 409, body: {} },
  'POST /api/vitals': (b: unknown) => ({ status: 201, body: b }),
  'GET /api/kid': { body: { id: 'k1', name: 'A', birth_date: null, feed_interval_minutes: 180, diaper_alert_minutes: 240 } },
  'GET /api/notification-prefs': { body: { feed: true, diaper: true } },
})
const fahrenheit = () => localStorage.setItem('kinnest.tempUnit', 'F')

test('the add form takes the temperature in °F and stores °C', async () => {
  fahrenheit()
  const calls = mockApi(api([]))
  renderApp(<App />, '/health?tab=vitals')
  await userEvent.click(await screen.findByRole('button', { name: en.vitals.add }))
  const form = screen.getByRole('dialog')
  await userEvent.click(within(form).getByRole('button', { name: en.vitals.measurements.temperature_c }))
  const field = within(form).getByLabelText(/°F/)
  await userEvent.type(field, '99.5')
  await userEvent.click(within(form).getByRole('button', { name: en.vitals.form.save }))
  await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/vitals')).toBe(true))
  expect(calls.find((c) => c.key === 'POST /api/vitals')!.body).toMatchObject({ temperature_c: 37.5 })
})

test('the temperature chart and its tab are in °F with the fever line at 100.4', async () => {
  fahrenheit()
  mockApi(api([VITAL({ temperature_c: 38.4 })]))
  renderApp(<App />, '/health?tab=vitals')
  await waitFor(() => expect(screen.getByRole('tab', { name: new RegExp(en.vitals.measurements.temperature_c) })).toHaveTextContent('101.1'))
  const chart = await screen.findByRole('figure', { name: en.vitals.measurements.temperature_c })
  expect(within(chart).getAllByText(/100\.4 °F/).length).toBeGreaterThanOrEqual(1) // the line label and the note
})

test('the list shows temperatures in °F', async () => {
  fahrenheit()
  mockApi(api())
  renderApp(<App />, '/health?tab=vitals')
  await userEvent.click(await screen.findByRole('radio', { name: en.vitals.charts.list }))
  expect(await screen.findByText(/98\.6 °F/)).toBeInTheDocument()
})

test('settings switch the unit between °F and °C', async () => {
  localStorage.removeItem('kinnest.tempUnit')
  mockApi(api())
  renderApp(<App />, '/family?tab=settings')
  expect(await screen.findByRole('radio', { name: '°F', checked: true })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('radio', { name: '°C' }))
  expect(localStorage.getItem('kinnest.tempUnit')).toBe('C')
})

test('heart rate, breathing rate and SpO2 wait under More vitals in the form', async () => {
  mockApi(api([]))
  renderApp(<App />, '/health?tab=vitals')
  await userEvent.click(await screen.findByRole('button', { name: en.vitals.add }))
  const form = screen.getByRole('dialog')
  expect(within(form).getByRole('button', { name: en.vitals.measurements.weight_kg })).toBeInTheDocument()
  expect(within(form).queryByRole('button', { name: en.vitals.measurements.resp_rate })).not.toBeInTheDocument()
  const more = within(form).getByRole('button', { name: en.vitals.form.more })
  expect(more).toHaveAttribute('aria-expanded', 'false')
  await userEvent.click(more)
  for (const k of ['heart_rate', 'resp_rate', 'spo2'] as const)
    expect(within(form).getByRole('button', { name: en.vitals.measurements[k] })).toBeInTheDocument()
})

test('editing an entry that has a heart rate opens More vitals by itself', async () => {
  mockApi(api([VITAL({ heart_rate: 140 })]))
  renderApp(<App />, '/health?tab=vitals')
  await userEvent.click(await screen.findByRole('radio', { name: en.vitals.charts.list }))
  await userEvent.click(await screen.findByRole('button', { name: en.vitals.list.edit }))
  const form = screen.getByRole('dialog')
  expect(within(form).getByRole('button', { name: en.vitals.measurements.heart_rate, pressed: true })).toBeInTheDocument()
})

test('the charts keep heart rate, breathing rate and SpO2 under More vitals', async () => {
  mockApi(api())
  renderApp(<App />, '/health?tab=vitals')
  await screen.findByRole('figure', { name: en.vitals.measurements.temperature_c })
  expect(screen.queryByRole('figure', { name: en.vitals.measurements.resp_rate })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: en.vitals.charts.more }))
  expect(screen.getByRole('figure', { name: en.vitals.measurements.resp_rate })).toBeInTheDocument()
})
