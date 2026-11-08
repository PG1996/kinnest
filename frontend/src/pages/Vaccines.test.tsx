import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import en from '../i18n/en.json'
import { ME_ADMIN, ME_VIEWER, mockApi, renderApp } from '../test/utils'
import VaccinesTab from './VaccinesTab'

const today = new Date()
const iso = (days: number) => {
  const d = new Date(today)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const KID = (birth: string | null = '2026-10-23') => ({ id: 'k1', name: 'Baby', birth_date: birth, feed_interval_minutes: 180, diaper_alert_minutes: 240 })
const TEMPLATES = [
  { id: 'iap', name: 'India IAP (2025)', description: 'IAP timetable', source_url: 'https://www.indianpediatrics.net/may2026/311.pdf', source_title: 'IAP', source_date: '2026-04-09', retrieved_on: '2026-11-08', count: 40 },
  { id: 'uip', name: 'India UIP (government)', description: 'UIP schedule', source_url: 'https://static.pib.gov.in/x.pdf', source_title: 'PIB', source_date: '2026-03-17', retrieved_on: '2026-11-08', count: 26 },
]
const VAX = (id: string, over: object = {}) => ({
  id, name: `Vaccine ${id}`, dose_label: '1', due_date: iso(10), given_on: null, status: 'pending', place: '', notes: '',
  source: 'uip', overdue: false, days_until: 10, ...over,
})
const LIST = [
  VAX('a', { due_date: iso(-3), overdue: true, days_until: -3 }),
  VAX('b', { due_date: iso(5), days_until: 5 }),
  VAX('c', { due_date: iso(90), days_until: 90 }),
  VAX('d', { status: 'given', given_on: iso(-20), due_date: iso(-20), days_until: -20 }),
]

const routes = (vaccines: object[] = LIST, me = ME_ADMIN, kid = KID()) => ({
  'GET /api/me': { body: me },
  'GET /api/kid': { body: kid },
  'GET /api/vaccines': { body: vaccines },
  'GET /api/vaccines/templates': { body: TEMPLATES },
  'POST /api/vaccines/apply-template': { status: 201, body: { created: 26, entries: [] } },
  'POST /api/vaccines': (b: unknown) => ({ status: 201, body: { ...VAX('new'), ...(b as object) } }),
  'PATCH /api/vaccines/a': (b: unknown) => ({ body: { ...LIST[0], ...(b as object) } }),
  'DELETE /api/vaccines/a': { body: { ok: true } },
})

const entry = (name: string) => screen.getByText(name).closest('li') as HTMLElement

test('picker lists templates with sources and applies the chosen one', async () => {
  const calls = mockApi(routes([]))
  renderApp(<VaccinesTab />)
  const uip = (await screen.findByText(TEMPLATES[1].name)).closest('li') as HTMLElement
  expect(within(uip).getByText(en.vaccines.picker.count.replace('{{count}}', '26'))).toBeInTheDocument()
  expect(within(uip).getByRole('link')).toHaveAttribute('href', TEMPLATES[1].source_url)
  expect(within(uip).getByText(/2026-03-17/)).toBeInTheDocument()
  await waitFor(() => expect(within(uip).getByRole('button', { name: en.vaccines.picker.use })).toBeEnabled())
  await userEvent.click(within(uip).getByRole('button', { name: en.vaccines.picker.use }))
  await waitFor(() =>
    expect(calls.find((c) => c.key === 'POST /api/vaccines/apply-template')?.body).toEqual({ template_id: 'uip', mode: 'fill' }),
  )
  expect(screen.getByRole('button', { name: en.vaccines.picker.empty })).toBeInTheDocument()
})

test('birth date missing disables the picker', async () => {
  mockApi(routes([], ME_ADMIN, KID(null)))
  renderApp(<VaccinesTab />)
  expect(await screen.findByText(en.vaccines.noBirthDate)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: en.vitals.charts.noBirthDateLink })).toHaveAttribute('href', '/settings')
  await screen.findByText(TEMPLATES[0].name)
  for (const b of screen.getAllByRole('button', { name: en.vaccines.picker.use })) expect(b).toBeDisabled()
})

test('list groups overdue, due soon and done', async () => {
  mockApi(routes())
  renderApp(<VaccinesTab />)
  const group = async (title: string) => (await screen.findByRole('heading', { name: title })).closest('section') as HTMLElement
  expect(within(await group(en.vaccines.groups.overdue)).getByText('Vaccine a 1')).toBeInTheDocument()
  expect(within(await group(en.vaccines.groups.soon)).getByText('Vaccine b 1')).toBeInTheDocument()
  expect(within(await group(en.vaccines.groups.later)).getByText('Vaccine c 1')).toBeInTheDocument()
  expect(within(await group(en.vaccines.groups.done)).getByText('Vaccine d 1')).toBeInTheDocument()
  expect(screen.getByText(en.vaccines.doctorFirst)).toBeInTheDocument()
})

test('mark given posts date place and notes', async () => {
  const calls = mockApi(routes())
  renderApp(<VaccinesTab />)
  await screen.findByText('Vaccine a 1')
  await userEvent.click(within(entry('Vaccine a 1')).getByRole('button', { name: en.vaccines.markGiven }))
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByLabelText(en.vaccines.form.givenOn)).toHaveValue(iso(0))
  await userEvent.type(within(dialog).getByLabelText(en.vaccines.form.place), 'City Hospital')
  await userEvent.type(within(dialog).getByLabelText(en.vaccines.form.notes), 'left thigh')
  await userEvent.click(within(dialog).getByRole('button', { name: en.vaccines.form.save }))
  await waitFor(() =>
    expect(calls.find((c) => c.key === 'PATCH /api/vaccines/a')?.body).toEqual({
      status: 'given', given_on: iso(0), place: 'City Hospital', notes: 'left thigh',
    }),
  )
})

