import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { list } from '../offline/queue'
import { ApiError, api } from '../api/client'
import { useEndSleep, useGiveDose, useStartSleep } from './log'

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>{children}</QueryClientProvider>
)
const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const dose = { id: 'd1', medicine_id: 'm1', status: 'given' as const, scheduled_for: '2026-11-08T03:30:00Z' }

test('useGiveDose posts to the medicine and returns the server answer', async () => {
  const fetchMock = vi.fn(async (_u: RequestInfo | URL, _i?: RequestInit) => json(201, { id: 'd1', gap_warning: null }))
  vi.stubGlobal('fetch', fetchMock)
  const { result } = renderHook(() => useGiveDose(), { wrapper })
  let out: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined
  await act(async () => {
    out = await result.current.mutateAsync(dose)
  })
  expect(fetchMock.mock.calls[0][0]).toBe('/api/medicines/m1/doses')
  expect(out?.queued).toBeUndefined()
  expect(await list()).toEqual([])
})

test('useGiveDose queues on network error and on 503', async () => {
  for (const failure of [() => Promise.reject(new TypeError('offline')), async () => json(503)]) {
    vi.stubGlobal('fetch', vi.fn(failure))
    const { result } = renderHook(() => useGiveDose(), { wrapper })
    let out: { queued?: boolean } | undefined
    await act(async () => {
      out = await result.current.mutateAsync({ ...dose, id: crypto.randomUUID() })
    })
    expect(out?.queued).toBe(true)
  }
  const queue = await list()
  expect(queue).toHaveLength(2)
  expect(queue[0]).toMatchObject({ kind: 'dose', payload: { medicine_id: 'm1', status: 'given' } })
})

test('a refused dose (409) is an error, not queued', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json(409, { detail: 'that dose is not due' })))
  const { result } = renderHook(() => useGiveDose(), { wrapper })
  await act(async () => {
    await expect(result.current.mutateAsync(dose)).rejects.toMatchObject({ status: 409, message: 'that dose is not due' })
  })
  expect(await list()).toEqual([])
})

test('sleep start and end queue under their own kinds', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
  const start = renderHook(() => useStartSleep(), { wrapper })
  const end = renderHook(() => useEndSleep(), { wrapper })
  await act(async () => {
    await start.result.current.mutateAsync({ id: 's1', started_at: '2026-11-08T01:00:00Z' })
    await end.result.current.mutateAsync({ id: 's1', ended_at: '2026-11-08T02:00:00Z' })
  })
  expect((await list()).map((e) => e.kind)).toEqual(['sleep_start', 'sleep_end'])
})

test('ApiError keeps the response body so callers can read the open sleep session', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json(409, { detail: 'already asleep', open: { id: 's9' } })))
  await expect(api('/api/sleep', { json: { id: 'x' } })).rejects.toSatisfy(
    (e: unknown) => e instanceof ApiError && e.status === 409 && (e.body as { open: { id: string } }).open.id === 's9',
  )
})
