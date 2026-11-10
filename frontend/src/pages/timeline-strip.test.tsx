import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import en from '../i18n/en.json'
import { toLocalDate } from '../lib/time'
import { ME_ADMIN, mockApi, renderApp } from '../test/utils'
import Timeline from './Timeline'

const midnight = (offset = 0) => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset) }
const at = (offset: number, h: number) => { const d = midnight(offset); d.setHours(h); return d.toISOString() }
const chipName = (d: Date) => d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
// every range asks the same mock, which gives back all of these; each day keeps only its own
const ITEMS = [
  { kind: 'feed', id: 'f1', at: at(0, 0), data: { type: 'formula', quantity_ml: 60, duration_min: null, fed_by_name: 'Mom' } },
  { kind: 'feed', id: 'f2', at: at(-2, 9), data: { type: 'formula', quantity_ml: 90, duration_min: null, fed_by_name: 'Mom' } },
  { kind: 'diaper', id: 'd2', at: at(-2, 10), data: { kind: 'wet', changed_by_name: 'Nani' } },
]
const api = () => ({ 'GET /api/me': { body: ME_ADMIN }, 'GET /api/timeline': { body: { items: ITEMS } } })
const froms = (calls: { key: string; url: string }[]) => calls.filter((c) => c.key === 'GET /api/timeline').map((c) => new URL(c.url, 'http://x').searchParams.get('from'))
const strip = () => screen.getByRole('group', { name: en.dayPager.strip })
const chip = (d: Date) => within(strip()).getByRole('button', { name: new RegExp(`^${chipName(d)}`) })
const section = (d: Date) => document.querySelector(`[data-day="${toLocalDate(d)}"]`)

test('the timeline has a strip of the last three weeks, today chosen', async () => {
  mockApi(api())
  renderApp(<Timeline />)
  await screen.findByText(`${en.feedTypes.formula} · 60 ml`)
  expect(within(strip()).getAllByRole('button')).toHaveLength(21)
  expect(chip(midnight(0))).toHaveAttribute('aria-pressed', 'true')
})

test('each day says what was logged on it', async () => {
  mockApi(api())
  renderApp(<Timeline />)
  await waitFor(() => expect(chip(midnight(-2))).toHaveAccessibleName(`${chipName(midnight(-2))}, ${en.timeline.filters.feed}, ${en.timeline.filters.diaper}`))
  expect(chip(midnight(-1))).toHaveAccessibleName(chipName(midnight(-1)))
})

test('tapping an older day loads the days down to it and shows it', async () => {
  const calls = mockApi(api())
  renderApp(<Timeline />)
  await screen.findByText(`${en.feedTypes.formula} · 60 ml`)
  await userEvent.click(chip(midnight(-2)))
  await waitFor(() => expect(section(midnight(-2))).not.toBeNull())
  expect(section(midnight(-1))).not.toBeNull()
  expect(froms(calls)).toContain(midnight(-2).toISOString())
  expect(chip(midnight(-2))).toHaveAttribute('aria-pressed', 'true')
  expect(await within(section(midnight(-2)) as HTMLElement).findByText(`${en.feedTypes.formula} · 90 ml`)).toBeInTheDocument()
})

test('scrolling the list moves the strip to the day at the top', async () => {
  mockApi(api())
  renderApp(<Timeline />)
  await screen.findByText(`${en.feedTypes.formula} · 60 ml`)
  await userEvent.click(chip(midnight(-2)))
  await waitFor(() => expect(section(midnight(-2))).not.toBeNull())
  // lay the days out: today scrolled past, yesterday at the top under the strip, the day before below
  const tops: Record<string, number> = { [toLocalDate(midnight(0))]: -400, [toLocalDate(midnight(-1))]: 2, [toLocalDate(midnight(-2))]: 500 }
  for (const [day, top] of Object.entries(tops)) {
    const el = document.querySelector(`[data-day="${day}"]`) as HTMLElement
    el.getBoundingClientRect = () => ({ top, bottom: top + 300, left: 0, right: 0, width: 0, height: 300, x: 0, y: top, toJSON: () => ({}) })
  }
  fireEvent.scroll(window)
  await waitFor(() => expect(chip(midnight(-1))).toHaveAttribute('aria-pressed', 'true'))
})

test('reaching the end of the list loads the day before by itself', async () => {
  const seen: ((entries: { isIntersecting: boolean }[]) => void)[] = []
  vi.stubGlobal('IntersectionObserver', class {
    constructor(cb: (entries: { isIntersecting: boolean }[]) => void) { seen.push(cb) }
    observe() {}
    disconnect() {}
  })
  const calls = mockApi(api())
  renderApp(<Timeline />)
  await screen.findByText(`${en.feedTypes.formula} · 60 ml`)
  act(() => seen.at(-1)!([{ isIntersecting: true }]))
  await waitFor(() => expect(froms(calls)).toContain(midnight(-1).toISOString()))
  expect(section(midnight(-1))).not.toBeNull()
})
