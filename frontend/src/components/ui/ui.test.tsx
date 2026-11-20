import { Badge } from './badge'
import { ChipGroup } from './chip'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import { expect, test, vi } from 'vitest'
import i18n from '../../i18n'
import Sheet from '../Sheet'
import { HalfGauge } from './gauge'
import { Segmented } from './segmented'
import { SlideToConfirm } from './slide-confirm'
import { Stepper } from './stepper'

const wrap = (ui: React.ReactElement) => render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>)

function SegHarness() {
  const [v, setV] = useState('feeds')
  return (
    <Segmented
      label="Pattern"
      value={v}
      onChange={setV}
      options={[
        { value: 'feeds', label: 'Feeds' },
        { value: 'sleep', label: 'Sleep' },
      ]}
    />
  )
}

test('segmented is a radiogroup and arrow keys move selection', async () => {
  wrap(<SegHarness />)
  expect(screen.getByRole('radiogroup', { name: 'Pattern' })).toBeInTheDocument()
  const feeds = screen.getByRole('radio', { name: 'Feeds' })
  expect(feeds).toBeChecked()
  feeds.focus()
  await userEvent.keyboard('{ArrowRight}')
  expect(screen.getByRole('radio', { name: 'Sleep' })).toBeChecked()
  await userEvent.keyboard('{ArrowLeft}')
  expect(screen.getByRole('radio', { name: 'Feeds' })).toBeChecked()
})

function StepHarness({ start }: { start: number }) {
  const [v, setV] = useState(start)
  return <Stepper label="Amount" unit="ml" value={v} step={10} min={0} max={30} onChange={setV} />
}

test('stepper stops at max and min', async () => {
  wrap(<StepHarness start={20} />)
  const more = screen.getByRole('button', { name: /Amount \+10 ml/ })
  const less = screen.getByRole('button', { name: /Amount −10 ml/ })
  await userEvent.click(more)
  expect(screen.getByText('30')).toBeInTheDocument()
  expect(more).toBeDisabled()
  await userEvent.click(less)
  await userEvent.click(less)
  await userEvent.click(less)
  expect(screen.getByText('0')).toBeInTheDocument()
  expect(less).toBeDisabled()
})

test('slide to confirm confirms on Enter and not on a short drag', () => {
  const onConfirm = vi.fn()
  wrap(<SlideToConfirm label="Slide to give 0.25 ml" onConfirm={onConfirm} />)
  const track = screen.getByTestId('slide-track')
  track.getBoundingClientRect = () => ({ width: 300, left: 0, right: 300, top: 0, bottom: 56, height: 56, x: 0, y: 0, toJSON() {} })
  fireEvent.pointerDown(track, { clientX: 0, pointerId: 1 })
  fireEvent.pointerMove(track, { clientX: 40, pointerId: 1 })
  fireEvent.pointerUp(track, { clientX: 40, pointerId: 1 })
  expect(onConfirm).not.toHaveBeenCalled()
  fireEvent.pointerDown(track, { clientX: 0, pointerId: 1 })
  fireEvent.pointerMove(track, { clientX: 290, pointerId: 1 })
  fireEvent.pointerUp(track, { clientX: 290, pointerId: 1 })
  expect(onConfirm).toHaveBeenCalledTimes(1)
})

test('slide to confirm thumb confirms with Enter', async () => {
  const onConfirm = vi.fn()
  wrap(<SlideToConfirm label="Slide to give" onConfirm={onConfirm} />)
  screen.getByRole('button', { name: 'Slide to give' }).focus()
  await userEvent.keyboard('{Enter}')
  expect(onConfirm).toHaveBeenCalledTimes(1)
})

test('a first tap on the slide thumb only arms it; a second tap confirms', async () => {
  const onConfirm = vi.fn()
  wrap(<SlideToConfirm label="Slide to give" armedLabel="Tap again to give" onConfirm={onConfirm} />)
  await userEvent.click(screen.getByRole('button', { name: 'Slide to give' }))
  expect(onConfirm).not.toHaveBeenCalled()
  const armed = screen.getByRole('button', { name: 'Tap again to give' })
  await userEvent.click(armed)
  expect(onConfirm).toHaveBeenCalledTimes(1)
})

test('an armed slide thumb disarms after a few seconds', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const onConfirm = vi.fn()
  wrap(<SlideToConfirm label="Slide to give" armedLabel="Tap again to give" onConfirm={onConfirm} />)
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  await user.click(screen.getByRole('button', { name: 'Slide to give' }))
  await act(async () => void vi.advanceTimersByTime(5000))
  expect(screen.getByRole('button', { name: 'Slide to give' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Slide to give' }))
  expect(onConfirm).not.toHaveBeenCalled()
  vi.useRealTimers()
})

test('slide to confirm does nothing when disabled', async () => {
  const onConfirm = vi.fn()
  wrap(<SlideToConfirm label="Slide to give" onConfirm={onConfirm} disabled />)
  expect(screen.getByRole('button', { name: 'Slide to give' })).toBeDisabled()
})

function SheetHarness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      {open && (
        <Sheet title="Log a feed" onClose={() => setOpen(false)}>
          <input aria-label="note" />
        </Sheet>
      )}
    </>
  )
}

