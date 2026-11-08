import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { cloneElement, type ReactElement } from 'react'
import BulkVitals from '../components/BulkVitals'
import { GrowthTooltipContent } from '../components/GrowthChart'
import en from '../i18n/en.json'
import { ME_ADMIN, mockApi, renderApp } from '../test/utils'
import VitalsCharts from './VitalsCharts'

vi.mock('recharts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('recharts')>()
  return {
    ...mod,
    // jsdom has no layout: give charts a fixed size
    ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) => (
      <div style={{ width: 400, height: 300 }}>{cloneElement(children, { width: 400, height: 300 })}</div>
    ),
  }
})

const curve = (start: number) => Array.from({ length: 61 }, (_, m) => [m, start + m * 0.2])
const GROWTH = {
  birth_date: '2026-10-23',
  source: { name: 'WHO Child Growth Standards: weight-for-age, girls', url: 'https://www.who.int/x', retrieved_on: '2026-11-08' },
  curves: { '3': curve(2.4), '15': curve(2.8), '50': curve(3.2), '85': curve(3.7), '97': curve(4.2) },
  points: [
    { id: 'a', measured_at: '2026-10-24T05:00:00Z', age_months: 0.03, value: 3.1, percentile: 45.2, place_kind: 'hospital' as const },
    { id: 'b', measured_at: '2026-11-07T05:00:00Z', age_months: 0.49, value: 3.5, percentile: 55.0, place_kind: 'home' as const },
  ],
}
const VITAL = (id: string, place: string, temperature_c: number, hours: number) => ({
  id, measured_at: new Date(Date.now() - hours * 3600_000).toISOString(), place_kind: place, place_name: '',
  measured_by: '', note: '', weight_kg: null, height_cm: null, head_cm: null, temperature_c, heart_rate: null,
  resp_rate: null, spo2: null, entered_by_name: 'Mom',
})

const routes = (growth: object | null = GROWTH) => ({
  'GET /api/me': { body: ME_ADMIN },
  'GET /api/vitals/growth/weight': growth ? { body: growth } : { status: 409, body: { detail: 'birth date not set' } },
  'GET /api/vitals/growth/height': growth ? { body: growth } : { status: 409, body: { detail: 'birth date not set' } },
  'GET /api/vitals/growth/head': growth ? { body: growth } : { status: 409, body: { detail: 'birth date not set' } },
  'GET /api/vitals': { body: [VITAL('t1', 'home', 36.8, 5), VITAL('t2', 'hospital', 38.4, 3)] },
})

const weightChart = () => screen.findByRole('figure', { name: en.vitals.charts.growth.weight })

test('weight chart draws five percentile lines and the child\'s points', async () => {
  mockApi(routes())
  renderApp(<VitalsCharts />)
  const chart = await weightChart()
  await waitFor(() => expect(chart.querySelectorAll('[data-curve]').length).toBe(5))
  expect(chart.querySelectorAll('[data-point]').length).toBe(2)
  expect(within(chart).getByText(/WHO Child Growth Standards/)).toBeInTheDocument()
  expect(within(chart).getByRole('link', { name: /who\.int/ })).toHaveAttribute('href', 'https://www.who.int/x')
  expect(within(chart).getByText(/2026-11-08/)).toBeInTheDocument()
})

test('points are coloured by place and the tooltip shows percentile', async () => {
  mockApi(routes())
  renderApp(<VitalsCharts />)
  const chart = await weightChart()
  await waitFor(() => expect(chart.querySelectorAll('[data-point]').length).toBe(2))
  const fill = (place: string) => chart.querySelector(`[data-point="${place}"]`)?.getAttribute('fill')
  expect(fill('hospital')).toBeTruthy()
  expect(fill('hospital')).not.toBe(fill('home'))
  const tip = render(<GrowthTooltipContent active payload={[{ payload: { ...GROWTH.points[0], month: 0.03 } }]} unit="kg" />)
  const box = within(tip.container)
  expect(box.getByText(/45\.2/)).toBeInTheDocument()
  expect(box.getByText(/3\.1 kg/)).toBeInTheDocument()
  expect(box.getByText(new RegExp(en.vitals.places.hospital))).toBeInTheDocument()
})

test('missing birth date shows the settings hint', async () => {
  mockApi(routes(null))
  renderApp(<VitalsCharts />)
  const links = await screen.findAllByRole('link', { name: en.vitals.charts.noBirthDateLink })
  expect(links[0]).toHaveAttribute('href', '/settings')
  expect(screen.getAllByText(en.vitals.charts.noBirthDate).length).toBe(3)
})

test('temperature chart has the fever line labelled as information', async () => {
  mockApi(routes())
  renderApp(<VitalsCharts />)
  const chart = await screen.findByRole('figure', { name: en.vitals.measurements.temperature_c })
  await waitFor(() => expect(within(chart).getByText(en.vitals.charts.feverLine)).toBeInTheDocument())
  expect(en.vitals.charts.feverLine).toMatch(/information/i)
})

