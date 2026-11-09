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

// inside the form dialog when one is open (the charts behind it have place filters with the same names)
const chip = (name: string) => within(screen.queryByRole('dialog') ?? document.body).getByRole('button', { name })
// the form is a full-screen dialog over the charts, whose figures carry similar labels: look inside it
const input = (key: keyof typeof en.vitals.measurements) =>
  within(screen.getByRole('dialog')).getByLabelText(new RegExp(`^${en.vitals.measurements[key]}`))

/** The tab opens on charts; the list is one tap away. */
const toList = async () => userEvent.click(await screen.findByRole('radio', { name: en.vitals.charts.list }))

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
  await toList()
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
  await toList()
  await userEvent.click(await screen.findByRole('button', { name: en.vitals.list.delete }))
  expect(calls.some((c) => c.key === 'DELETE /api/vitals/v1')).toBe(false)
  await userEvent.click(screen.getByRole('button', { name: en.vitals.list.confirmDelete }))
  await waitFor(() => expect(calls.some((c) => c.key === 'DELETE /api/vitals/v1')).toBe(true))
})

test('filters list by place', async () => {
  mockApi(routes())
  renderApp(<VitalsTab />)
  await toList()
  expect(await screen.findByText(/City Hospital/)).toBeInTheDocument()
  await userEvent.selectOptions(screen.getByLabelText(en.vitals.list.place), 'hospital')
  await waitFor(() =>
    expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u) === '/api/vitals?place_kind=hospital')).toBe(true),
  )
})

const homeSummary = (latest: object) => ({
  last_feed: null, next_feed_due_at: null, last_diaper: null, feeds_today: 0,
  diapers_today: { wet: 0, dirty: 0, both: 0 }, sleep: { open: null, last: null }, vitals: { latest },
})
const homeCard = async (latest: object, me = ME_ADMIN) => {
  mockApi({ 'GET /api/me': { body: me }, 'GET /api/summary': { body: homeSummary(latest) }, 'GET /api/medicines': { body: [] } })
  renderApp(<Home />)
  return within(await screen.findByRole('region', { name: en.vitals.card.title }))
}

test('Home card shows each latest measurement as a compact value tile', async () => {
  localStorage.setItem('kinnest.tempUnit', 'F')
  const card = await homeCard({
    weight_kg: VITAL({ weight_kg: 4.2 }),
    height_cm: VITAL({ id: 'v2', height_cm: 54 }),
    temperature_c: VITAL({ id: 'v3', temperature_c: 36.8 }),
    heart_rate: VITAL({ id: 'v4', heart_rate: 142 }),
    spo2: null,
  })
  const tile = (label: string) => card.getByText(label).parentElement!
  expect(tile(en.vitals.measurements.weight_kg)).toHaveTextContent('4.2 kg')
  expect(tile(en.vitals.measurements.height_cm)).toHaveTextContent('54 cm')
  expect(tile(en.vitals.measurements.temperature_c)).toHaveTextContent('98.2 °F')
  expect(tile(en.vitals.measurements.heart_rate)).toHaveTextContent('142')
  expect(card.queryByText(en.vitals.measurements.spo2)).not.toBeInTheDocument() // nothing recorded yet: no empty tile
  expect(card.queryByText(en.vitals.measurements.head_cm)).not.toBeInTheDocument()
})

test('Home card no longer lists a date and place for every measurement', async () => {
  const card = await homeCard({ weight_kg: VITAL({ weight_kg: 4.2, place_name: 'City Hospital', place_kind: 'hospital' }), height_cm: null, head_cm: null, temperature_c: null })
  expect(card.queryByText(/City Hospital/)).not.toBeInTheDocument()
  expect(card.queryByRole('listitem')).not.toBeInTheDocument()
  expect(card.queryByText(en.vitals.places.hospital)).not.toBeInTheDocument()
})

test('Home card says once how recent the newest reading is', async () => {
  const card = await homeCard({ weight_kg: VITAL({ weight_kg: 4.2, measured_at: hoursAgo(50) }), height_cm: VITAL({ id: 'v2', height_cm: 54, measured_at: hoursAgo(2) }), head_cm: null, temperature_c: null })
  expect(card.getAllByText(/ago/)).toHaveLength(1)
  expect(card.getByText(en.vitals.card.updated.replace('{{ago}}', '2h 0m'))).toBeInTheDocument()
})