test('a given date in the future is refused', async () => {
  const calls = mockApi(routes())
  renderApp(<VaccinesTab />)
  await screen.findByText('Vaccine a 1')
  await userEvent.click(within(entry('Vaccine a 1')).getByRole('button', { name: en.vaccines.markGiven }))
  const dialog = screen.getByRole('dialog')
  const date = within(dialog).getByLabelText(en.vaccines.form.givenOn)
  await userEvent.clear(date)
  await userEvent.type(date, iso(3))
  await userEvent.click(within(dialog).getByRole('button', { name: en.vaccines.form.save }))
  expect(await within(dialog).findByText(en.vaccines.form.futureGiven)).toBeInTheDocument()
  expect(calls.some((c) => c.key === 'PATCH /api/vaccines/a')).toBe(false)
})

test('skip and delete (two-step)', async () => {
  const calls = mockApi(routes())
  renderApp(<VaccinesTab />)
  await screen.findByText('Vaccine a 1')
  await userEvent.click(within(entry('Vaccine a 1')).getByRole('button', { name: en.vaccines.skip }))
  await waitFor(() => expect(calls.find((c) => c.key === 'PATCH /api/vaccines/a')?.body).toEqual({ status: 'skipped' }))
  await userEvent.click(within(entry('Vaccine a 1')).getByRole('button', { name: en.vaccines.delete }))
  expect(calls.some((c) => c.key === 'DELETE /api/vaccines/a')).toBe(false)
  await userEvent.click(within(entry('Vaccine a 1')).getByRole('button', { name: en.vaccines.confirmDelete }))
  await waitFor(() => expect(calls.some((c) => c.key === 'DELETE /api/vaccines/a')).toBe(true))
})

test('add a custom vaccine', async () => {
  const calls = mockApi(routes())
  renderApp(<VaccinesTab />)
  await userEvent.click(await screen.findByRole('button', { name: en.vaccines.add }))
  const dialog = screen.getByRole('dialog')
  await userEvent.type(within(dialog).getByLabelText(en.vaccines.form.name), 'Meningococcal')
  await userEvent.type(within(dialog).getByLabelText(en.vaccines.form.dose), '1')
  await userEvent.type(within(dialog).getByLabelText(en.vaccines.form.dueDate), '2027-07-01')
  await userEvent.click(within(dialog).getByRole('button', { name: en.vaccines.form.save }))
  await waitFor(() =>
    expect(calls.find((c) => c.key === 'POST /api/vaccines')?.body).toMatchObject({
      name: 'Meningococcal', dose_label: '1', due_date: '2027-07-01',
    }),
  )
})

test('add missing from template keeps existing entries', async () => {
  const calls = mockApi(routes())
  renderApp(<VaccinesTab />)
  await userEvent.click(await screen.findByRole('button', { name: en.vaccines.addMissing }))
  const dialog = screen.getByRole('dialog')
  const iap = within(dialog).getByText(TEMPLATES[0].name).closest('li') as HTMLElement
  await userEvent.click(within(iap).getByRole('button', { name: en.vaccines.picker.use }))
  await waitFor(() =>
    expect(calls.find((c) => c.key === 'POST /api/vaccines/apply-template')?.body).toEqual({ template_id: 'iap', mode: 'add_missing' }),
  )
  expect(calls.some((c) => c.key.startsWith('DELETE'))).toBe(false)
})

test('409 on fill explains the schedule already exists', async () => {
  mockApi({
    ...routes([]),
    'POST /api/vaccines/apply-template': { status: 409, body: { detail: 'a vaccination schedule already exists', existing: 3 } },
  })
  renderApp(<VaccinesTab />)
  const iap = (await screen.findByText(TEMPLATES[0].name)).closest('li') as HTMLElement
  await waitFor(() => expect(within(iap).getByRole('button', { name: en.vaccines.picker.use })).toBeEnabled())
  await userEvent.click(within(iap).getByRole('button', { name: en.vaccines.picker.use }))
  expect(await screen.findByText(en.vaccines.picker.exists)).toBeInTheDocument()
})

test('viewer sees no buttons', async () => {
  mockApi(routes(LIST, ME_VIEWER))
  renderApp(<VaccinesTab />)
  await screen.findByText('Vaccine a 1')
  for (const name of [en.vaccines.markGiven, en.vaccines.skip, en.vaccines.delete, en.vaccines.add, en.vaccines.addMissing])
    expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
})

test('a skipped vaccine can be put back or marked given', async () => {
  const skipped = VAX('a', { status: 'skipped' })
  const calls = mockApi(routes([skipped]))
  renderApp(<VaccinesTab />)
  await screen.findByText('Vaccine a 1')
  expect(within(entry('Vaccine a 1')).getByRole('button', { name: en.vaccines.markGiven })).toBeInTheDocument()
  await userEvent.click(within(entry('Vaccine a 1')).getByRole('button', { name: en.vaccines.restore }))
  await waitFor(() => expect(calls.find((c) => c.key === 'PATCH /api/vaccines/a')?.body).toEqual({ status: 'pending' }))
})
