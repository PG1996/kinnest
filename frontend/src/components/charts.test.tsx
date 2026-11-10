import { fireEvent, screen, within } from '@testing-library/react'
import en from '../i18n/en.json'
import { diaperStats } from '../lib/diaperDays'
import { feedGaps } from '../lib/feedDay'
import { formatTime } from '../lib/time'
import { ME_ADMIN, mockApi, renderApp } from '../test/utils'
import DiaperStrips from './DiaperStrips'
import DiaperTiles from './DiaperTiles'
import FeedClock from './FeedClock'
import FeedGaps from './FeedGaps'

const at = (h: number, m = 0, daysBack = 0) => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysBack, h, m) }
const midnight = at(0)
const feed = (id: string, when: Date, over: object = {}) => ({ id, type: 'formula', started_at: when.toISOString(), duration_min: null, quantity_ml: 60, note: '', fed_by_name: 'Mom', ...over }) as never
const FEEDS = [feed('a', at(1, 0)), feed('b', at(3, 30), { type: 'breast_left', quantity_ml: null, duration_min: 20 }), feed('c', at(8, 0))]
const diaper = (id: string, kind: string, when: Date) => ({ id, kind, at: when.toISOString(), changed_by_name: 'Mom' }) as never

// --- feed clock ---------------------------------------------------------------------------------------------------

test('the feed clock draws an arc for each breastfeed and a dot for each bottle', () => {
  mockApi({ 'GET /api/me': { body: ME_ADMIN } })
  renderApp(<FeedClock day={midnight} feeds={FEEDS} />)
  const clock = screen.getByRole('img', { name: /3 feeds/ })
  expect(clock.querySelectorAll('[data-kind="breast"]')).toHaveLength(1)
  expect(clock.querySelectorAll('[data-kind="bottle"]')).toHaveLength(2)
})

test('tapping a feed on the clock shows its time and amount in the middle', () => {
  mockApi({ 'GET /api/me': { body: ME_ADMIN } })
  const { container } = renderApp(<FeedClock day={midnight} feeds={FEEDS} />)
  fireEvent.click(container.querySelector('[data-id="b"]')!)
  expect(screen.getByTestId('feed-clock-centre')).toHaveTextContent(formatTime(at(3, 30)))
  expect(screen.getByTestId('feed-clock-centre')).toHaveTextContent('20 min')
})

test('the feed clock has a legend for breast and bottle', () => {
  mockApi({ 'GET /api/me': { body: ME_ADMIN } })
  renderApp(<FeedClock day={midnight} feeds={FEEDS} />)
  expect(screen.getByText(en.feeds.legendBreast)).toBeInTheDocument()
  expect(screen.getByText(en.feeds.legendBottle)).toBeInTheDocument()
})

// --- gaps ----------------------------------------------------------------------------------------------------------

test('feedGaps measures from one start to the next, oldest first', () => {
  const gaps = feedGaps([FEEDS[2]!, FEEDS[0]!, FEEDS[1]!])
  expect(gaps.map((g) => g.minutes)).toEqual([150, 270])
  expect(feedGaps([FEEDS[0]!])).toEqual([])
})

test('gap bars mark the ones longer than the feed interval and draw the interval line', () => {
  mockApi({ 'GET /api/me': { body: ME_ADMIN } })
  const { container } = renderApp(<FeedGaps feeds={FEEDS} intervalMin={180} />)
  const bars = container.querySelectorAll('[data-gap]')
  expect(bars).toHaveLength(2)
  expect([...bars].map((b) => b.getAttribute('data-over'))).toEqual(['false', 'true'])
  expect(container.querySelector('[data-testid="gap-target"]')).not.toBeNull()
})

