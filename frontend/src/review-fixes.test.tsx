import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import en from './i18n/en.json'
import { useCountUp } from './lib/motion'
import { useThemeSync } from './lib/theme'
import { enqueue } from './offline/queue'
import { useSync } from './offline/useSync'
import Home from './pages/Home'
import LastFeedCard from './components/LastFeedCard'
import FeedSheet from './components/FeedSheet'
import Toast from './components/Toast'
import { ME_ADMIN, mockApi, renderApp } from './test/utils'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  localStorage.clear()
})

// 1. Night dim and Auto must keep switching while the app stays open
test('night mode flips on its own while the app stays open', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 10, 8, 21, 0))
  localStorage.setItem('kinnest.theme', 'night')
  renderHook(() => useThemeSync())
  expect(document.documentElement.dataset.theme).toBe('light')
  act(() => {
    vi.setSystemTime(new Date(2026, 10, 8, 23, 0))
    vi.advanceTimersByTime(60_000)
  })
  expect(document.documentElement.dataset.theme).toBe('dark')
})

// 2. A synced offline entry must not vanish from the timeline
test('after a sync the timeline and summary are refetched', async () => {
  await enqueue({ kind: 'diaper', id: 'q1', payload: { id: 'q1', kind: 'wet', at: new Date().toISOString() } })
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 201, headers: { 'Content-Type': 'application/json' } })))
  const qc = new QueryClient()
  const spy = vi.spyOn(qc, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  renderHook(() => useSync(), { wrapper })
  await waitFor(() => expect(spy.mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey[0])).toEqual(expect.arrayContaining(['summary', 'timeline'])))
})

// 3. The headline must not restart from zero every minute
describe('useCountUp', () => {
  test('a new target animates from the value on screen, not from zero', () => {
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
    const { result, rerender } = renderHook(({ t }) => useCountUp(t), { initialProps: { t: 130 } })
    act(() => void vi.advanceTimersByTime(1500))
    expect(result.current).toBe(130)
    rerender({ t: 131 })
    act(() => void vi.advanceTimersByTime(50)) // the first animation frame after the change
    expect(result.current).toBeGreaterThanOrEqual(130)
    act(() => void vi.advanceTimersByTime(1500))
    expect(result.current).toBe(131)
  })
})

// 4. The Sleep tile can't start two sleeps
test('the sleep tile is disabled while a start is in flight', async () => {
  const calls = mockApi({
    'GET /api/me': { body: ME_ADMIN },
    'GET /api/summary': { body: { last_feed: null, next_feed_due_at: null, last_diaper: null, feeds_today: 0, diapers_today: { wet: 0, dirty: 0, both: 0 }, sleep: { open: null, last: null } } },
  })
  const real = fetch
  vi.stubGlobal('fetch', (u: RequestInfo | URL, init?: RequestInit) => (init?.method === 'POST' ? new Promise<Response>(() => {}) : real(u, init)))
  renderApp(<Home />)
  const tile = await screen.findByRole('button', { name: en.sleep.start })
  await userEvent.click(tile)
  await waitFor(() => expect(screen.getByRole('button', { name: en.sleep.start })).toBeDisabled())
  expect(calls.filter((c) => c.key === 'POST /api/sleep')).toHaveLength(0) // the stub took over before mockApi logged it
})

// 6. Save while the timer runs keeps the timer's time and duration
test('saving with the timer still running uses the timer', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  mockApi({ 'GET /api/me': { body: ME_ADMIN } })
  const onSave = vi.fn()
  renderApp(<FeedSheet last={null} saving={false} failed={false} onSave={onSave} onClose={() => {}} />)
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  await user.click(screen.getByRole('button', { name: en.home.timerStart }))
  await act(async () => void vi.advanceTimersByTime(5 * 60_000))
  await user.click(screen.getByRole('button', { name: en.home.saveFeed }))
  const sent = onSave.mock.calls[0]![0] as { duration_min?: number; started_at: string }
  expect(sent.duration_min).toBe(5)
  expect(Date.now() - Date.parse(sent.started_at)).toBeGreaterThan(4 * 60_000)
})

// 7. The overdue call to action must be readable
const hex = (css: string, name: string, block: string) => {
  const m = new RegExp(`${block}[^}]*?--${name}:\\s*(#[0-9a-f]{6})`, 's').exec(css)
  return m![1]!
}
const lum = (h: string) => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}
test('Log feed now is bg-feed-ink with surface text and passes 4.5:1 in both themes', () => {
  const css = readFileSync(join(__dirname, 'theme/tokens.css'), 'utf8')
  for (const block of [':root \\{', "data-theme='dark'\\] \\{"]) {
    expect(ratio(hex(css, 'feed-ink', block), hex(css, 'surface', block))).toBeGreaterThanOrEqual(4.5)
  }
  const summary = { last_feed: { id: 'f', type: 'formula', started_at: new Date(Date.now() - 200 * 60_000).toISOString(), duration_min: null, quantity_ml: 60, note: '', fed_by_user_id: 'u', fed_by_name: 'Mom', created_by: 'u' }, next_feed_due_at: new Date(Date.now() - 20 * 60_000).toISOString(), last_diaper: null, feeds_today: 1, diapers_today: { wet: 0, dirty: 0, both: 0 } }
  renderApp(<LastFeedCard summary={summary as never} now={Date.now()} canLog onLogFeed={() => {}} />)
  const btn = screen.getByRole('button', { name: en.home.logFeedNow })
  expect(btn.className).toContain('bg-feed-ink')
  expect(btn.className).toContain('text-surface')
})

// 9. The scan notice is honest and neutral
test('the scan notice names storage and the API and does not assume a girl', () => {
  expect(en.scan.notice).not.toMatch(/\bher\b/i)
  expect(en.scan.notice).toMatch(/stored/i)
  expect(en.scan.notice).toMatch(/Anthropic/)
})

// 10. Errors must not wear a success tick
describe('Toast tone', () => {
  test('an error toast has no success check and is marked as an error', () => {
    const { container } = renderApp(<Toast toast={{ message: 'Could not save', tone: 'error' }} onClose={() => {}} />)
    expect(container.querySelector('svg.text-diaper')).toBeNull()
    expect(screen.getByRole('status')).toHaveAttribute('data-tone', 'error')
  })
  test('a normal toast keeps the check', () => {
    const { container } = renderApp(<Toast toast={{ message: 'Logged' }} onClose={() => {}} />)
    expect(container.querySelector('svg.text-diaper')).not.toBeNull()
    expect(screen.getByRole('status')).toHaveAttribute('data-tone', 'success')
  })
})
