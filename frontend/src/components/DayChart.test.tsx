import { act, fireEvent, screen, within } from '@testing-library/react'
import { vi } from 'vitest'
import en from '../i18n/en.json'
import { toMarks, type Range } from '../lib/dayChart'
import type { TimelineItem } from '../lib/timeline'
import { formatTime } from '../lib/time'
import { renderApp } from '../test/utils'
import DayChart from './DayChart'

// jsdom has no layout: the chart falls back to 340px wide, so x = 10 + minutes / 1440 * 320
const DAY = new Date(2026, 10, 10)
const at = (h: number, m = 0) => new Date(2026, 10, 10, h, m).toISOString()
const LATE = new Date(2026, 10, 11, 12).getTime()
const xOf = (min: number) => 10 + (min / 1440) * 320
const ITEMS: TimelineItem[] = [
  { kind: 'sleep', id: 's1', at: at(9, 10), data: { started_at: at(9, 10), ended_at: at(10, 25), duration_min: 75 } },
  { kind: 'diaper', id: 'd1', at: at(14, 52), data: { kind: 'wet' } },
  { kind: 'dose', id: 'p1', at: at(14, 52), data: { status: 'given', medicine_name: 'Iron', amount: 1, dose_unit: 'ml' } },
]
const LANES = ['sleep', 'feed', 'diaper', 'dose', 'vital'] as const

function setup(range: Range | null = null, items = ITEMS) {
  const onRange = vi.fn()
  const outerMove = vi.fn()
  renderApp(
    <div onPointerMove={outerMove}>
      <DayChart marks={toMarks(items, DAY, LATE)} lanes={[...LANES]} range={range} view={{ from: 0, to: 1440 }} onRange={onRange} />
    </div>,
  )
  return { onRange, outerMove, chart: screen.getByRole('group', { name: en.dayChart.label }) }
}
const touch = (el: Element, type: 'pointerDown' | 'pointerMove' | 'pointerUp', x: number, y = 100) => fireEvent[type](el, { pointerId: 1, pointerType: 'touch', clientX: x, clientY: y, button: 0 })
const mouse = (el: Element, type: 'pointerDown' | 'pointerMove' | 'pointerUp', x: number, y = 100) => fireEvent[type](el, { pointerId: 2, pointerType: 'mouse', clientX: x, clientY: y, button: 0 })

afterEach(() => vi.useRealTimers())

test('each lane is named inside the chart, and each entry is a mark you can tap', () => {
  const { chart } = setup()
  for (const l of LANES) expect(within(chart).getByText(en.dayChart.lanes[l])).toBeInTheDocument()
  expect(within(chart).getByRole('button', { name: `${en.timeline.slept.replace('{{duration}}', '1h 15m')}, ${formatTime(at(9, 10))}` })).toBeInTheDocument()
  expect(within(chart).getByRole('button', { name: `${en.diaperKinds.wet}, ${formatTime(at(14, 52))}` })).toBeInTheDocument()
})

test('tapping a bar picks its span, a moment picks 10 minutes either side, and an empty spot picks the whole day', () => {
  const { chart, onRange } = setup()
  const sleep = within(chart).getByRole('button', { name: new RegExp(`^${en.timeline.slept.replace('{{duration}}', '1h 15m')}`) })
  touch(sleep, 'pointerDown', 200)
  touch(sleep, 'pointerUp', 200)
  expect(onRange).toHaveBeenLastCalledWith({ from: 550, to: 625 })
  const diaper = within(chart).getByRole('button', { name: new RegExp(`^${en.diaperKinds.wet}`) })
  touch(diaper, 'pointerDown', 300)
  touch(diaper, 'pointerUp', 300)
  expect(onRange).toHaveBeenLastCalledWith({ from: 882, to: 902 })
  const svg = chart.querySelector('svg')!
  touch(svg, 'pointerDown', 30)
  touch(svg, 'pointerUp', 30)
  expect(onRange).toHaveBeenLastCalledWith(null)
})

test('Enter on a mark picks it too', () => {
  const { chart, onRange } = setup()
  fireEvent.keyDown(within(chart).getByRole('button', { name: new RegExp(`^${en.diaperKinds.wet}`) }), { key: 'Enter' })
  expect(onRange).toHaveBeenLastCalledWith({ from: 882, to: 902 })
})

test('a mouse drag picks a range', () => {
  const { chart, onRange } = setup()
  const svg = chart.querySelector('svg')!
  mouse(svg, 'pointerDown', xOf(360))
  mouse(svg, 'pointerMove', xOf(500))
  mouse(svg, 'pointerMove', xOf(720))
  mouse(svg, 'pointerUp', xOf(720))
  expect(onRange).toHaveBeenLastCalledWith({ from: 360, to: 720 })
})

test('a quick sideways touch drag is left to the day swipe; a hold then drag picks a range and stops there', () => {
  vi.useFakeTimers()
  const { chart, onRange, outerMove } = setup()
  const svg = chart.querySelector('svg')!
  touch(svg, 'pointerDown', xOf(360))
  touch(svg, 'pointerMove', xOf(360) + 40)
  touch(svg, 'pointerUp', xOf(360) + 40)
  act(() => vi.advanceTimersByTime(500))
  expect(onRange).not.toHaveBeenCalled()
  expect(outerMove).toHaveBeenCalled()

  outerMove.mockClear()
  touch(svg, 'pointerDown', xOf(120))
  act(() => vi.advanceTimersByTime(400))
  touch(svg, 'pointerMove', xOf(300))
  touch(svg, 'pointerUp', xOf(300))
  expect(onRange).toHaveBeenLastCalledWith({ from: 120, to: 300 })
  expect(outerMove).not.toHaveBeenCalled()
})

test('dragging a handle moves that end of the range', () => {
  const { chart, onRange } = setup({ from: 360, to: 720 })
  const end = within(chart).getByRole('slider', { name: en.dayChart.rangeEnd })
  touch(end, 'pointerDown', xOf(720))
  touch(end, 'pointerMove', xOf(900))
  touch(end, 'pointerUp', xOf(900))
  expect(onRange).toHaveBeenLastCalledWith({ from: 360, to: 900 })
})

test('marks outside the range fade', () => {
  const { chart } = setup({ from: 840, to: 900 })
  expect(within(chart).getByRole('button', { name: new RegExp(`^${en.diaperKinds.wet}`) }).closest('[data-dim]')).toHaveAttribute('data-dim', 'false')
  expect(within(chart).getByRole('button', { name: new RegExp(`^${en.timeline.slept.split(' ')[0]}`) }).closest('[data-dim]')).toHaveAttribute('data-dim', 'true')
})

test('more than three moments at one time in a lane show a +N badge', () => {
  const many: TimelineItem[] = [1, 2, 3, 4, 5].map((i) => ({ kind: 'diaper', id: `d${i}`, at: at(8, 30), data: { kind: 'wet' } }))
  const { chart } = setup(null, many)
  expect(within(chart).getByText('+2')).toBeInTheDocument()
})
