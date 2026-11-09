import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import en from '../i18n/en.json'
import { ME_ADMIN, ME_VIEWER, mockApi, renderApp } from '../test/utils'

const day = (n: number) => {
  const d = new Date(Date.now() + n * 86_400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const vaccines = [
  { id: 'v1', name: 'BCG', dose_label: '1', due_date: day(-3), given_on: null, status: 'pending', place: '', notes: '', source: 'template', overdue: true, days_until: -3 },
  { id: 'v2', name: 'DTaP', dose_label: '1', due_date: day(5), given_on: null, status: 'pending', place: '', notes: '', source: 'template', overdue: false, days_until: 5 },
  { id: 'v3', name: 'Hep B', dose_label: '0', due_date: day(-14), given_on: day(-14), status: 'given', place: 'City Hospital', notes: '', source: 'template', overdue: false, days_until: -14 },
]
const visits = [
  { id: 'a1', scheduled_at: new Date(Date.now() + 3 * 86_400_000).toISOString(), doctor: 'Dr Rao', place: 'City Clinic', reason: '6 week check', status: 'upcoming', notes: '', prescription_notes: '' },
  { id: 'a2', scheduled_at: new Date(Date.now() - 20 * 86_400_000).toISOString(), doctor: 'Dr Rao', place: 'City Clinic', reason: 'Newborn check', status: 'done', notes: 'All fine', prescription_notes: '' },
]
const medicines = [
  { id: 'm1', name: 'Vitamin D', dose_amount: 1, dose_unit: 'ml', schedule_kind: 'fixed', times: ['09:00'], interval_hours: null, first_dose_at: null, min_gap_hours: null, start_date: '2026-11-01', end_date: null, notes: '', ended: false, slots: [], last_dose: null },
]
const api = (me: object) => ({
  'GET /api/me': { body: me },
  'GET /api/summary': { status: 500 },
  'GET /api/kid': { body: { id: 'k1', name: 'Aanya', birth_date: '2026-10-23', feed_interval_minutes: 180, diaper_alert_minutes: 240 } },
  'GET /api/vaccines': { body: vaccines },
  'GET /api/vaccines/templates': { body: [] },
  'GET /api/visits': { body: visits },
  'GET /api/medicines': { body: medicines },
  'GET /api/vitals': { body: [] },
})

test('vaccines group overdue, soon and done, with the doctor-first note', async () => {
  mockApi(api(ME_ADMIN))
  renderApp(<App />, '/health?tab=vaccines')
  expect(await screen.findByRole('heading', { name: en.vaccines.groups.overdue })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: en.vaccines.groups.soon })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: en.vaccines.groups.done })).toBeInTheDocument()
  expect(screen.getByText(en.vaccines.doctorFirst)).toBeInTheDocument()
  // the overdue entry stands out as a warning card, the given one shows a done mark
  expect(screen.getByTestId('vaccine-v1')).toHaveAttribute('data-tone', 'warn')
  expect(screen.getByTestId('vaccine-v3')).toHaveAttribute('data-done', 'true')
})

test('viewer sees no write controls on vaccines, visits or medicines', async () => {
  mockApi(api(ME_VIEWER))
  const { unmount } = renderApp(<App />, '/health?tab=vaccines')
  await screen.findByText(/BCG/)
  for (const name of [en.vaccines.add, en.vaccines.markGiven, en.vaccines.skip, en.vaccines.edit, en.vaccines.delete])
    expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
  unmount()
  const v = renderApp(<App />, '/health?tab=visits')
  await screen.findByText(/6 week check/)
  for (const name of [en.visits.add, en.visits.markDone, en.visits.edit, en.visits.delete])
    expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
  v.unmount()
  renderApp(<App />, '/health?tab=medicines')
  await screen.findByText(/Vitamin D/)
  expect(screen.queryByRole('button', { name: en.medicines.page.add })).not.toBeInTheDocument()
  await userEvent.click(screen.getByTestId('medicine-m1'))
  expect(screen.queryByRole('button', { name: en.medicines.page.edit })).not.toBeInTheDocument()
})

test('visits show the next visit as a dated card and past visits below', async () => {
  mockApi(api(ME_ADMIN))
  renderApp(<App />, '/health?tab=visits')
  expect(await screen.findByRole('heading', { name: en.visits.upcoming })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: en.visits.past })).toBeInTheDocument()
  expect(screen.getByTestId('visit-a1')).toHaveAttribute('data-tone', 'sleep')
  expect(screen.getByTestId('visit-a2')).toHaveAttribute('data-tone', 'plain')
})

test('medicine cards are tinted and list the schedule', async () => {
  mockApi(api(ME_ADMIN))
  renderApp(<App />, '/health?tab=medicines')
  expect(await screen.findByText(/Vitamin D/)).toBeInTheDocument()
  expect(screen.getByTestId('medicine-m1')).toHaveAttribute('data-tone', 'med')
})
