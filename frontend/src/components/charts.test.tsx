import { fireEvent, screen } from '@testing-library/react'
import en from '../i18n/en.json'
import { diaperWeek } from '../lib/diaperWeek'
import { feedGaps } from '../lib/feedDay'
import { formatTime } from '../lib/time'
import { ME_ADMIN, mockApi, renderApp } from '../test/utils'
import DiaperWeek from './DiaperWeek'
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

// --- diaper week ---------------------------------------------------------------------------------------------------

const DIAPERS = [diaper('1', 'wet', at(1)), diaper('2', 'wet', at(2)), diaper('3', 'dirty', at(3)), diaper('4', 'both', at(4)), diaper('5', 'wet', at(5, 0, 2))]

test('diaperWeek counts each kind for the seven days ending on the day', () => {
  const week = diaperWeek(DIAPERS, midnight)
  expect(week).toHaveLength(7)
  expect(week.at(-1)).toMatchObject({ wet: 2, dirty: 1, both: 1 })
  expect(week.at(-3)).toMatchObject({ wet: 1, dirty: 0, both: 0 })
  expect(week[0]).toMatchObject({ wet: 0, dirty: 0, both: 0 })
})

test('the week chart stacks wet, both and dirty per day and marks the chosen day', () => {
  mockApi({ 'GET /api/me': { body: ME_ADMIN } })
  const { container } = renderApp(<DiaperWeek diapers={DIAPERS} day={midnight} />)
  const days = container.querySelectorAll('[data-day]')
  expect(days).toHaveLength(7)
  const last = days[6]!
  expect(last.getAttribute('aria-current')).toBe('date')
  expect(last.querySelectorAll('[data-kind]')).toHaveLength(3)
  expect(container.querySelector('[data-testid="wet-target"]')).not.toBeNull()
  for (const k of ['wet', 'dirty', 'both'] as const) expect(screen.getByText(en.diaperKinds[k])).toBeInTheDocument()
})

test('tapping a day in the week chart shows its counts', () => {
  mockApi({ 'GET /api/me': { body: ME_ADMIN } })
  const { container } = renderApp(<DiaperWeek diapers={DIAPERS} day={midnight} />)
  fireEvent.click(container.querySelectorAll('[data-day]')[6]!)
  const tip = screen.getByRole('status')
  expect(tip).toHaveTextContent('2 wet, 1 both, 1 dirty')
})