test('tapping a gap bar says from when to when', () => {
  mockApi({ 'GET /api/me': { body: ME_ADMIN } })
  const { container } = renderApp(<FeedGaps feeds={FEEDS} intervalMin={180} />)
  fireEvent.click(container.querySelectorAll('[data-gap]')[1]!)
  expect(screen.getByRole('status')).toHaveTextContent(`${formatTime(at(3, 30))} → ${formatTime(at(8, 0))}`)
  expect(screen.getByRole('status')).toHaveTextContent('4h 30m')
})

test('with fewer than two feeds there are no gaps to draw', () => {
  mockApi({ 'GET /api/me': { body: ME_ADMIN } })
  const { container } = renderApp(<FeedGaps feeds={[FEEDS[0]!]} intervalMin={180} />)
  expect(container).toBeEmptyDOMElement()
})

// --- diaper tiles and day strips -----------------------------------------------------------------------------------

const DIAPERS = [diaper('1', 'wet', at(1)), diaper('2', 'wet', at(2)), diaper('3', 'dirty', at(3)), diaper('4', 'both', at(4)), diaper('5', 'wet', at(5, 0, 2)), diaper('6', 'wet', at(6, 0, 2))]
const NOW = at(7).getTime()

test('the tiles show wet and dirty against the usual, the last wet diaper and the longest gap', () => {
  mockApi({ 'GET /api/me': { body: ME_ADMIN } })
  renderApp(<DiaperTiles stats={diaperStats(DIAPERS, midnight, NOW)} nowMs={NOW} isToday />)
  const wet = within(screen.getByTestId('tile-wet'))
  expect(wet.getByText('3')).toBeInTheDocument() // wet and both
  expect(wet.getByText(en.diapers.usual.replace('{{n}}', '2'))).toBeInTheDocument()
  const dirty = within(screen.getByTestId('tile-dirty'))
  expect(dirty.getByText('2')).toBeInTheDocument() // dirty and both
  expect(within(screen.getByTestId('tile-last-wet')).getByText(en.diapers.ago.replace('{{ago}}', '3h 0m'))).toBeInTheDocument() // the 4:00 both
  expect(within(screen.getByTestId('tile-gap')).getByText('1d 19h')).toBeInTheDocument() // 6:00 two days ago -> 1:00 today: the longest wait that ended today
})

test('on a past day the last wet diaper is a time, not "ago"', () => {
  mockApi({ 'GET /api/me': { body: ME_ADMIN } })
  const day = at(0, 0, 2)
  renderApp(<DiaperTiles stats={diaperStats(DIAPERS, day, NOW)} nowMs={NOW} isToday={false} />)
  expect(within(screen.getByTestId('tile-last-wet')).getByText(formatTime(at(6, 0, 2)))).toBeInTheDocument()
})

test('with no data the tiles show dashes and no usual', () => {
  mockApi({ 'GET /api/me': { body: ME_ADMIN } })
  renderApp(<DiaperTiles stats={diaperStats([], midnight, NOW)} nowMs={NOW} isToday />)
  expect(within(screen.getByTestId('tile-last-wet')).getByText('—')).toBeInTheDocument()
  expect(within(screen.getByTestId('tile-gap')).getByText('—')).toBeInTheDocument()
  expect(screen.queryByText(/usual/)).not.toBeInTheDocument()
})

const strips = (day = midnight, diapers: unknown[] = DIAPERS) => renderApp(<DiaperStrips diapers={diapers as never} day={day} nowMs={NOW} />)
const rowsOf = (c: HTMLElement) => c.querySelectorAll('[data-strip]')

test('the strips are seven days, one mark per diaper by kind, the chosen day marked, with a now marker for today', () => {
  mockApi({ 'GET /api/me': { body: ME_ADMIN } })
  const { container } = strips()
  const rows = rowsOf(container)
  expect(rows).toHaveLength(7)
  expect(rows[6]!.getAttribute('aria-current')).toBe('date')
  expect(rows[6]!.querySelectorAll('[data-kind]')).toHaveLength(4)
  expect(rows[6]!.querySelectorAll('[data-kind="dirty"]')).toHaveLength(1)
  expect(rows[4]!.querySelectorAll('[data-kind]')).toHaveLength(2)
  expect(rows[6]!.getAttribute('aria-label')).toContain('3 wet')
  expect(container.querySelector('[data-testid="strip-now"]')).not.toBeNull()
  for (const k of ['wet', 'dirty', 'both'] as const) expect(screen.getByText(en.diaperKinds[k])).toBeInTheDocument()
})

