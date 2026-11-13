import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import en from '../i18n/en.json'
import { ME_ADMIN, ME_VIEWER, mockApi, renderApp } from '../test/utils'
import VaccinesTab from './VaccinesTab'
import VisitsTab from './VisitsTab'
import VitalsTab from './VitalsTab'

// "today" is Friday 13 November 2026, noon; only the clock is faked, timers run as usual
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 13, 12, 0))
})
afterEach(() => vi.useRealTimers())

const KID = { id: 'k1', name: 'Baby', birth_date: '2026-06-02', feed_interval_minutes: 180, diaper_alert_minutes: 240 }
const at = (m: number, d: number, h = 9) => new Date(2026, m - 1, d, h).toISOString()
const dayName = (m: number, d: number, y = 2026) => new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
const monthName = (m: number, y = 2026) => new Date(y, m - 1, 1).toLocaleDateString([], { month: 'long', year: 'numeric' })
/** A day on the calendar, by the start of its accessible name ("Thursday, November 12: …"). */
const day = (m: number, d: number, y = 2026) => screen.getByRole('button', { name: new RegExp(`^${dayName(m, d, y)}(, today)?: `) })
const calendar = (label: string) => screen.getByRole('region', { name: label })

// --- vitals ------------------------------------------------------------------------------------------------------------

const VITAL = (id: string, over: object) => ({
  id,
  measured_at: at(11, 10),
  place_kind: 'home',
  place_name: '',
  measured_by: '',
  note: '',
  weight_kg: null,
  height_cm: null,
  head_cm: null,
  temperature_c: null,
  heart_rate: null,
  resp_rate: null,
  spo2: null,
  entered_by_name: 'Mom',
  ...over,
})
const VITALS = [
  VITAL('w', { measured_at: at(11, 10), weight_kg: 6.74 }),
  VITAL('f', { measured_at: at(11, 12), place_kind: 'hospital', place_name: 'City Hospital', temperature_c: 38.4 }),
  VITAL('o', { measured_at: at(10, 21, 23), temperature_c: 37.2, note: 'October reading' }),
]
const vitalsRoutes = (me = ME_ADMIN) => ({
  'GET /api/me': { body: me },
  'GET /api/kid': { body: KID },
  'GET /api/vitals': { body: VITALS },
  'GET /api/visits': { body: [] },
  'POST /api/vitals': (b: unknown) => ({ status: 201, body: b }),
})
async function openVitalsCalendar(me = ME_ADMIN) {
  const calls = mockApi(vitalsRoutes(me))
  renderApp(<VitalsTab />)
  await userEvent.click(await screen.findByRole('radio', { name: en.vitals.charts.calendar }))
  await screen.findByRole('heading', { name: en.vitals.calendar.monthTitle.replace('{{month}}', 'November') })
  await waitFor(() => expect(day(11, 10)).toHaveAccessibleName(`${dayName(11, 10)}: 1 reading`))
  return calls
}

test('the vitals calendar asks for every reading and marks the days they were taken, fever days included', async () => {
  const calls = await openVitalsCalendar()
  expect(calls.some((c) => c.url === '/api/vitals?limit=2000')).toBe(true)
  expect(day(11, 12)).toHaveAccessibleName(`${dayName(11, 12)}: 1 reading, ${en.vitals.calendar.fever}`)
  expect(day(11, 11)).toHaveAccessibleName(`${dayName(11, 11)}: ${en.calendar.nothing}`)
  expect(day(11, 13)).toHaveAccessibleName(`${dayName(11, 13)}, ${en.calendar.today}: ${en.calendar.nothing}`)
  // with no day picked, the list holds this month's readings, newest first, and not October's
  expect(screen.getByText(/City Hospital/)).toBeInTheDocument()
  expect(screen.getByText(/6\.74 kg/)).toBeInTheDocument()
  expect(screen.queryByText('October reading')).not.toBeInTheDocument()
  expect(within(calendar(en.vitals.calendar.label)).getByText('2 days with readings')).toBeInTheDocument()
})

test('tapping a day lists only its readings; tapping it again or Show all goes back to the month', async () => {
  await openVitalsCalendar()
  await userEvent.click(day(11, 12))
  expect(day(11, 12)).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('heading', { name: dayName(11, 12) })).toBeInTheDocument()
  expect(screen.getByText(/City Hospital/)).toBeInTheDocument()
  expect(screen.queryByText(/6\.74 kg/)).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: en.calendar.showAll }))
  expect(screen.getByText(/6\.74 kg/)).toBeInTheDocument()
  await userEvent.click(day(11, 10))
  expect(screen.queryByText(/City Hospital/)).not.toBeInTheDocument()
  await userEvent.click(day(11, 10))
  expect(screen.getByText(/City Hospital/)).toBeInTheDocument()
})

