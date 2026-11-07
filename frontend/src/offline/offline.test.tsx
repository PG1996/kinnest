import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import type { Summary } from '../api/hooks'
import OfflineBanner from '../components/OfflineBanner'
import en from '../i18n/en.json'
import i18n from '../i18n'
import Home from '../pages/Home'
import { ME_ADMIN, renderApp } from '../test/utils'
import { enqueue, list, listRejected } from './queue'
import { flush } from './sync'
import { mergePending } from './pending'

const entry = (kind: 'feed' | 'diaper', id: string) => ({
  kind,
  id,
  payload: kind === 'feed' ? { id, type: 'formula', started_at: '2026-11-04T10:00:00Z' } : { id, kind: 'wet', at: '2026-11-04T10:00:00Z' },
})
const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

test('flush sends queued entries in order and removes them', async () => {
  await enqueue(entry('feed', 'a'))
  await enqueue(entry('diaper', 'b'))
  await enqueue(entry('feed', 'c'))
  const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => json(201))
  vi.stubGlobal('fetch', fetchMock)
  expect(await flush()).toEqual({ sent: 3, failed: 0 })
  const sent = fetchMock.mock.calls.map(([url, init]) => [url, JSON.parse(String(init?.body)).id])
  expect(sent).toEqual([['/api/feeds', 'a'], ['/api/diapers', 'b'], ['/api/feeds', 'c']])
  expect(await list()).toEqual([])
})

test('flush retried after network error does not duplicate (same id sent)', async () => {
  await enqueue(entry('feed', 'a'))
  const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(json(200))
  vi.stubGlobal('fetch', fetchMock)
  expect(await flush()).toEqual({ sent: 0, failed: 1 })
  expect(await list()).toHaveLength(1)
  expect(await flush()).toEqual({ sent: 1, failed: 0 })
  const ids = fetchMock.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)).id)
  expect(ids).toEqual(['a', 'a'])
  expect(await list()).toEqual([])
})

test('4xx drops entry and reports error', async () => {
  await enqueue(entry('feed', 'a'))
  await enqueue(entry('feed', 'b'))
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(422, { detail: 'timestamp is in the future' })).mockResolvedValueOnce(json(201)))
  expect(await flush()).toEqual({ sent: 1, failed: 1 })
  expect(await list()).toEqual([])
  const rejected = await listRejected()
  expect(rejected).toHaveLength(1)
  expect(rejected[0]).toMatchObject({ id: 'a', reason: 'timestamp is in the future' })
})

test('server errors and 401 keep the entry and stop the run', async () => {
  await enqueue(entry('feed', 'a'))
  await enqueue(entry('feed', 'b'))
  const fetchMock = vi.fn().mockResolvedValue(json(500))
  vi.stubGlobal('fetch', fetchMock)
  expect(await flush()).toEqual({ sent: 0, failed: 1 })
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(await list()).toHaveLength(2)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(401)))
  expect((await flush()).sent).toBe(0)
  expect(await list()).toHaveLength(2)
})

test('mergePending shows the newest pending feed as last fed with a due time', () => {
  const summary: Summary = {
    last_feed: { id: 'old', type: 'formula', started_at: '2026-11-04T07:00:00Z', duration_min: null, quantity_ml: 60, note: '', fed_by_name: 'Mom' },
    next_feed_due_at: '2026-11-04T10:00:00Z',
    last_diaper: null,
    feeds_today: 1,
    diapers_today: { wet: 0, dirty: 0, both: 0 },
    sleep: { open: null, last: null },
  }
  const pending = [{ ...entry('feed', 'p1'), queuedAt: 1, seq: 1, payload: { id: 'p1', type: 'breast_left', started_at: '2026-11-04T09:00:00Z', duration_min: 10 } }]
  const merged = mergePending(summary, pending, 'Me')
  expect(merged.last_feed).toMatchObject({ id: 'p1', fed_by_name: 'Me', type: 'breast_left' })
  expect(merged.next_feed_due_at).toBe('2026-11-04T12:00:00.000Z')
  expect(merged.feeds_today).toBe(2)
  expect(mergePending(summary, [], 'Me')).toBe(summary)
})

test('banner appears after repeated health failures and clears on recovery', async () => {
  vi.useFakeTimers()
  const fetchMock = vi.fn().mockRejectedValue(new TypeError('down'))
  vi.stubGlobal('fetch', fetchMock)
  render(
    <I18nextProvider i18n={i18n}>
      <OfflineBanner checkEveryMs={1000} minOutageMs={2000} />
    </I18nextProvider>,
  )
  await act(() => vi.advanceTimersByTimeAsync(1000))
  expect(screen.queryByText(en.offline.banner)).not.toBeInTheDocument()
  await act(() => vi.advanceTimersByTimeAsync(2000))
  expect(screen.getByText(en.offline.banner)).toBeInTheDocument()
  fetchMock.mockResolvedValue(json(200, { status: 'ok' }))
  await act(() => vi.advanceTimersByTimeAsync(1000))
  expect(screen.queryByText(en.offline.banner)).not.toBeInTheDocument()
  vi.useRealTimers()
})

test('saving a feed with no connection queues it and shows it as pending', async () => {
  const summary = { last_feed: null, next_feed_due_at: null, last_diaper: null, feeds_today: 0, diapers_today: { wet: 0, dirty: 0, both: 0 } }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'POST') throw new TypeError('offline')
      return json(200, url.includes('/api/me') ? ME_ADMIN : summary)
    }),
  )
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.home.feed }))
  await userEvent.click(screen.getByRole('button', { name: en.home.saveFeed }))
  expect(await screen.findByText(en.home.queued)).toBeInTheDocument()
  await waitFor(async () => expect(await list()).toHaveLength(1))
  expect((await list())[0]).toMatchObject({ kind: 'feed' })
  expect(await screen.findByText(en.offline.pending.replace('{{count}}', '1'))).toBeInTheDocument()
})


