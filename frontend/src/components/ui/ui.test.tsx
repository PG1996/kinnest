import { fireEvent, render, screen } from '@testing-library/react'
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
