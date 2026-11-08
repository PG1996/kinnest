import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { list, listRejected } from '../offline/queue'
import { queuedAmount } from '../offline/pending'
import { flush } from '../offline/sync'
import { useCancelNudge, useCreateNudge, useGiveDose } from './log'

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>{children}</QueryClientProvider>
)
const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const SLOT = '2026-11-08T03:30:00Z'

test('useGiveDose sends the amount and stamps the time it was given', async () => {
  const fetchMock = vi.fn(async (_u: RequestInfo | URL, _i?: RequestInit) => json(201, { id: 'd1', slot: { status: 'partial', given_amount: 0.25, remaining: 0.75 } }))
  vi.stubGlobal('fetch', fetchMock)
  const { result } = renderHook(() => useGiveDose(), { wrapper })
  let out: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined
  await act(async () => {
    out = await result.current.mutateAsync({ id: 'd1', medicine_id: 'm1', status: 'given', amount: 0.25, scheduled_for: SLOT })
  })
  const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
  expect(body).toMatchObject({ id: 'd1', amount: 0.25, status: 'given', scheduled_for: SLOT })
  expect(Date.parse(body.given_at)).toBeLessThanOrEqual(Date.now())
  expect(out?.slot).toEqual({ status: 'partial', given_amount: 0.25, remaining: 0.75 })
})

test('a nudge created offline is queued and syncs to its own endpoint', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
  const { result } = renderHook(() => useCreateNudge(), { wrapper })
  await act(async () => {
    await result.current.mutateAsync({ id: 'n1', medicine_id: 'm1', scheduled_for: SLOT, remind_at: '2026-11-08T03:45:00Z' })
  })
  expect((await list())[0]).toMatchObject({ kind: 'nudge', id: 'n1', payload: { medicine_id: 'm1' } })
  const fetchMock = vi.fn(async (_u: RequestInfo | URL, _i?: RequestInit) => json(201))
  vi.stubGlobal('fetch', fetchMock)
  expect(await flush()).toEqual({ sent: 1, failed: 0 })
  expect(fetchMock.mock.calls[0][0]).toBe('/api/medicines/m1/nudges')
})

test('cancelling a reminder calls the delete endpoint', async () => {
  const fetchMock = vi.fn(async (_u: RequestInfo | URL, _i?: RequestInit) => json(200, { ok: true }))
  vi.stubGlobal('fetch', fetchMock)
  const { result } = renderHook(() => useCancelNudge(), { wrapper })
  await act(async () => {
    await result.current.mutateAsync({ medicineId: 'm1', nudgeId: 'n1' })
  })
  expect(fetchMock.mock.calls[0][0]).toBe('/api/medicines/m1/nudges/n1')
  expect(fetchMock.mock.calls[0][1]?.method).toBe('DELETE')
})

test('queuedAmount sums the queued pieces of one slot only', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
  const { result } = renderHook(() => useGiveDose(), { wrapper })
  await act(async () => {
    await result.current.mutateAsync({ id: 'a', medicine_id: 'm1', status: 'given', amount: 0.25, scheduled_for: SLOT })
    await result.current.mutateAsync({ id: 'b', medicine_id: 'm1', status: 'given', amount: 0.5, scheduled_for: SLOT })
    await result.current.mutateAsync({ id: 'c', medicine_id: 'm1', status: 'given', amount: 1, scheduled_for: '2026-11-08T15:30:00Z' })
    await result.current.mutateAsync({ id: 'd', medicine_id: 'm2', status: 'given', amount: 2, scheduled_for: SLOT })
    await result.current.mutateAsync({ id: 'e', medicine_id: 'm1', status: 'skipped', scheduled_for: SLOT })
  })
  const pending = await list()
  expect(queuedAmount(pending, 'm1', SLOT)).toBeCloseTo(0.75)
  expect(queuedAmount(pending, 'm1', '2026-11-08T09:30:00Z')).toBe(0)
})

test('a queued piece the server refuses goes to the rejected list with its reason', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
  const { result } = renderHook(() => useGiveDose(), { wrapper })
  await act(async () => {
    await result.current.mutateAsync({ id: 'late', medicine_id: 'm1', status: 'given', amount: 0.5, scheduled_for: SLOT })
  })
  vi.stubGlobal('fetch', vi.fn(async () => json(409, { detail: 'only 0.25 left to give', remaining: 0.25 })))
  expect(await flush()).toEqual({ sent: 0, failed: 1 })
  expect(await list()).toEqual([])
  expect((await listRejected())[0]).toMatchObject({ id: 'late', reason: 'only 0.25 left to give' })
})
