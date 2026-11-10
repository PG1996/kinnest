import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import en from '../i18n/en.json'
import { formatClock } from '../lib/time'
import { ME_ADMIN, mockApi, renderApp } from '../test/utils'
import Home from './Home'

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
const minsFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString()
const text = (key: string, vars: Record<string, string>) => Object.entries(vars).reduce((s, [k, v]) => s.replace(`{{${k}}}`, v), key)
const slot = (over: object = {}) => ({ due_at: minsAgo(82), status: 'pending', given_amount: 0, remaining: 1, doses: [], dose_id: null, given_at: null, by_name: null, nudge: null, ...over })
const partial = (over: object = {}) =>
  slot({ status: 'partial', given_amount: 0.5, remaining: 0.5, doses: [{ id: 'p1', amount: 0.5, status: 'given', given_at: minsAgo(22), by_name: 'Parth Goel' }], ...over })
const med = (slots: object[], over: object = {}) => ({
  id: 'm1', name: 'Vitamin D', dose_amount: 1, dose_unit: 'ml', schedule_kind: 'fixed', times: ['12:00'], interval_hours: null, first_dose_at: null,
  min_gap_hours: null, start_date: '2026-11-01', end_date: null, notes: '', ended: false, slots, last_dose: null, ...over,
})
const summary = { last_feed: null, next_feed_due_at: null, last_diaper: null, feeds_today: 0, diapers_today: { wet: 0, dirty: 0, both: 0 }, sleep: { open: null, last: null } }
const api = (medicines: object[], extra: object = {}) => ({ 'GET /api/me': { body: ME_ADMIN }, 'GET /api/summary': { body: summary }, 'GET /api/medicines': { body: medicines }, ...extra })
const detail = async () => within(await screen.findByTestId('medicine-detail'))
const tile = async (name: RegExp) => within(await screen.findByTestId('medicine-grid')).getByRole('button', { name })