test('the strips are drawn as vector shapes, so they stay sharp at any size', () => {
  mockApi({ 'GET /api/me': { body: ME_ADMIN } })
  const { container } = strips()
  expect(container.querySelector('svg')).not.toBeNull()
  expect(container.querySelector('[data-strip] [data-kind="wet"]')!.tagName.toLowerCase()).toBe('circle')
  expect(container.querySelector('[data-strip] [data-kind="dirty"]')!.tagName.toLowerCase()).toBe('rect')
  expect(container.querySelector('[data-strip] [data-kind="both"]')!.tagName.toLowerCase()).toBe('polygon')
})

test('a mark sits at its time of day, and there is no now marker on a past day', () => {
  mockApi({ 'GET /api/me': { body: ME_ADMIN } })
  const { container } = strips(midnight, [diaper('n', 'wet', at(6, 0))])
  expect(parseFloat(rowsOf(container)[6]!.querySelector('[data-kind]')!.getAttribute('data-pos')!)).toBeCloseTo(0.25, 2) // 6 AM is a quarter of the way along
  const past = strips(at(0, 0, 1), [])
  expect(past.container.querySelector('[data-testid="strip-now"]')).toBeNull()
})

test('zooming to 6 hours shows a window around now, and the arrows move it', () => {
  mockApi({ 'GET /api/me': { body: ME_ADMIN } })
  const { container } = strips()
  fireEvent.click(screen.getByRole('radio', { name: en.diapers.zoom6 }))
  expect(rowsOf(container)[6]!.querySelectorAll('[data-kind]')).toHaveLength(1) // 4:00 to 10:00 around the 7:00 now: only the 4:00 diaper
  expect(screen.getByText(`${formatTime(at(4))} – ${formatTime(at(10))}`)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: en.diapers.zoomLater }))
  expect(rowsOf(container)[6]!.querySelectorAll('[data-kind]')).toHaveLength(0) // 10:00 to 16:00
  fireEvent.click(screen.getByRole('button', { name: en.diapers.zoomEarlier }))
  fireEvent.click(screen.getByRole('button', { name: en.diapers.zoomEarlier }))
  expect(rowsOf(container)[6]!.querySelectorAll('[data-kind]')).toHaveLength(4) // the window stops at midnight: 0:00 to 6:00
  expect(screen.getByRole('button', { name: en.diapers.zoomEarlier })).toBeDisabled()
})

test('zooming back to 24 hours shows the whole day again, and the arrows only matter when zoomed', () => {
  mockApi({ 'GET /api/me': { body: ME_ADMIN } })
  const { container } = strips()
  expect(screen.queryByRole('button', { name: en.diapers.zoomLater })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('radio', { name: en.diapers.zoom12 }))
  fireEvent.click(screen.getByRole('radio', { name: en.diapers.zoom24 }))
  expect(rowsOf(container)[6]!.querySelectorAll('[data-kind]')).toHaveLength(4)
})

test('tapping a mark says when it was, what kind and who changed it', () => {
  mockApi({ 'GET /api/me': { body: ME_ADMIN } })
  const { container } = strips()
  fireEvent.click(rowsOf(container)[6]!.querySelector('[data-kind="dirty"]')!.closest('[data-mark]')!)
  expect(screen.getByRole('status')).toHaveTextContent(`${formatTime(at(3))} · ${en.diaperKinds.dirty} · ${en.home.by.replace('{{name}}', 'Mom')}`)
})
