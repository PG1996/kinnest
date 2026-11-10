import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type FormEvent } from 'react'
import { afterAll, beforeAll, vi } from 'vitest'
import '../../i18n'
import en from '../../i18n/en.json'
import Sheet from '../Sheet'
import { DateField, DateTimeField, TimeField } from './datetime'

// 1:20 AM, so "later than now today" and "last night" are both easy to reach
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 11, 1, 20))
})
afterAll(() => vi.useRealTimers())

function Harness({ initial = '2026-11-11T00:45', mode, clearable, onChange = () => {} }: { initial?: string; mode?: 'past' | 'planned'; clearable?: boolean; onChange?: (v: string) => void }) {
  const [v, setV] = useState(initial)
  return (
    <>
      <label htmlFor="when">When</label>
      <DateTimeField id="when" label="When" value={v} mode={mode} clearable={clearable} onChange={(x) => { setV(x); onChange(x) }} />
      <output data-testid="value">{v}</output>
    </>
  )
}
const dayLabel = (d: Date) => d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
const monthLabel = (d: Date) => d.toLocaleDateString([], { month: 'long', year: 'numeric' })
const value = () => screen.getByTestId('value').textContent
const picker = () => screen.getByRole('dialog', { name: 'When' })
const option = (wheel: string, name: string) => within(within(picker()).getByRole('listbox', { name: wheel })).getByRole('option', { name })

test('the field reads the time in words, and is named by its label', () => {
  render(<Harness />)
  expect(screen.getByRole('button', { name: 'When' })).toHaveTextContent(`${en.picker.today}, 12:45 AM`)
})

test('the picker opens on the current time, with the day and the time wheels', async () => {
  render(<Harness />)
  await userEvent.click(screen.getByRole('button', { name: 'When' }))
  expect(within(picker()).getByRole('button', { name: en.picker.today })).toHaveAttribute('aria-pressed', 'true')
  expect(option(en.picker.hour, '12')).toHaveAttribute('aria-selected', 'true')
  expect(option(en.picker.minute, '45')).toHaveAttribute('aria-selected', 'true')
  expect(option(en.picker.ampm, 'AM')).toHaveAttribute('aria-selected', 'true')
  // a screen reader hears the chosen item of each wheel
  const minutes = within(picker()).getByRole('listbox', { name: en.picker.minute })
  expect(minutes.getAttribute('aria-activedescendant')).toBe(option(en.picker.minute, '45').id)
})