test('place filter hides hospital readings', async () => {
  mockApi(routes())
  renderApp(<VitalsCharts />)
  const chart = await weightChart()
  await waitFor(() => expect(chart.querySelectorAll('[data-point]').length).toBe(2))
  const temp = await screen.findByRole('figure', { name: en.vitals.measurements.temperature_c })
  await waitFor(() => expect(temp.querySelectorAll('[data-point]').length).toBe(2))
  await userEvent.click(screen.getByRole('button', { name: en.vitals.places.hospital, pressed: true }))
  await waitFor(() => expect(chart.querySelectorAll('[data-point]').length).toBe(1))
  expect(chart.querySelector('[data-point="hospital"]')).toBeNull()
  await waitFor(() => expect(temp.querySelectorAll('[data-point]').length).toBe(1))
})

const cell = (row: number, col: string) => screen.getByLabelText(`${col} ${row + 1}`)

test('bulk table validates rows and blocks saving on errors', async () => {
  const calls = mockApi({ 'POST /api/vitals/bulk': { status: 201, body: { created: 1, existing: 0, entries: [] } } })
  renderApp(<BulkVitals />)
  await userEvent.type(cell(0, en.vitals.bulk.date), '2026-10-30')
  await userEvent.type(cell(0, en.vitals.measurements.temperature_c), '98.6')
  await userEvent.click(screen.getByRole('button', { name: en.vitals.bulk.addRow }))
  await userEvent.type(cell(1, en.vitals.bulk.date), '2026-10-31')
  await userEvent.click(screen.getByRole('button', { name: en.vitals.bulk.save }))
  expect(await screen.findByText(/Fahrenheit/)).toBeInTheDocument()
  expect(screen.getByText(en.vitals.errors.none)).toBeInTheDocument()
  expect(calls.some((c) => c.key === 'POST /api/vitals/bulk')).toBe(false)
})

test('bulk saves all rows with one request and shows server row errors', async () => {
  const calls = mockApi({
    'POST /api/vitals/bulk': {
      status: 422,
      body: { detail: 'some rows are not valid', errors: [{ index: 1, detail: 'a reading cannot be before the birth date' }] },
    },
  })
  renderApp(<BulkVitals />)
  await userEvent.type(cell(0, en.vitals.bulk.date), '2026-10-30')
  await userEvent.type(cell(0, en.vitals.measurements.weight_kg), '3.1')
  await userEvent.click(screen.getByRole('button', { name: en.vitals.bulk.addRow }))
  await userEvent.type(cell(1, en.vitals.bulk.date), '2026-10-01')
  await userEvent.type(cell(1, en.vitals.measurements.weight_kg), '3.0')
  await userEvent.selectOptions(cell(1, en.vitals.bulk.place), 'hospital')
  await userEvent.click(screen.getByRole('button', { name: en.vitals.bulk.save }))
  expect(await screen.findByText('a reading cannot be before the birth date')).toBeInTheDocument()
  const posts = calls.filter((c) => c.key === 'POST /api/vitals/bulk')
  expect(posts).toHaveLength(1)
  const entries = (posts[0].body as { entries: Record<string, unknown>[] }).entries
  expect(entries).toHaveLength(2)
  expect(entries[1]).toMatchObject({ weight_kg: 3, place_kind: 'hospital' })
  expect(new Date(String(entries[0].measured_at)).getDate()).toBe(30)
  // a retry re-sends the same ids, so nothing is duplicated on the server
  await userEvent.click(screen.getByRole('button', { name: en.vitals.bulk.save }))
  await waitFor(() => expect(calls.filter((c) => c.key === 'POST /api/vitals/bulk')).toHaveLength(2))
  const again = (calls.filter((c) => c.key === 'POST /api/vitals/bulk')[1].body as { entries: { id: string }[] }).entries
  expect(again.map((e) => e.id)).toEqual(entries.map((e) => e.id))
})

test('pasting tab-separated rows fills the table', async () => {
  mockApi({})
  renderApp(<BulkVitals />)
  const text = '2026-10-24\t09:00\thospital\t3.1\t49\t34\t\t\t\t\n2026-11-01\t10:30\thome\t3.3\t\t\t36.9\t\t\t98'
  fireEvent.paste(screen.getByLabelText(en.vitals.bulk.pasteHere), { clipboardData: { getData: () => text } })
  expect(cell(0, en.vitals.bulk.date)).toHaveValue('2026-10-24')
  expect(cell(0, en.vitals.bulk.place)).toHaveValue('hospital')
  expect(cell(0, en.vitals.measurements.height_cm)).toHaveValue(49)
  expect(cell(1, en.vitals.bulk.time)).toHaveValue('10:30')
  expect(cell(1, en.vitals.measurements.temperature_c)).toHaveValue(36.9)
  expect(cell(1, en.vitals.measurements.spo2)).toHaveValue(98)
})

test('bulk shows a message when the whole request is refused or there is no connection', async () => {
  mockApi({ 'POST /api/vitals/bulk': { status: 422, body: { detail: 'at most 200 rows at a time' } } })
  renderApp(<BulkVitals />)
  await userEvent.type(cell(0, en.vitals.bulk.date), '2026-10-30')
  await userEvent.type(cell(0, en.vitals.measurements.weight_kg), '3.1')
  await userEvent.click(screen.getByRole('button', { name: en.vitals.bulk.save }))
  expect(await screen.findByText('at most 200 rows at a time')).toBeInTheDocument()
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
  await userEvent.click(screen.getByRole('button', { name: en.vitals.bulk.save }))
  expect(await screen.findByText(en.vitals.bulk.offline)).toBeInTheDocument()
})