test('a reading late at night sits on its own day, and the earlier-entry button jumps over empty months to it', async () => {
  await openVitalsCalendar()
  await userEvent.click(screen.getByRole('button', { name: en.calendar.earlier.replace('{{date}}', dayName(10, 21)) }))
  expect(screen.getByText(monthName(10))).toBeInTheDocument()
  expect(day(10, 21)).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByText('October reading')).toBeInTheDocument()
  // nothing before October: no earlier button, and the later one leads back
  expect(screen.queryByRole('button', { name: new RegExp(`^${en.calendar.earlier.split(',')[0]}`) })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: en.calendar.later.replace('{{date}}', dayName(11, 10)) })).toBeInTheDocument()
})

test('a measurement chip keeps only the days it was taken; a place chip hides that place', async () => {
  await openVitalsCalendar()
  await userEvent.click(screen.getByRole('button', { name: en.vitals.measurements.temperature_c }))
  expect(day(11, 10)).toHaveAccessibleName(`${dayName(11, 10)}: ${en.calendar.nothing}`)
  expect(day(11, 12)).toHaveAccessibleName(new RegExp('1 reading'))
  await userEvent.click(screen.getByRole('button', { name: en.vitals.calendar.all }))
  await userEvent.click(within(screen.getByRole('group', { name: en.vitals.calendar.places })).getByRole('button', { name: en.vitals.places.hospital }))
  expect(day(11, 12)).toHaveAccessibleName(`${dayName(11, 12)}: ${en.calendar.nothing}`)
  expect(screen.queryByText(/City Hospital/)).not.toBeInTheDocument()
})

test('a swipe moves a month; the calendar stops at the month of birth and this month', async () => {
  await openVitalsCalendar()
  expect(screen.getByRole('button', { name: en.calendar.nextMonth })).toBeDisabled()
  const stage = screen.getByTestId('calendar-stage')
  fireEvent.pointerDown(stage, { clientX: 100, clientY: 100 })
  fireEvent.pointerUp(stage, { clientX: 200, clientY: 105 })
  expect(screen.getByText(monthName(10))).toBeInTheDocument()
  for (let i = 0; i < 6; i++) await userEvent.click(screen.getByRole('button', { name: en.calendar.prevMonth }))
  expect(screen.getByText(monthName(6))).toBeInTheDocument() // born 2 June
  expect(screen.getByRole('button', { name: en.calendar.prevMonth })).toBeDisabled()
  expect(screen.queryByRole('button', { name: new RegExp(`^${dayName(6, 1)}: `) })).not.toBeInTheDocument()
})

test('an empty past day offers to add vitals with that day filled in', async () => {
  const calls = await openVitalsCalendar()
  await userEvent.click(day(11, 5))
  await userEvent.click(screen.getByRole('button', { name: en.vitals.calendar.addDay }))
  const dialog = screen.getByRole('dialog')
  await userEvent.click(within(dialog).getByRole('button', { name: en.vitals.measurements.weight_kg }))
  await userEvent.type(within(dialog).getByLabelText(new RegExp(`^${en.vitals.measurements.weight_kg}`)), '6.6')
  await userEvent.click(within(dialog).getByRole('button', { name: en.vitals.form.save }))
  await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/vitals')).toBe(true))
  const when = new Date(String((calls.find((c) => c.key === 'POST /api/vitals')!.body as { measured_at: string }).measured_at))
  expect([when.getMonth(), when.getDate()]).toEqual([10, 5])
})

test('a viewer sees the calendar but no way to add', async () => {
  await openVitalsCalendar(ME_VIEWER)
  await userEvent.click(day(11, 5))
  expect(screen.getByText(en.calendar.emptyDay)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: en.vitals.calendar.addDay })).not.toBeInTheDocument()
})

// --- vaccines ----------------------------------------------------------------------------------------------------------

const VAX = (id: string, over: object) => ({
  id,
  name: `Vaccine ${id}`,
  dose_label: '',
  due_date: '2026-07-14',
  given_on: null,
  status: 'pending',
  place: '',
  notes: '',
  source: 'iap',
  overdue: false,
  days_until: 0,
  ...over,
})
const VACCINES = [
  VAX('a', { status: 'given', given_on: '2026-07-14' }),
  VAX('b', { status: 'given', given_on: '2026-07-14' }),
  VAX('late', { due_date: '2026-08-11', status: 'given', given_on: '2026-08-13' }),
  VAX('over', { due_date: '2026-09-08', overdue: true, days_until: -66 }),
  VAX('next', { due_date: '2026-12-02', days_until: 19 }),
]
async function openVaccines() {
  mockApi({
    'GET /api/me': { body: ME_ADMIN },
    'GET /api/kid': { body: KID },
    'GET /api/vaccines': { body: VACCINES },
    'GET /api/vaccines/templates': { body: [] },
  })
  renderApp(<VaccinesTab />)
  await screen.findByRole('region', { name: en.vaccines.calendar.label })
}