test('choosing a time and Done saves it', async () => {
  render(<Harness />)
  await userEvent.click(screen.getByRole('button', { name: 'When' }))
  await userEvent.click(option(en.picker.hour, '1'))
  await userEvent.click(option(en.picker.minute, '05'))
  await userEvent.click(within(picker()).getByRole('button', { name: en.picker.done }))
  expect(value()).toBe('2026-11-11T01:05')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('a time later than now today is taken as last night, and says so', async () => {
  render(<Harness />)
  await userEvent.click(screen.getByRole('button', { name: 'When' }))
  await userEvent.click(option(en.picker.hour, '11'))
  await userEvent.click(option(en.picker.minute, '30'))
  await userEvent.click(option(en.picker.ampm, 'PM'))
  expect(within(picker()).getByRole('status')).toHaveTextContent(en.picker.movedYesterday.replace('{{time}}', '11:30 PM'))
  expect(within(picker()).getByRole('button', { name: en.picker.yesterday })).toHaveAttribute('aria-pressed', 'true')
  await userEvent.click(within(picker()).getByRole('button', { name: en.picker.done }))
  expect(value()).toBe('2026-11-10T23:30')
})

test('Yesterday keeps the time on the day before', async () => {
  render(<Harness />)
  await userEvent.click(screen.getByRole('button', { name: 'When' }))
  await userEvent.click(within(picker()).getByRole('button', { name: en.picker.yesterday }))
  await userEvent.click(within(picker()).getByRole('button', { name: en.picker.done }))
  expect(value()).toBe('2026-11-10T00:45')
})

test('Other day opens a calendar, with no days after today', async () => {
  render(<Harness />)
  await userEvent.click(screen.getByRole('button', { name: 'When' }))
  await userEvent.click(within(picker()).getByRole('button', { name: en.picker.otherDay }))
  const cal = within(picker()).getByRole('group', { name: monthLabel(new Date(2026, 10, 1)) })
  expect(within(cal).getByRole('button', { name: dayLabel(new Date(2026, 10, 12)) })).toBeDisabled()
  expect(within(picker()).getByRole('button', { name: en.picker.nextMonth })).toBeDisabled()
  await userEvent.click(within(picker()).getByRole('button', { name: en.picker.prevMonth }))
  await userEvent.click(within(within(picker()).getByRole('group', { name: monthLabel(new Date(2026, 9, 1)) })).getByRole('button', { name: dayLabel(new Date(2026, 9, 31)) }))
  await userEvent.click(within(picker()).getByRole('button', { name: en.picker.done }))
  expect(value()).toBe('2026-10-31T00:45')
})

test('Now sets the time to now', async () => {
  render(<Harness initial="2026-11-09T08:00" />)
  await userEvent.click(screen.getByRole('button', { name: 'When' }))
  await userEvent.click(within(picker()).getByRole('button', { name: en.picker.now }))
  await userEvent.click(within(picker()).getByRole('button', { name: en.picker.done }))
  expect(value()).toBe('2026-11-11T01:20')
})

test('Close keeps the time it had', async () => {
  const onChange = vi.fn()
  render(<Harness onChange={onChange} />)
  await userEvent.click(screen.getByRole('button', { name: 'When' }))
  await userEvent.click(option(en.picker.hour, '1'))
  await userEvent.click(within(picker()).getByRole('button', { name: en.home.close }))
  expect(value()).toBe('2026-11-11T00:45')
  expect(onChange).not.toHaveBeenCalled()
})

test('an empty field asks for a time and the picker starts at now', async () => {
  render(<Harness initial="" />)
  expect(screen.getByRole('button', { name: 'When' })).toHaveTextContent(en.picker.pick)
  await userEvent.click(screen.getByRole('button', { name: 'When' }))
  expect(option(en.picker.hour, '1')).toHaveAttribute('aria-selected', 'true')
  expect(option(en.picker.minute, '20')).toHaveAttribute('aria-selected', 'true')
})

test('a field that may be empty can be cleared', async () => {
  render(<Harness clearable />)
  await userEvent.click(screen.getByRole('button', { name: 'When' }))
  await userEvent.click(within(picker()).getByRole('button', { name: en.picker.clear }))
  expect(value()).toBe('')
})

test('something planned can be tomorrow', async () => {
  render(<Harness mode="planned" />)
  await userEvent.click(screen.getByRole('button', { name: 'When' }))
  expect(within(picker()).queryByRole('button', { name: en.picker.yesterday })).not.toBeInTheDocument()
  await userEvent.click(within(picker()).getByRole('button', { name: en.picker.tomorrow }))
  await userEvent.click(option(en.picker.hour, '11'))
  await userEvent.click(within(picker()).getByRole('button', { name: en.picker.done }))
  expect(value()).toBe('2026-11-12T11:45')
})

test('Escape closes the picker only, not the form under it', async () => {
  const closeForm = vi.fn()
  render(
    <Sheet title="Form" onClose={closeForm}>
      <Harness />
    </Sheet>,
  )
  await userEvent.click(screen.getByRole('button', { name: 'When' }))
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog', { name: 'When' })).not.toBeInTheDocument()
  expect(closeForm).not.toHaveBeenCalled()
})

test('the picker inside a form never submits it: Done, Clear and Close are its own', async () => {
  const submit = vi.fn((e: FormEvent) => e.preventDefault())
  render(
    <form onSubmit={submit}>
      <Harness clearable />
    </form>,
  )
  await userEvent.click(screen.getByRole('button', { name: 'When' }))
  await userEvent.click(within(picker()).getByRole('button', { name: en.picker.done }))
  await userEvent.click(screen.getByRole('button', { name: 'When' }))
  await userEvent.click(within(picker()).getByRole('button', { name: en.home.close }))
  await userEvent.click(screen.getByRole('button', { name: 'When' }))
  await userEvent.click(within(picker()).getByRole('button', { name: en.picker.clear }))
  expect(submit).not.toHaveBeenCalled()
})

function DateHarness({ initial = '', mode, clearable }: { initial?: string; mode?: 'past' | 'planned'; clearable?: boolean }) {
  const [v, setV] = useState(initial)
  return (
    <>
      <DateField label="Given on" labelled={false} value={v} mode={mode} clearable={clearable} onChange={setV} />
      <output data-testid="value">{v}</output>
    </>
  )
}
const daySheet = () => screen.getByRole('dialog', { name: 'Given on' })

test('a date field asks for a day, and picks one from the calendar', async () => {
  render(<DateHarness />)
  const field = screen.getByRole('button', { name: 'Given on' })
  expect(field).toHaveTextContent(en.picker.pickDay)
  await userEvent.click(field)
  expect(within(daySheet()).getByRole('button', { name: dayLabel(new Date(2026, 10, 12)) })).toBeDisabled()
  await userEvent.click(within(daySheet()).getByRole('button', { name: dayLabel(new Date(2026, 10, 3)) }))
  await userEvent.click(within(daySheet()).getByRole('button', { name: en.picker.done }))
  expect(value()).toBe('2026-11-03')
  expect(field).toHaveTextContent(new Date(2026, 10, 3).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }))
})