test('a temperature of 38 °C or more is flagged as a fever', async () => {
  localStorage.setItem('kinnest.tempUnit', 'F')
  const card = await homeCard({ weight_kg: null, height_cm: null, head_cm: null, temperature_c: VITAL({ temperature_c: 38.4 }) })
  expect(card.getByText(en.vitals.card.fever)).toBeInTheDocument()
  expect(card.getByText(/101\.1 °F/)).toBeInTheDocument()
})

test('a normal temperature has no fever flag', async () => {
  const card = await homeCard({ weight_kg: null, height_cm: null, head_cm: null, temperature_c: VITAL({ temperature_c: 36.8 }) })
  expect(card.queryByText(en.vitals.card.fever)).not.toBeInTheDocument()
})

test('Home card keeps a small add button for caregivers and none for viewers', async () => {
  const card = await homeCard({ weight_kg: VITAL({ weight_kg: 4.2 }), height_cm: null, head_cm: null, temperature_c: null })
  const add = card.getByRole('link', { name: en.vitals.add })
  expect(add).toHaveAttribute('href', '/health?tab=vitals&add=1')
  expect(add.className).not.toContain('w-full') // an icon-sized button, not a full-width row
})

test('Home card shows no add button to a viewer', async () => {
  const card = await homeCard({ weight_kg: VITAL({ weight_kg: 4.2 }), height_cm: null, head_cm: null, temperature_c: null }, ME_VIEWER)
  expect(card.queryByRole('link', { name: en.vitals.add })).not.toBeInTheDocument()
})

test('viewer sees no buttons', async () => {
  mockApi(routes(ME_VIEWER))
  renderApp(<VitalsTab />)
  await toList()
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
  await toList()
  expect(await screen.findByText(en.vitals.list.waiting)).toBeInTheDocument()
  expect(screen.getByText(/3\.6 kg/)).toBeInTheDocument()
})

test('the add form opens from a link with ?add=1', async () => {
  mockApi(routes(ME_ADMIN, []))
  renderApp(<VitalsTab />, '/health?tab=vitals&add=1')
  expect(await screen.findByRole('dialog')).toBeInTheDocument()
})

test('charts are the default view and the list is one tap away', async () => {
  mockApi({ ...routes(), 'GET /api/vitals/growth/weight': { status: 409, body: { detail: 'birth date not set' } }, 'GET /api/vitals/growth/height': { status: 409, body: {} }, 'GET /api/vitals/growth/head': { status: 409, body: {} } })
  renderApp(<VitalsTab />)
  expect(await screen.findByRole('radio', { name: en.vitals.charts.title, checked: true })).toBeInTheDocument()
  expect(screen.queryByText('City Hospital')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('radio', { name: en.vitals.charts.list }))
  expect(await screen.findByText(/City Hospital/)).toBeInTheDocument()
})

// --- opening the vitals screen, and a tidy list --------------------------------------------------------------------

test('the Home vitals card opens the vitals tab of Health', async () => {
  const card = await homeCard({ weight_kg: VITAL({ weight_kg: 4.2 }), height_cm: null, temperature_c: null, heart_rate: null, spo2: null })
  const link = card.getByRole('link', { name: en.vitals.card.open })
  expect(link).toHaveAttribute('href', '/health?tab=vitals')
  expect(within(link).getByText('4.2 kg')).toBeInTheDocument() // the tiles are inside the link
  expect(card.getByRole('link', { name: en.vitals.add })).toHaveAttribute('href', '/health?tab=vitals&add=1') // the + still adds
})

test('each reading in the list shows its values as separate tiles, like the Home card', async () => {
  mockApi(routes(ME_ADMIN, [VITAL({ heart_rate: 140, spo2: 98 })]))
  renderApp(<VitalsTab />)
  await toList()
  const values = await screen.findByTestId('vital-values')
  expect(within(values).getAllByTestId('vital-value').map((n) => n.textContent)).toEqual([
    expect.stringContaining('3.42 kg'),
    expect.stringContaining('°'),
    expect.stringContaining('140'),
    expect.stringContaining('98'),
  ])
})

test('the list filters give the place a row of its own and the two dates share the next one', async () => {
  mockApi(routes())
  renderApp(<VitalsTab />)
  await toList()
  const place = await screen.findByLabelText(en.vitals.list.place)
  const from = screen.getByLabelText(en.vitals.list.from)
  const to = screen.getByLabelText(en.vitals.list.to)
  expect(place.closest('div')!.parentElement).not.toBe(from.closest('div')!.parentElement)
  expect(from.closest('div')!.parentElement).toBe(to.closest('div')!.parentElement)
  expect(from.closest('div')!.parentElement!.className).toContain('grid-cols-2')
})
