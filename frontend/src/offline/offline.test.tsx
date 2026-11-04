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