test('Yesterday in a date field, and the calendar follows it', async () => {
  render(<DateHarness initial="2026-09-15" />)
  await userEvent.click(screen.getByRole('button', { name: 'Given on' }))
  expect(within(daySheet()).getByRole('group', { name: monthLabel(new Date(2026, 8, 1)) })).toBeInTheDocument()
  await userEvent.click(within(daySheet()).getByRole('button', { name: en.picker.yesterday }))
  expect(within(daySheet()).getByRole('group', { name: monthLabel(new Date(2026, 10, 1)) })).toBeInTheDocument()
  await userEvent.click(within(daySheet()).getByRole('button', { name: en.picker.done }))
  expect(value()).toBe('2026-11-10')
})

test('a planned date can be after today, and an optional one cleared', async () => {
  render(<DateHarness initial="2026-11-11" mode="planned" clearable />)
  await userEvent.click(screen.getByRole('button', { name: 'Given on' }))
  await userEvent.click(within(daySheet()).getByRole('button', { name: en.picker.nextMonth }))
  await userEvent.click(within(daySheet()).getByRole('button', { name: dayLabel(new Date(2026, 11, 25)) }))
  await userEvent.click(within(daySheet()).getByRole('button', { name: en.picker.done }))
  expect(value()).toBe('2026-12-25')
  await userEvent.click(screen.getByRole('button', { name: 'Given on' }))
  await userEvent.click(within(daySheet()).getByRole('button', { name: en.picker.clear }))
  expect(value()).toBe('')
})

function TimeHarness({ initial = '' }: { initial?: string }) {
  const [v, setV] = useState(initial)
  return (
    <>
      <TimeField label="Dose 1" labelled={false} value={v} onChange={setV} />
      <output data-testid="value">{v}</output>
    </>
  )
}

test('a time field turns the wheels and keeps "HH:mm"', async () => {
  render(<TimeHarness initial="08:00" />)
  const field = screen.getByRole('button', { name: 'Dose 1' })
  expect(field).toHaveTextContent('8:00 AM')
  await userEvent.click(field)
  const sheet = screen.getByRole('dialog', { name: 'Dose 1' })
  expect(within(sheet).queryByRole('group', { name: en.picker.day })).not.toBeInTheDocument()
  await userEvent.click(within(within(sheet).getByRole('listbox', { name: en.picker.minute })).getByRole('option', { name: '05' }))
  await userEvent.click(within(within(sheet).getByRole('listbox', { name: en.picker.ampm })).getByRole('option', { name: 'PM' }))
  await userEvent.click(within(sheet).getByRole('button', { name: en.picker.done }))
  expect(value()).toBe('20:05')
})

test('a field can be shown but not changed', () => {
  render(<DateField label="Birth date" labelled={false} value="2026-03-01" onChange={() => {}} disabled />)
  expect(screen.getByRole('button', { name: 'Birth date' })).toBeDisabled()
})