function stubServer(postStatus: number) {
  const summary = { last_feed: null, next_feed_due_at: null, last_diaper: null, feeds_today: 0, diapers_today: { wet: 0, dirty: 0, both: 0 } }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return json(postStatus, { detail: 'down' })
      return json(200, String(input).includes('/api/me') ? ME_ADMIN : summary)
    }),
  )
}

test('a 503 from the server (Mac asleep, tunnel up) queues a feed instead of losing it', async () => {
  stubServer(503)
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.home.feed }))
  await userEvent.click(screen.getByRole('button', { name: en.home.saveFeed }))
  expect(await screen.findByText(en.home.queued)).toBeInTheDocument()
  await waitFor(async () => expect(await list()).toHaveLength(1))
})

test('a 503 queues a diaper too, so it is not silently lost', async () => {
  stubServer(503)
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.home.diaper }))
  await userEvent.click(screen.getByRole('button', { name: en.diaperKinds.wet }))
  expect(await screen.findByText(en.home.queued)).toBeInTheDocument()
  expect((await list())[0]).toMatchObject({ kind: 'diaper' })
})

test('a rejected diaper (422) tells the caregiver instead of failing silently', async () => {
  stubServer(422)
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.home.diaper }))
  await userEvent.click(screen.getByRole('button', { name: en.diaperKinds.wet }))
  expect(await screen.findByText(en.home.saveError)).toBeInTheDocument()
  expect(await list()).toEqual([])
})

const dosePayload = (id: string, medicine = 'med1') => ({ id, medicine_id: medicine, status: 'given', scheduled_for: '2026-11-08T03:30:00Z', given_at: '2026-11-08T03:35:00Z' })

test('flush sends dose and sleep entries to their own endpoints in order', async () => {
  await enqueue({ kind: 'sleep_start', id: 's1', payload: { id: 's1', started_at: '2026-11-08T01:00:00Z' } })
  await enqueue({ kind: 'sleep_end', id: 'e1', payload: { id: 's1', ended_at: '2026-11-08T02:00:00Z' } })
  await enqueue({ kind: 'dose', id: 'd1', payload: dosePayload('d1', 'med9') })
  const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => json(201))
  vi.stubGlobal('fetch', fetchMock)
  expect(await flush()).toEqual({ sent: 3, failed: 0 })
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/sleep', '/api/sleep/s1/end', '/api/medicines/med9/doses'])
  expect(await list()).toEqual([])
})

test('a 409 on a queued dose or sleep start lands in the rejected list with the reason', async () => {
  await enqueue({ kind: 'dose', id: 'd1', payload: dosePayload('d1') })
  await enqueue({ kind: 'sleep_start', id: 's1', payload: { id: 's1', started_at: '2026-11-08T01:00:00Z' } })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(409, { detail: 'that dose is not due' })).mockResolvedValueOnce(json(409, { detail: 'already asleep' })))
  expect(await flush()).toEqual({ sent: 0, failed: 2 })
  expect(await list()).toEqual([])
  expect((await listRejected()).map((r) => r.reason).sort()).toEqual(['already asleep', 'that dose is not due'])
})

const emptySummary = (sleep: Summary['sleep'] = { open: null, last: null }): Summary => ({
  last_feed: null, next_feed_due_at: null, last_diaper: null, feeds_today: 0, diapers_today: { wet: 0, dirty: 0, both: 0 }, sleep,
})
const queued = (kind: 'sleep_start' | 'sleep_end', id: string, payload: Record<string, unknown>, seq: number) => ({ kind, id, payload, queuedAt: seq, seq })

test('mergePending shows a queued sleep start as asleep', () => {
  const merged = mergePending(emptySummary(), [queued('sleep_start', 's1', { id: 's1', started_at: '2026-11-08T01:00:00Z' }, 1)], 'Me')
  expect(merged.sleep.open).toMatchObject({ id: 's1', started_at: '2026-11-08T01:00:00Z', ended_at: null, started_by_name: 'Me' })
})

test('mergePending closes the session again when an end is queued behind the start', () => {
  const pending = [
    queued('sleep_start', 's1', { id: 's1', started_at: '2026-11-08T01:00:00Z' }, 1),
    queued('sleep_end', 'e1', { id: 's1', ended_at: '2026-11-08T02:30:00Z' }, 2),
  ]
  const merged = mergePending(emptySummary(), pending, 'Me')
  expect(merged.sleep.open).toBeNull()
  expect(merged.sleep.last).toMatchObject({ id: 's1', duration_min: 90, ended_by_name: 'Me' })
})

test('mergePending closes a session the server already has open', () => {
  const open = { id: 's9', started_at: '2026-11-08T01:00:00Z', ended_at: null, started_by_name: 'Mom', ended_by_name: null, duration_min: null, note: '' }
  const merged = mergePending(emptySummary({ open, last: null }), [queued('sleep_end', 'e1', { id: 's9', ended_at: '2026-11-08T01:45:00Z' }, 1)], 'Me')
  expect(merged.sleep.open).toBeNull()
  expect(merged.sleep.last).toMatchObject({ id: 's9', duration_min: 45, started_by_name: 'Mom' })
})
