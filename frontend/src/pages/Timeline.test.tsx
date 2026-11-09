import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import en from '../i18n/en.json'
import { enqueue } from '../offline/queue'
import { ME_ADMIN, ME_VIEWER, mockApi, renderApp } from '../test/utils'
import Timeline from './Timeline'

const at = (h: number, m = 0) => new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), h, m).toISOString()
const ITEMS = [
  { kind: 'feed', id: 'f1', at: at(14, 5), data: { type: 'formula', quantity_ml: 60, duration_min: null, fed_by_name: 'Mom' } },
  { kind: 'diaper', id: 'd1', at: at(13, 10), data: { kind: 'wet', changed_by_name: 'Nani' } },
  { kind: 'sleep', id: 's1', at: at(10, 30), data: { started_at: at(10, 30), ended_at: at(12, 20), duration_min: 110, started_by_name: 'Nanny' } },
  { kind: 'dose', id: 'p1', at: at(9, 20), data: { status: 'given', amount: 0.25, dose_unit: 'ml', medicine_name: 'Vitamin D3', by_name: 'Dad' } },
  { kind: 'vital', id: 'v1', at: at(8, 0), data: { weight_kg: 3.42, place_kind: 'home', place_name: '', temperature_c: null, height_cm: null, head_cm: null, heart_rate: null, resp_rate: null, spo2: null } },
]
const api = (items: object[] = ITEMS, me = ME_ADMIN) => ({ 'GET /api/me': { body: me }, 'GET /api/timeline': { body: { items } } })
const timelineCalls = (calls: { key: string; url: string }[]) => calls.filter((c) => c.key === 'GET /api/timeline').map((c) => new URL(c.url, 'http://x'))

test('rows render newest first with titles and who did it', async () => {
  mockApi(api())
  renderApp(<Timeline />)
  expect(await screen.findByText(`${en.feedTypes.formula} · 60 ml`)).toBeInTheDocument()
  expect(screen.getByText(en.diaperKinds.wet)).toBeInTheDocument()
  expect(screen.getByText(/Vitamin D3 · 0\.25 ml/)).toBeInTheDocument()
  expect(screen.getByText(/3\.42 kg/)).toBeInTheDocument()
  expect(screen.getByText(/Mom/)).toBeInTheDocument()
  const rows = screen.getAllByRole('listitem')
  expect(rows).toHaveLength(5)
  expect(rows[0]).toHaveTextContent('60 ml')
  expect(rows[4]).toHaveTextContent('3.42')
})

test('filter chips ask the server for just those kinds', async () => {
  const calls = mockApi(api())
  renderApp(<Timeline />)
  await screen.findByText(`${en.feedTypes.formula} · 60 ml`)
  await userEvent.click(screen.getByRole('button', { name: en.timeline.filters.feed }))
  await waitFor(() => expect(timelineCalls(calls).some((u) => u.searchParams.get('kinds') === 'feed')).toBe(true))
  expect(screen.getByRole('button', { name: en.timeline.filters.feed, pressed: true })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: en.timeline.filters.health }))
  await waitFor(() => expect(timelineCalls(calls).some((u) => u.searchParams.get('kinds') === 'vaccine,visit')).toBe(true))
})

test('an empty day says so', async () => {
  mockApi(api([]))
  renderApp(<Timeline />)
  expect(await screen.findByText(en.timeline.empty)).toBeInTheDocument()
})

test('entries waiting to sync show as pending sync', async () => {
  mockApi(api([]))
  await enqueue({ kind: 'feed', id: 'q1', payload: { id: 'q1', type: 'formula', started_at: at(15, 0), quantity_ml: 90 } })
  renderApp(<Timeline />)
  expect(await screen.findByText(`${en.feedTypes.formula} · 90 ml`)).toBeInTheDocument()
  expect(screen.getByText(new RegExp(en.timeline.pendingSync))).toBeInTheDocument()
})

test('show earlier day fetches the previous day', async () => {
  const calls = mockApi(api())
  renderApp(<Timeline />)
  await screen.findByText(`${en.feedTypes.formula} · 60 ml`)
  await userEvent.click(screen.getByRole('button', { name: en.timeline.earlier }))
  await waitFor(() => expect(timelineCalls(calls).length).toBeGreaterThanOrEqual(2))
  const froms = timelineCalls(calls).map((u) => new Date(u.searchParams.get('from')!).getDate())
  expect(new Set(froms).size).toBe(2)
  expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(2)
})

test('a viewer can read the timeline', async () => {
  mockApi(api(ITEMS, ME_VIEWER))
  renderApp(<Timeline />)
  expect(await screen.findByText(`${en.feedTypes.formula} · 60 ml`)).toBeInTheDocument()
})
