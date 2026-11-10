import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import en from '../i18n/en.json'
import VitalsTab from '../pages/VitalsTab'
import { ME_ADMIN, ME_VIEWER, mockApi, renderApp, pickDate } from '../test/utils'

const ON = { 'GET /api/scans/status': { body: { enabled: true, remaining_today: 19 } } }
const UPLOAD = { 'POST /api/files': { status: 201, body: { id: 'file1', url: '/api/files/file1', thumb_url: '/api/files/file1/thumb', content_type: 'image/jpeg' } } }
const DRAFT = {
  scan_id: 's1',
  draft: {
    rows: [
      { measured_at: '2026-10-24T09:00:00+05:30', values: { weight_kg: 3.1, height_cm: 49 }, unsure: [] },
      { measured_at: '2026-10-26T09:00:00+05:30', values: { weight_kg: 3.0, temperature_c: 37.2 }, unsure: ['temperature_c'] },
      { measured_at: null, values: { heart_rate: 142 }, unsure: [] },
    ],
    warnings: ['The third date was hard to read'],
  },
}
const base = (me = ME_ADMIN, extra: object = {}) => ({
  'GET /api/me': { body: me },
  'GET /api/vitals': { body: [] },
  'GET /api/vitals/growth/weight': { status: 409, body: {} },
  'GET /api/vitals/growth/height': { status: 409, body: {} },
  'GET /api/vitals/growth/head': { status: 409, body: {} },
  ...extra,
})
const photo = () => new File(['x'], 'record.jpg', { type: 'image/jpeg' })

async function toReview(extra: object = {}) {
  const calls = mockApi(base(ME_ADMIN, { ...ON, ...UPLOAD, 'POST /api/scans': { body: DRAFT }, 'POST /api/vitals/bulk': { status: 201, body: { created: 2, existing: 0 } }, ...extra }))
  renderApp(<VitalsTab />)
  await userEvent.click(await screen.findByRole('button', { name: en.scan.snap }))
  await userEvent.click(await screen.findByRole('button', { name: en.scan.continue }))
  await userEvent.upload(screen.getByLabelText(en.scan.chooseFile), photo())
  return calls
}

test('snap is hidden when the scan status is not available yet (404)', async () => {
  mockApi(base())
  renderApp(<VitalsTab />)
  await screen.findByRole('button', { name: en.vitals.add })
  expect(screen.queryByRole('button', { name: en.scan.snap })).not.toBeInTheDocument()
})

test('snap is hidden when scanning is turned off', async () => {
  mockApi(base(ME_ADMIN, { 'GET /api/scans/status': { body: { enabled: false, remaining_today: 0 } } }))
  renderApp(<VitalsTab />)
  await screen.findByRole('button', { name: en.vitals.add })
  expect(screen.queryByRole('button', { name: en.scan.snap })).not.toBeInTheDocument()
})

test('a viewer never sees snap, even when scanning is on', async () => {
  mockApi(base(ME_VIEWER, ON))
  renderApp(<VitalsTab />)
  await screen.findByRole('radio', { name: en.vitals.charts.title })
  expect(screen.queryByRole('button', { name: en.scan.snap })).not.toBeInTheDocument()
})

test('the privacy notice must be accepted before the photo picker', async () => {
  mockApi(base(ME_ADMIN, ON))
  renderApp(<VitalsTab />)
  await userEvent.click(await screen.findByRole('button', { name: en.scan.snap }))
  expect(await screen.findByText(en.scan.notice)).toBeInTheDocument()
  expect(screen.queryByLabelText(en.scan.chooseFile)).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: en.scan.continue }))
  expect(await screen.findByLabelText(en.scan.chooseFile)).toBeInTheDocument()
  expect(screen.getByLabelText(en.scan.takePhoto)).toBeInTheDocument()
})

