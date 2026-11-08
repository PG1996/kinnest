import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import en from '../i18n/en.json'
import { ME_ADMIN, ME_VIEWER, mockApi, renderApp } from '../test/utils'
import Home from './Home'
import VisitsTab from './VisitsTab'

const hours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()
const VISIT = (id: string, over: object = {}) => ({
  id, scheduled_at: hours(24), doctor: `Dr ${id}`, place: 'City Clinic', reason: 'check-up', status: 'upcoming',
  notes: '', prescription_notes: '', ...over,
})
const LIST = [
  VISIT('soon', { scheduled_at: hours(3) }),
  VISIT('later', { scheduled_at: hours(72) }),
  VISIT('recent', { scheduled_at: hours(-5), status: 'done', notes: 'all fine', prescription_notes: 'Vit D' }),
  VISIT('old', { scheduled_at: hours(-200), status: 'cancelled' }),
]
const routes = (visits: object[] = LIST, me = ME_ADMIN) => ({
  'GET /api/me': { body: me },
  'GET /api/visits': { body: visits },
  'POST /api/visits': (b: unknown) => ({ status: 201, body: { ...VISIT('new'), ...(b as object) } }),
  'PATCH /api/visits/soon': (b: unknown) => ({ body: { ...LIST[0], ...(b as object) } }),
  'DELETE /api/visits/soon': { body: { ok: true } },
})
const item = (doctor: string) => screen.getByText(new RegExp(doctor)).closest('li') as HTMLElement

test('adds an upcoming visit and posts the right body', async () => {
  const calls = mockApi(routes([]))
  renderApp(<VisitsTab />)
  await userEvent.click(await screen.findByRole('button', { name: en.visits.add }))
  const dialog = screen.getByRole('dialog')
  await userEvent.clear(within(dialog).getByLabelText(en.visits.form.when))
  await userEvent.type(within(dialog).getByLabelText(en.visits.form.when), '2027-01-05T10:30')
  await userEvent.type(within(dialog).getByLabelText(en.visits.form.doctor), 'Dr Rao')
  await userEvent.type(within(dialog).getByLabelText(en.visits.form.place), 'City Clinic')
  await userEvent.type(within(dialog).getByLabelText(en.visits.form.reason), '10 week check')
  await userEvent.click(within(dialog).getByRole('button', { name: en.visits.form.save }))
  await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/visits')).toBe(true))
  const body = calls.find((c) => c.key === 'POST /api/visits')!.body as Record<string, string>
  expect(body).toMatchObject({ doctor: 'Dr Rao', place: 'City Clinic', reason: '10 week check' })
  expect(new Date(body.scheduled_at).getTime()).toBe(new Date('2027-01-05T10:30').getTime())
})

test('lists order upcoming and past', async () => {
  mockApi(routes())
  renderApp(<VisitsTab />)
  const upcoming = (await screen.findByRole('heading', { name: en.visits.upcoming })).closest('section') as HTMLElement
  const past = screen.getByRole('heading', { name: en.visits.past }).closest('section') as HTMLElement
  const order = (el: HTMLElement) => within(el).getAllByRole('listitem').map((li) => li.textContent)
  expect(order(upcoming)[0]).toMatch(/Dr soon/)
  expect(order(upcoming)[1]).toMatch(/Dr later/)
  expect(order(past)[0]).toMatch(/Dr recent/)
  expect(order(past)[1]).toMatch(/Dr old/)
  expect(within(past).getByText(en.visits.status.cancelled)).toBeInTheDocument()
})

test('mark done saves notes and prescription notes', async () => {
  const calls = mockApi(routes())
  renderApp(<VisitsTab />)
  await screen.findByText(/Dr soon/)
  await userEvent.click(within(item('Dr soon')).getByRole('button', { name: en.visits.markDone }))
  const dialog = screen.getByRole('dialog')
  await userEvent.type(within(dialog).getByLabelText(en.visits.form.notes), 'weight good')
  await userEvent.type(within(dialog).getByLabelText(en.visits.form.prescription), 'Vit D 400 IU')
  await userEvent.click(within(dialog).getByRole('button', { name: en.visits.form.save }))
  await waitFor(() =>
    expect(calls.find((c) => c.key === 'PATCH /api/visits/soon')?.body).toEqual({
      status: 'done', notes: 'weight good', prescription_notes: 'Vit D 400 IU',
    }),
  )
})