test('vaccines sit on the day given, or the due day until then, and the calendar reaches the next one due', async () => {
  await openVaccines()
  // nothing in November; the later button jumps to the next due day and shows only it
  await userEvent.click(screen.getByRole('button', { name: en.calendar.later.replace('{{date}}', dayName(12, 2)) }))
  expect(day(12, 2)).toHaveAccessibleName(`${dayName(12, 2)}: 1 ${en.vaccines.status.pending.toLowerCase()}`)
  expect(screen.getByText('Vaccine next')).toBeInTheDocument()
  expect(screen.queryByText('Vaccine over')).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: en.vaccines.groups.overdue })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: en.calendar.showAll }))
  expect(screen.getByRole('heading', { name: en.vaccines.groups.overdue })).toBeInTheDocument()
})

test('the year view counts the days per month and opens a month; a given-late vaccine shows on the day given', async () => {
  await openVaccines()
  await userEvent.click(screen.getByRole('button', { name: en.calendar.year }))
  await userEvent.click(screen.getByRole('button', { name: `${monthName(8)}: 1 day with vaccines` }))
  expect(day(8, 13)).toHaveAccessibleName(`${dayName(8, 13)}: 1 ${en.vaccines.status.given.toLowerCase()}`)
  expect(day(8, 11)).toHaveAccessibleName(`${dayName(8, 11)}: ${en.calendar.nothing}`)
  await userEvent.click(screen.getByRole('button', { name: en.calendar.prevMonth }))
  expect(day(7, 14)).toHaveAccessibleName(`${dayName(7, 14)}: 2 ${en.vaccines.status.given.toLowerCase()}`)
  await userEvent.click(day(7, 14))
  expect(screen.getByText('Vaccine a')).toBeInTheDocument()
  expect(screen.getByText('Vaccine b')).toBeInTheDocument()
  expect(screen.getByText(en.vaccines.calendar.count_other.replace('{{count}}', '2'))).toBeInTheDocument()
})

test('a status chip hides those vaccines from the calendar and the list', async () => {
  await openVaccines()
  expect(screen.getByText('Vaccine over')).toBeInTheDocument()
  await userEvent.click(within(screen.getByRole('group', { name: en.vaccines.calendar.statusLabel })).getByRole('button', { name: en.vaccines.status.overdue }))
  expect(screen.queryByText('Vaccine over')).not.toBeInTheDocument()
  expect(screen.getByText('Vaccine next')).toBeInTheDocument()
})

// --- visits ------------------------------------------------------------------------------------------------------------

const VISIT = (id: string, over: object) => ({
  id,
  scheduled_at: at(11, 20, 10),
  doctor: `Dr ${id}`,
  place: 'Clinic',
  reason: 'check-up',
  status: 'upcoming',
  notes: '',
  prescription_notes: '',
  ...over,
})
async function openVisits() {
  const calls = mockApi({
    'GET /api/me': { body: ME_ADMIN },
    'GET /api/kid': { body: KID },
    'GET /api/visits': {
      body: [
        VISIT('next', {}),
        VISIT('fever', { scheduled_at: at(10, 22, 17), status: 'done' }),
        VISIT('moved', { scheduled_at: at(8, 11), status: 'cancelled' }),
      ],
    },
    'POST /api/visits': (b: unknown) => ({ status: 201, body: { ...VISIT('new', {}), ...(b as object) } }),
  })
  renderApp(<VisitsTab />)
  await waitFor(() => expect(day(11, 20)).toHaveAccessibleName(`${dayName(11, 20)}: 1 ${en.visits.status.upcoming.toLowerCase()}`))
  return calls
}

test('visits show on their day; tapping one lists only that visit', async () => {
  await openVisits()
  await userEvent.click(day(11, 20))
  expect(screen.getByText(/Dr next/)).toBeInTheDocument()
  expect(screen.queryByText(/Dr fever/)).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: en.visits.upcoming })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: en.calendar.earlier.replace('{{date}}', dayName(10, 22)) }))
  expect(day(10, 22)).toHaveAccessibleName(`${dayName(10, 22)}: 1 ${en.visits.status.done.toLowerCase()}`)
  expect(screen.getByText(/Dr fever/)).toBeInTheDocument()
})

test('an empty day offers to add a visit on that day', async () => {
  const calls = await openVisits()
  await userEvent.click(day(11, 25))
  await userEvent.click(screen.getByRole('button', { name: en.visits.calendar.addDay }))
  const dialog = screen.getByRole('dialog')
  await userEvent.type(within(dialog).getByLabelText(en.visits.form.doctor), 'Dr Rao')
  await userEvent.click(within(dialog).getByRole('button', { name: en.visits.form.save }))
  await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/visits')).toBe(true))
  const when = new Date((calls.find((c) => c.key === 'POST /api/visits')!.body as { scheduled_at: string }).scheduled_at)
  expect([when.getMonth(), when.getDate()]).toEqual([10, 25])
})