test('sheet closes on Escape and returns focus', async () => {
  wrap(<SheetHarness />)
  const opener = screen.getByRole('button', { name: 'Open' })
  await userEvent.click(opener)
  expect(screen.getByRole('dialog', { name: 'Log a feed' })).toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(opener).toHaveFocus()
})

test('gauge label is exposed as img name', () => {
  render(
    <HalfGauge fraction={0.5} label="50% of the feed interval passed" tone="feed">
      <span>50m</span>
    </HalfGauge>,
  )
  expect(screen.getByRole('img', { name: '50% of the feed interval passed' })).toBeInTheDocument()
})

// --- badge: soft, solid and outline, with a status dot that can pulse ------------------------------------------------------

test('a badge is a soft pill in its tone by default', () => {
  render(<Badge tone="feed">Feeding</Badge>)
  const b = screen.getByText('Feeding')
  expect(b.className).toContain('bg-feed-bg')
  expect(b.className).toContain('rounded-full')
})

test('solid and outline badges use the tone strongly or only as a border', () => {
  render(
    <>
      <Badge tone="feed" variant="solid">Solid</Badge>
      <Badge tone="feed" variant="outline">Outline</Badge>
    </>,
  )
  expect(screen.getByText('Solid').className).toContain('bg-feed ')
  expect(screen.getByText('Outline').className).toContain('border-feed')
  expect(screen.getByText('Outline').className).not.toContain('bg-feed')
})

test('a dot badge has a status dot, and pulse adds a ping ring that respects reduced motion', () => {
  const { container, rerender } = render(<Badge tone="feed" dot>Live</Badge>)
  expect(container.querySelector('[data-badge-dot]')).not.toBeNull()
  expect(container.querySelector('.animate-ping')).toBeNull()
  rerender(<Badge tone="feed" dot pulse>Live</Badge>)
  const ping = container.querySelector('.animate-ping')!
  expect(ping).not.toBeNull()
  expect(ping.className).toContain('motion-reduce:animate-none')
  expect(container.querySelector('[data-badge-dot]')!.getAttribute('aria-hidden')).toBe('true')
})

test('a badge without dot or pulse draws neither', () => {
  const { container } = render(<Badge>Plain</Badge>)
  expect(container.querySelector('[data-badge-dot]')).toBeNull()
  expect(container.querySelector('.animate-ping')).toBeNull()
})

// --- a sheet takes the colour of the card it was opened from -------------------------------------------------------------

test('a sheet with a tone is marked with it but stays plain (the tint was tried and dropped)', () => {
  wrap(
    <>
      <Sheet title="Feed sheet" tone="feed" onClose={() => {}}>x</Sheet>
      <Sheet title="Full sheet" tone="med" variant="full" onClose={() => {}}>x</Sheet>
      <Sheet title="Plain sheet" onClose={() => {}}>x</Sheet>
    </>,
  )
  const feed = screen.getByRole('dialog', { name: 'Feed sheet' })
  expect(feed.getAttribute('data-sheet-tone')).toBe('feed')
  expect(feed.className).toContain('bg-surface')
  expect(feed.className).not.toContain('bg-feed-bg')
  const full = screen.getByRole('dialog', { name: 'Full sheet' })
  expect(full.getAttribute('data-sheet-tone')).toBe('med')
  expect(full.className).toContain('bg-app')
  const plain = screen.getByRole('dialog', { name: 'Plain sheet' })
  expect(plain.getAttribute('data-sheet-tone')).toBeNull()
  expect(plain.className).toContain('bg-surface')
})

test('a soft badge has a border in its tone, so it reads as a badge', () => {
  render(<Badge tone="feed">Feeding</Badge>)
  expect(screen.getByText('Feeding').className).toContain('border-feed/30')
})

test('a chip group leaves the gap of the stack it sits in alone (no margin class of its own)', () => {
  // the parent's space-y is a zero-specificity :where rule, so any m-* here would override it and remove the gap below the chips
  render(
    <div className="space-y-4">
      <ChipGroup label="Changed by">
        <span>chip</span>
      </ChipGroup>
      <p>next</p>
    </div>,
  )
  expect(screen.getByRole('group', { name: 'Changed by' }).className).not.toMatch(/(^|\s)-?m[trblxy]?-/)
})

import { MultiSparkline } from './sparkline'

test('a multi sparkline draws one line per series on a shared scale, with zero on the baseline', () => {
  const { container } = render(
    <MultiSparkline
      label="Diapers"
      width={84}
      height={34}
      series={[
        { values: [7, 5, 8], color: 'var(--chart-wet)' },
        { values: [0, 0, 0], color: 'var(--chart-dirty)' },
      ]}
    />,
  )
  expect(screen.getByRole('img', { name: 'Diapers' })).toBeInTheDocument()
  const lines = container.querySelectorAll('path[data-series]')
  expect(lines).toHaveLength(2)
  expect(lines[0]!.getAttribute('stroke')).toBe('var(--chart-wet)')
  // the all-zero series lies flat on the bottom edge (height - pad), not in the middle
  expect(lines[1]!.getAttribute('d')).toBe('M4.0,30.0L42.0,30.0L80.0,30.0')
  // the peak of the wet series (8, the last point) reaches the top (pad)
  expect(lines[0]!.getAttribute('d')).toContain('80.0,4.0')
})