test('uploading a photo shows draft rows with check badges and the warnings', async () => {
  const calls = await toReview()
  expect(await screen.findByText('The third date was hard to read')).toBeInTheDocument()
  expect(screen.getAllByRole('checkbox')).toHaveLength(3)
  expect(screen.getAllByText(en.scan.check)).toHaveLength(1)
  expect(screen.getByLabelText(`${en.vitals.measurements.heart_rate} 3`)).toHaveValue(142)
  expect(calls.find((c) => c.key === 'POST /api/files')).toBeTruthy()
  expect(calls.find((c) => c.key === 'POST /api/scans')!.body).toEqual({ kind: 'vitals', file_id: 'file1' })
  expect(screen.getByRole('img', { name: en.scan.photoAlt })).toBeInTheDocument()
})

test('unticked rows are not saved and save posts the rest with the chosen place', async () => {
  const calls = await toReview()
  await screen.findByText('The third date was hard to read')
  await userEvent.click(screen.getByRole('checkbox', { name: `${en.scan.include} 2` }))
  await userEvent.click(screen.getByRole('button', { name: en.vitals.places.hospital, pressed: false }))
  await pickDate(en.scan.defaultDate, new Date(2026, 9, 27))
  const save = screen.getByRole('button', { name: en.scan.save.replace('{{count}}', '2') })
  await userEvent.click(save)
  await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/vitals/bulk')).toBe(true))
  const entries = (calls.find((c) => c.key === 'POST /api/vitals/bulk')!.body as { entries: Record<string, unknown>[] }).entries
  expect(entries).toHaveLength(2)
  expect(entries.every((e) => e.place_kind === 'hospital')).toBe(true)
  expect(entries[0]).toMatchObject({ weight_kg: 3.1, height_cm: 49 })
  expect(entries[1]).toMatchObject({ heart_rate: 142 })
  expect(String(entries[1]!.measured_at)).toContain('2026-10-27')
})

test('a row without a date and no default date blocks saving with a message', async () => {
  const calls = await toReview()
  await screen.findByText('The third date was hard to read')
  await userEvent.click(screen.getByRole('button', { name: en.scan.save.replace('{{count}}', '3') }))
  expect(await screen.findByText(en.vitals.bulk.date, { selector: 'p, span' })).toBeInTheDocument()
  expect(calls.some((c) => c.key === 'POST /api/vitals/bulk')).toBe(false)
})

test('a scan failure keeps the photo and offers retry', async () => {
  let n = 0
  await toReview({ 'POST /api/scans': () => (++n === 1 ? { status: 502, body: { detail: 'model unavailable' } } : { body: DRAFT }) })
  expect(await screen.findByText(en.scan.failed)).toBeInTheDocument()
  expect(screen.getByRole('img', { name: en.scan.photoAlt })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: en.scan.retry }))
  expect(await screen.findByText('The third date was hard to read')).toBeInTheDocument()
})

test('the daily limit has its own message', async () => {
  await toReview({ 'POST /api/scans': { status: 429, body: { detail: 'daily limit' } } })
  expect(await screen.findByText(en.scan.limit)).toBeInTheDocument()
  expect(within(screen.getByRole('dialog')).queryByRole('button', { name: en.scan.retry })).not.toBeInTheDocument()
})

test('closing while the photo is uploading never starts the scan', async () => {
  let release: (() => void) | undefined
  const calls = mockApi(base(ME_ADMIN, { ...ON, 'POST /api/scans': { body: DRAFT } }))
  const real = fetch
  vi.stubGlobal('fetch', (u: RequestInfo | URL, init?: RequestInit) =>
    String(u) === '/api/files' ? new Promise<Response>((r) => (release = () => r(new Response(JSON.stringify({ id: 'file1', url: '/f', thumb_url: null, content_type: 'image/jpeg' }), { status: 201, headers: { 'Content-Type': 'application/json' } })))) : real(u, init),
  )
  renderApp(<VitalsTab />)
  await userEvent.click(await screen.findByRole('button', { name: en.scan.snap }))
  await userEvent.click(await screen.findByRole('button', { name: en.scan.continue }))
  await userEvent.upload(screen.getByLabelText(en.scan.chooseFile), photo())
  await screen.findByText(en.scan.reading)
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  release?.()
  await new Promise((r) => setTimeout(r, 50))
  expect(calls.some((c) => c.key === 'POST /api/scans')).toBe(false)
})