test('cancel and delete (two-step)', async () => {
  const calls = mockApi(routes())
  renderApp(<VisitsTab />)
  await screen.findByText(/Dr soon/)
  await userEvent.click(within(item('Dr soon')).getByRole('button', { name: en.visits.cancelVisit }))
  await waitFor(() => expect(calls.find((c) => c.key === 'PATCH /api/visits/soon')?.body).toEqual({ status: 'cancelled' }))
  await userEvent.click(within(item('Dr soon')).getByRole('button', { name: en.visits.delete }))
  expect(calls.some((c) => c.key === 'DELETE /api/visits/soon')).toBe(false)
  await userEvent.click(within(item('Dr soon')).getByRole('button', { name: en.visits.confirmDelete }))
  await waitFor(() => expect(calls.some((c) => c.key === 'DELETE /api/visits/soon')).toBe(true))
})

test('Add medicine opens the medicines form', async () => {
  mockApi({ ...routes(), 'GET /api/medicines': { body: [] } })
  renderApp(<App />, '/health?tab=visits')
  await screen.findByText(/Dr recent/)
  await userEvent.click(within(item('Dr recent')).getByRole('link', { name: en.visits.addMedicine }))
  expect(await screen.findByLabelText(en.medicines.form.name)).toBeInTheDocument()
})

test('Home card shows what is coming in 7 days and overdue vaccines', async () => {
  const summary = {
    last_feed: null, next_feed_due_at: null, last_diaper: null, feeds_today: 0,
    diapers_today: { wet: 0, dirty: 0, both: 0 }, sleep: { open: null, last: null },
  }
  const vax = (id: string, days: number, over: object = {}) => ({
    id, name: id, dose_label: '1', due_date: '2026-11-20', given_on: null, status: 'pending', place: '', notes: '',
    source: 'uip', overdue: days < 0, days_until: days, ...over,
  })
  mockApi({
    'GET /api/me': { body: ME_ADMIN },
    'GET /api/summary': { body: summary },
    'GET /api/medicines': { body: [] },
    'GET /api/vaccines': { body: [vax('Late', -2), vax('Soon', 4), vax('Far', 40), vax('Given', 1, { status: 'given' })] },
    'GET /api/visits': { body: [VISIT('soon'), VISIT('far', { scheduled_at: hours(24 * 10) })] },
  })
  renderApp(<Home />)
  const card = await screen.findByRole('region', { name: en.upcoming.title })
  expect(within(card).getByText(/Late 1/)).toBeInTheDocument()
  expect(within(card).getByText(/Soon 1/)).toBeInTheDocument()
  expect(within(card).getByText(/Dr soon/)).toBeInTheDocument()
  expect(within(card).queryByText(/Far 1/)).not.toBeInTheDocument()
  expect(within(card).queryByText(/Given 1/)).not.toBeInTheDocument()
  expect(within(card).queryByText(/Dr far/)).not.toBeInTheDocument()
  expect(within(card).getByText(/Late 1/).closest('a')).toHaveAttribute('href', '/health?tab=vaccines')
})

test('notification links open the right tab', async () => {
  for (const [log, tab] of [['vaccine', en.health.tabs.vaccines], ['visit', en.health.tabs.visits]] as const) {
    mockApi({
      'GET /api/me': { body: ME_ADMIN },
      'GET /api/summary': { status: 500 },
      'GET /api/visits': { body: [] },
      'GET /api/vaccines': { body: [] },
      'GET /api/kid': { body: { birth_date: null } },
      'GET /api/vaccines/templates': { body: [] },
    })
    const view = renderApp(<App />, `/?log=${log}`)
    expect(await screen.findByRole('tab', { name: tab, selected: true })).toBeInTheDocument()
    view.unmount()
  }
})

test('viewer sees no buttons', async () => {
  mockApi(routes(LIST, ME_VIEWER))
  renderApp(<VisitsTab />)
  await screen.findByText(/Dr soon/)
  for (const name of [en.visits.add, en.visits.markDone, en.visits.cancelVisit, en.visits.delete, en.visits.edit])
    expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: en.visits.addMedicine })).not.toBeInTheDocument()
})

test('a cancelled visit can be put back to upcoming', async () => {
  const calls = mockApi({ ...routes([VISIT('soon', { status: 'cancelled' })]) })
  renderApp(<VisitsTab />)
  await screen.findByText(/Dr soon/)
  await userEvent.click(within(item('Dr soon')).getByRole('button', { name: en.visits.restore }))
  await waitFor(() => expect(calls.find((c) => c.key === 'PATCH /api/visits/soon')?.body).toEqual({ status: 'upcoming' }))
})
