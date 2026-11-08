import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { validateVital } from '../lib/vitals'
import { flush } from '../offline/sync'
import { list } from '../offline/queue'
import { useBulkVitals, useCreateVital } from './log'

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>{children}</QueryClientProvider>
)
const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const base = { id: 'v1', measured_at: new Date(Date.now() - 60_000).toISOString(), place_kind: 'home' as const }

test('validateVital refuses 98.6 for temperature with a hint and accepts 36.8', () => {
  const bad = validateVital({ ...base, temperature_c: 98.6 })
  expect(bad.temperature_c).toMatch(/30.*45/)
  expect(bad.temperature_c).toMatch(/Fahrenheit/)
  expect(validateVital({ ...base, temperature_c: 36.8 })).toEqual({})
})

test('validateVital needs one measurement, checks every range and refuses the future', () => {
  expect(validateVital(base)._form).toBeTruthy()
  expect(validateVital({ ...base, weight_kg: 62 }).weight_kg).toMatch(/0\.3.*60/)
  expect(validateVital({ ...base, weight_kg: 0 }).weight_kg).toBeTruthy()
  expect(validateVital({ ...base, spo2: 101 }).spo2).toBeTruthy()
  expect(validateVital({ ...base, weight_kg: 0.3, spo2: 100, heart_rate: 30 })).toEqual({})
  const future = new Date(Date.now() + 60 * 60_000).toISOString()
  expect(validateVital({ ...base, measured_at: future, weight_kg: 3 }).measured_at).toBeTruthy()
})

test('a vital created offline is queued and syncs to /api/vitals', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
  const { result } = renderHook(() => useCreateVital(), { wrapper })
  let out: { queued?: boolean } | undefined
  await act(async () => {
    out = await result.current.mutateAsync({ ...base, weight_kg: 3.4 })
  })
  expect(out?.queued).toBe(true)
  expect(await list()).toMatchObject([{ kind: 'vital', id: 'v1', payload: { weight_kg: 3.4 } }])
  const fetchMock = vi.fn(async (_u: RequestInfo | URL, _i?: RequestInit) => json(201, { id: 'v1' }))
  vi.stubGlobal('fetch', fetchMock)
  await flush()
  expect(fetchMock.mock.calls[0][0]).toBe('/api/vitals')
  expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ id: 'v1', weight_kg: 3.4 })
  expect(await list()).toEqual([])
})

test('bulk shows per-row server errors', async () => {
  const errors = [{ index: 1, detail: 'temperature must be 30 to 45 degrees Celsius' }]
  vi.stubGlobal('fetch', vi.fn(async () => json(422, { detail: 'some rows are not valid', errors })))
  const { result } = renderHook(() => useBulkVitals(), { wrapper })
  await act(async () => {
    await expect(result.current.mutateAsync([{ ...base, weight_kg: 3 }])).rejects.toMatchObject({
      status: 422,
      rowErrors: { 1: errors[0].detail },
    })
  })
  expect(await list()).toEqual([])
})