test('a partly given dose with a reminder shows the rest and when it is due, not an overdue time', async () => {
  const at = minsFromNow(58)
  mockApi(api([med([partial({ nudge: { id: 'n1', remind_at: at } })], { last_dose: { id: 'p1', status: 'given', amount: 0.5, given_at: minsAgo(22), by_name: 'Parth Goel' } })]))
  renderApp(<Home />)
  const d = await detail()
  expect(d.getByText(text(en.medicines.restAt, { amount: '0.5 ml', time: formatClock(at) }))).toBeInTheDocument()
  expect(d.queryByText(/overdue/i)).not.toBeInTheDocument()
  expect(d.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0.5')
  expect(d.getByText(text(en.medicines.barLabel, { given: '0.5 ml', total: '1 ml' }))).toBeInTheDocument()
  expect(d.getByRole('button', { name: text(en.medicines.giveRest, { amount: '0.5 ml' }) })).toBeInTheDocument()
  expect(d.getByText(text(en.medicines.reminderAt, { time: formatClock(at) }))).toBeInTheDocument()
  expect(d.getByRole('button', { name: en.medicines.cancelReminder })).toBeInTheDocument()
})

test('a partly given dose with no reminder offers one, and is not shown as overdue', async () => {
  mockApi(api([med([partial()])]))
  renderApp(<Home />)
  const d = await detail()
  expect(d.getByText(text(en.medicines.rest, { amount: '0.5 ml' }))).toBeInTheDocument()
  expect(d.getByRole('button', { name: en.medicines.remindMe })).toBeInTheDocument()
  expect(d.queryByText(/overdue/i)).not.toBeInTheDocument()
})

test('a dose nothing was given for says how late it is, and keeps its extra choices under More', async () => {
  mockApi(api([med([slot()])]))
  renderApp(<Home />)
  const d = await detail()
  expect(d.getByText(text(en.medicines.slotOverdue, { time: formatClock(minsAgo(82)), ago: '1h 22m' }))).toBeInTheDocument()
  expect(d.getByRole('button', { name: en.medicines.giveFull })).toBeInTheDocument()
  for (const name of [en.medicines.givePartial, en.medicines.skip, en.medicines.atOtherTime]) expect(d.queryByRole('button', { name })).not.toBeInTheDocument()
  await userEvent.click(d.getByRole('button', { name: en.medicines.more }))
  for (const name of [en.medicines.givePartial, en.medicines.skip, en.medicines.atOtherTime]) expect(d.getByRole('button', { name })).toBeInTheDocument()
})

test('with nothing due the card shows the count, the last dose and the next dose as small facts, once each', async () => {
  const next = minsFromNow(5 * 60)
  const last = { id: 'd1', status: 'given', amount: 1, given_at: minsAgo(30), by_name: 'Parth Goel' }
  mockApi(api([med([slot({ due_at: next })], { schedule_kind: 'interval', interval_hours: 5, max_per_day: 3, given_today: 1, day_ends_at: minsFromNow(600), last_dose: last })]))
  renderApp(<Home />)
  const d = await detail()
  expect(d.getByText(text(en.medicines.dosesToday, { count: '1', max: '3' }))).toBeInTheDocument()
  expect(d.getByText(text(en.medicines.lastDoseLine, { time: formatClock(last.given_at), name: 'Parth' }))).toBeInTheDocument()
  const nextText = text(en.medicines.nextDoseLine, { time: formatClock(next) })
  expect(d.getAllByText((content) => content.startsWith(nextText))).toHaveLength(1) // "(tomorrow)" follows when it is past midnight
  expect(d.getByRole('button', { name: en.medicines.giveAhead })).toBeInTheDocument()
  expect(d.queryByText(/overdue/i)).not.toBeInTheDocument()
})

test('the tile of a partly given dose says when the rest is due, and is only highlighted once it is', async () => {
  const at = minsFromNow(58)
  mockApi(api([med([partial({ nudge: { id: 'n1', remind_at: at } })])]))
  renderApp(<Home />)
  const t = await tile(/Vitamin D/)
  expect(t).toHaveTextContent(text(en.medicines.tileRest, { time: formatClock(at) }))
  expect(t).not.toHaveTextContent(en.medicines.tileDue)
})

test('the tile of a partly given dose with no reminder shows the amount left, not "Due now"', async () => {
  mockApi(api([med([partial()])]))
  renderApp(<Home />)
  const t = await tile(/Vitamin D/)
  expect(t).toHaveTextContent(text(en.medicines.tileRestLeft, { amount: '0.5 ml' }))
  expect(t).not.toHaveTextContent(en.medicines.tileDue)
})

test('giving a dose shows a toast with Undo, and Undo removes that dose', async () => {
  const calls = mockApi(
    api([med([slot()])], {
      'POST /api/medicines/m1/doses': { status: 201, body: { id: 'x', by_name: 'Owner', gap_warning: null, slot: { status: 'given', given_amount: 1, remaining: 0 } } },
      'DELETE /api/medicines/m1/doses/x': { body: { ok: true } },
    }),
  )
  renderApp(<Home />)
  await userEvent.click((await detail()).getByRole('button', { name: en.medicines.giveFull }))
  const toast = await screen.findByRole('status')
  await userEvent.click(within(toast).getByRole('button', { name: en.medicines.undo }))
  await waitFor(() => expect(calls.some((c) => c.key.startsWith('DELETE /api/medicines/m1/doses/'))).toBe(true))
})

test('Remind me opens the choice of when to be reminded about the rest', async () => {
  mockApi(api([med([partial()])]))
  renderApp(<Home />)
  await userEvent.click((await detail()).getByRole('button', { name: en.medicines.remindMe }))
  expect(await screen.findByRole('dialog', { name: en.medicines.nudgeTitle })).toBeInTheDocument()
})

test('the action buttons on the card are small, like the fact pills', async () => {
  mockApi(api([med([slot()])]))
  renderApp(<Home />)
  const d = await detail()
  for (const name of [en.medicines.giveFull, en.medicines.more, en.medicines.history.open]) {
    const cls = d.getByRole('button', { name }).className
    expect(cls).toContain('min-h-8')
    expect(/bg-primary |bg-warn-solid|border-line/.test(cls)).toBe(true) // solid, or outlined: never bare text on the card
  }
})

// --- one theme: the main button is yellow when a dose is due, purple otherwise, and always says what it does ---------------

test('the main button is yellow while a dose is due', async () => {
  mockApi(api([med([slot()])]))
  renderApp(<Home />)
  expect((await detail()).getByRole('button', { name: en.medicines.giveFull }).className).toContain('bg-warn-solid')
})

test('the main button is purple when nothing is due, and still says Give a dose now', async () => {
  mockApi(api([med([slot({ due_at: minsFromNow(5 * 60) })])]))
  renderApp(<Home />)
  const d = await detail()
  expect(d.getByRole('button', { name: 'Give a dose now' }).className).toContain('bg-primary')
  expect(d.getByRole('button', { name: en.medicines.more })).toBeInTheDocument()
  await userEvent.click(d.getByRole('button', { name: en.medicines.more }))
  expect(d.getByRole('button', { name: en.medicines.givePartial })).toBeInTheDocument()
  expect(d.queryByRole('button', { name: en.medicines.skip })).not.toBeInTheDocument() // a dose that is not due cannot be skipped
})

test('only a partly given dose renames the main button to Give the rest', async () => {
  mockApi(api([med([partial()])]))
  renderApp(<Home />)
  const d = await detail()
  expect(d.getByRole('button', { name: text(en.medicines.giveRest, { amount: '0.5 ml' }) }).className).toContain('bg-primary') // reminder-less rest is not "due"
  expect(d.queryByRole('button', { name: 'Give a dose now' })).not.toBeInTheDocument()
})

// --- the reminder for the rest has gone off: the rest is due, so tile and button turn yellow ---------------------------

test.each([
  ['it has fired', { reminder_due: true }],
  ['its time has come', { nudge: { id: 'n1', remind_at: minsAgo(1) } }],
])('when the reminder for the rest of a dose is reached (%s) the tile and the button turn yellow', async (_name, over) => {
  mockApi(api([med([partial(over)])]))
  renderApp(<Home />)
  expect(await tile(/Vitamin D/)).toHaveTextContent(en.medicines.tileDue)
  const d = await detail()
  expect(d.getByRole('button', { name: text(en.medicines.giveRest, { amount: '0.5 ml' }) }).className).toContain('bg-warn-solid')
  expect(d.getByText(text(en.medicines.restDue, { amount: '0.5 ml' }))).toBeInTheDocument()
  expect(d.queryByText(/overdue/i)).not.toBeInTheDocument()
  expect(d.queryByText(new RegExp(en.medicines.reminderAt.split('{{')[0]!))).not.toBeInTheDocument() // no reminder pill for one that has passed
  expect(d.getByRole('button', { name: en.medicines.remindMe })).toBeInTheDocument() // and another can be set
})
