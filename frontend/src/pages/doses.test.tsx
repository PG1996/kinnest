import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import en from '../i18n/en.json'
import { ME_ADMIN, ME_VIEWER, clickAction, mockApi, renderApp, pickDateTime } from '../test/utils'
import Home from './Home'

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000)
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000)

const slot = (over: object = {}) => ({ due_at: minsAgo(20), status: 'pending', given_amount: 0, remaining: 1, doses: [], dose_id: null, given_at: null, by_name: null, nudge: null, ...over })
const syrup = (over: object = {}) => ({
  id: 'm1', name: 'Syrup', dose_amount: 1, dose_unit: 'ml', schedule_kind: 'fixed', times: ['09:00'], interval_hours: null, first_dose_at: null,
  min_gap_hours: null, start_date: '2026-11-01', end_date: null, notes: '', ended: false, slots: [slot()], last_dose: null, ...over,
})
const asNeeded = () => syrup({ id: 'm2', name: 'Paracetamol', dose_amount: 1.5, schedule_kind: 'as_needed', times: [], slots: [] })
const summary = { last_feed: null, next_feed_due_at: null, last_diaper: null, feeds_today: 0, diapers_today: { wet: 0, dirty: 0, both: 0 }, sleep: { open: null, last: null } }
const base = (medicines: object[], me = ME_ADMIN) => ({ 'GET /api/me': { body: me }, 'GET /api/summary': { body: summary }, 'GET /api/medicines': { body: medicines } })
const posted = { status: 201, body: { id: 'x', by_name: 'Owner', gap_warning: null, slot: { status: 'partial', given_amount: 0.5, remaining: 0.5 } } }
const doseCall = (calls: { key: string; body: unknown }[], id = 'm1') => calls.find((c) => c.key === `POST /api/medicines/${id}/doses`)?.body as Record<string, unknown>
const slide = (scope: ReturnType<typeof within> | typeof screen = screen) => fireEvent.click(scope.getByRole('button', { name: /Slide to give/ }))
const near = (iso: unknown, when: Date, ms = 90_000) => Math.abs(Date.parse(String(iso)) - when.getTime()) < ms

// --- choose when the dose was given ----------------------------------------------------------------------------------

test('the dose screen defaults to now and can be set to another time', async () => {
  const calls = mockApi({ ...base([syrup()]), 'POST /api/medicines/m1/doses': posted })
  renderApp(<Home />)
  await clickAction(en.medicines.givePartial)
  const dialog = await screen.findByRole('dialog', { name: en.medicines.giveTitle })
  expect(within(dialog).getByRole('button', { name: en.medicines.whenNow, pressed: true })).toBeInTheDocument()
  expect(within(dialog).queryByLabelText(en.medicines.whenLabel)).not.toBeInTheDocument()
  await userEvent.click(within(dialog).getByRole('button', { name: en.medicines.whenOther }))
  const when = hoursAgo(3)
  await pickDateTime(en.medicines.whenLabel, when)
  slide(within(dialog))
  await waitFor(() => expect(doseCall(calls)).toBeTruthy())
  expect(near(doseCall(calls).given_at, when)).toBe(true)
})

test('leaving the time on now stamps the moment of giving', async () => {
  const calls = mockApi({ ...base([syrup()]), 'POST /api/medicines/m1/doses': posted })
  renderApp(<Home />)
  await clickAction(en.medicines.givePartial)
  slide(within(await screen.findByRole('dialog', { name: en.medicines.giveTitle })))
  await waitFor(() => expect(doseCall(calls)).toBeTruthy())
  expect(near(doseCall(calls).given_at, new Date())).toBe(true)
})

test('a time later than now is never sent as the future', async () => {
  const calls = mockApi({ ...base([syrup()]), 'POST /api/medicines/m1/doses': posted })
  renderApp(<Home />)
  await clickAction(en.medicines.givePartial)
  const dialog = await screen.findByRole('dialog', { name: en.medicines.giveTitle })
  await userEvent.click(within(dialog).getByRole('button', { name: en.medicines.whenOther }))
  await pickDateTime(en.medicines.whenLabel, hoursFromNow(3)) // the picker takes it as yesterday (or now, near midnight)
  slide(within(dialog))
  await waitFor(() => expect(doseCall(calls)).toBeDefined())
  expect(Date.parse(String(doseCall(calls).given_at))).toBeLessThanOrEqual(Date.now())
})

test('"At another time" on a slot opens the dose screen on Full with the time picker ready', async () => {
  const calls = mockApi({ ...base([syrup()]), 'POST /api/medicines/m1/doses': posted })
  renderApp(<Home />)
  await clickAction(en.medicines.atOtherTime)
  const dialog = await screen.findByRole('dialog', { name: en.medicines.giveTitle })
  expect(within(dialog).getByRole('radio', { name: en.medicines.fullLeft.replace('{{left}}', '1 ml') })).toBeChecked()
  const when = hoursAgo(2)
  await pickDateTime(en.medicines.whenLabel, when)
  slide(within(dialog))
  await waitFor(() => expect(doseCall(calls)).toMatchObject({ amount: 1, status: 'given' }))
  expect(near(doseCall(calls).given_at, when)).toBe(true)
})

test('"At another time" on an as-needed medicine gives that dose at the chosen time', async () => {
  const calls = mockApi({ ...base([asNeeded()]), 'POST /api/medicines/m2/doses': posted })
  renderApp(<Home />)
  await clickAction(en.medicines.atOtherTime)
  const dialog = await screen.findByRole('dialog', { name: en.medicines.giveTitle })
  const when = hoursAgo(5)
  await pickDateTime(en.medicines.whenLabel, when)
  slide(within(dialog))
  await waitFor(() => expect(doseCall(calls, 'm2')).toMatchObject({ status: 'given', amount: 1.5 }))
  expect(doseCall(calls, 'm2')).not.toHaveProperty('scheduled_for')
  expect(near(doseCall(calls, 'm2').given_at, when)).toBe(true)
})

test('a viewer has no way to give a dose at another time', async () => {
  mockApi(base([syrup()], ME_VIEWER))
  renderApp(<Home />)
  await screen.findByTestId('medicine-grid')
  expect(screen.queryByRole('button', { name: en.medicines.atOtherTime })).not.toBeInTheDocument()
})

// --- dose history: look back, add a past dose, fix or delete a dose --------------------------------------------------

const DOSES = [
  { id: 'd1', medicine_id: 'm1', status: 'given', amount: 1, scheduled_for: null, given_at: hoursAgo(30).toISOString(), by_user_id: 'u1', by_name: 'Mom', note: '' },
  { id: 'd2', medicine_id: 'm1', status: 'skipped', amount: null, scheduled_for: null, given_at: hoursAgo(54).toISOString(), by_user_id: 'u1', by_name: 'Dad', note: 'vomited' },
]
const histApi = (me = ME_ADMIN) => ({
  ...base([syrup()], me),
  'GET /api/medicines/m1/doses': { body: DOSES },
  'PATCH /api/medicines/m1/doses/d1': (b: unknown) => ({ body: { ...DOSES[0], ...(b as object) } }),
  'DELETE /api/medicines/m1/doses/d1': { body: { ok: true } },
  'POST /api/medicines/m1/doses/history': (b: unknown) => ({ status: 201, body: { ...(b as object), by_name: 'Owner', gap_warning: null } }),
})
const openHistory = async (me = ME_ADMIN) => {
  const calls = mockApi(histApi(me))
  renderApp(<App />, '/health?tab=medicines')
  await userEvent.click(await screen.findByTestId('medicine-m1'))
  return { calls, dialog: await screen.findByRole('dialog', { name: en.medicines.history.title }) }
}

test('history lists recent doses with dates and 12-hour times', async () => {
  const { dialog } = await openHistory()
  expect(await within(dialog).findByText(/Mom/)).toBeInTheDocument()
  expect(within(dialog).getByText(/Dad/)).toBeInTheDocument()
  expect(within(dialog).getAllByText(/\b(AM|PM)\b/i).length).toBeGreaterThanOrEqual(2)
  expect(within(dialog).getByText(en.medicines.history.skipped)).toBeInTheDocument()
})

test('the admin fixes the amount and note of a dose', async () => {
  const { calls, dialog } = await openHistory()
  await userEvent.click((await within(dialog).findAllByRole('button', { name: en.medicines.history.edit }))[0]!)
  const form = await screen.findByRole('dialog', { name: en.medicines.history.editTitle })
  const amount = within(form).getByLabelText(en.medicines.history.form.amount)
  expect(amount).toHaveValue(1)
  await userEvent.clear(amount)
  await userEvent.type(amount, '0.5')
  await userEvent.type(within(form).getByLabelText(en.medicines.history.form.note), 'half only')
  await userEvent.click(within(form).getByRole('button', { name: en.medicines.history.form.save }))
  await waitFor(() => expect(calls.some((c) => c.key === 'PATCH /api/medicines/m1/doses/d1')).toBe(true))
  expect(calls.find((c) => c.key === 'PATCH /api/medicines/m1/doses/d1')!.body).toMatchObject({ amount: 0.5, status: 'given', note: 'half only' })
})

test('the admin can change the time of a dose', async () => {
  const { calls, dialog } = await openHistory()
  await userEvent.click((await within(dialog).findAllByRole('button', { name: en.medicines.history.edit }))[0]!)
  const form = await screen.findByRole('dialog', { name: en.medicines.history.editTitle })
  const when = hoursAgo(31)
  await pickDateTime(en.medicines.history.form.when, when)
  await userEvent.click(within(form).getByRole('button', { name: en.medicines.history.form.save }))
  await waitFor(() => expect(calls.some((c) => c.key === 'PATCH /api/medicines/m1/doses/d1')).toBe(true))
  expect(near(calls.find((c) => c.key === 'PATCH /api/medicines/m1/doses/d1')!.body && (calls.find((c) => c.key === 'PATCH /api/medicines/m1/doses/d1')!.body as { given_at: string }).given_at, when)).toBe(true)
})

test('deleting a dose asks twice', async () => {
  const { calls, dialog } = await openHistory()
  await userEvent.click((await within(dialog).findAllByRole('button', { name: en.medicines.history.delete }))[0]!)
  expect(calls.some((c) => c.key === 'DELETE /api/medicines/m1/doses/d1')).toBe(false)
  await userEvent.click(within(dialog).getByRole('button', { name: en.medicines.history.confirmDelete }))
  await waitFor(() => expect(calls.some((c) => c.key === 'DELETE /api/medicines/m1/doses/d1')).toBe(true))
})

test('the admin adds a past dose', async () => {
  const { calls, dialog } = await openHistory()
  await userEvent.click(await within(dialog).findByRole('button', { name: en.medicines.history.add }))
  const form = await screen.findByRole('dialog', { name: en.medicines.history.addTitle })
  const when = hoursAgo(24 * 9)
  await pickDateTime(en.medicines.history.form.when, when)
  const amount = within(form).getByLabelText(en.medicines.history.form.amount)
  await userEvent.clear(amount)
  await userEvent.type(amount, '0.75')
  await userEvent.click(within(form).getByRole('button', { name: en.medicines.history.form.save }))
  await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/medicines/m1/doses/history')).toBe(true))
  const body = calls.find((c) => c.key === 'POST /api/medicines/m1/doses/history')!.body as Record<string, unknown>
  expect(body).toMatchObject({ status: 'given', amount: 0.75 })
  expect(body.id).toMatch(/^[0-9a-f-]{36}$/)
  expect(near(body.given_at, when)).toBe(true)
})

test('a past dose is never saved in the future', async () => {
  const { calls, dialog } = await openHistory()
  await userEvent.click(await within(dialog).findByRole('button', { name: en.medicines.history.add }))
  const form = await screen.findByRole('dialog', { name: en.medicines.history.addTitle })
  await pickDateTime(en.medicines.history.form.when, hoursFromNow(5)) // the picker takes it as yesterday (or now, near midnight)
  await userEvent.click(within(form).getByRole('button', { name: en.medicines.history.form.save }))
  await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/medicines/m1/doses/history')).toBe(true))
  const body = calls.find((c) => c.key === 'POST /api/medicines/m1/doses/history')!.body as { given_at: string }
  expect(Date.parse(body.given_at)).toBeLessThanOrEqual(Date.now())
})

test('a caregiver can read the history but not edit, delete or add', async () => {
  const me = { ...ME_ADMIN, role: 'caregiver' }
  const { dialog } = await openHistory(me)
  expect(await within(dialog).findByText(/Mom/)).toBeInTheDocument()
  for (const name of [en.medicines.history.edit, en.medicines.history.delete, en.medicines.history.add])
    expect(within(dialog).queryByRole('button', { name })).not.toBeInTheDocument()
})

test('a viewer sees no history editing either', async () => {
  const { dialog } = await openHistory(ME_VIEWER)
  expect(await within(dialog).findByText(/Mom/)).toBeInTheDocument()
  expect(within(dialog).queryByRole('button', { name: en.medicines.history.edit })).not.toBeInTheDocument()
})

// --- which dose slot a dose counts for ---------------------------------------------------------------------------------

const SLOT_DUE = minsAgo(20)
const slotApi = (over: object = {}) => ({ ...histApi(), 'GET /api/medicines': { body: [syrup({ slots: [slot({ due_at: SLOT_DUE })], ...over })] } })

test('fixing a dose lets the admin choose which slot it counts for, or none', async () => {
  const calls = mockApi(slotApi())
  renderApp(<App />, '/health?tab=medicines')
  await userEvent.click(await screen.findByTestId('medicine-m1'))
  const dialog = await screen.findByRole('dialog', { name: en.medicines.history.title })
  await userEvent.click((await within(dialog).findAllByRole('button', { name: en.medicines.history.edit }))[0]!)
  const form = await screen.findByRole('dialog', { name: en.medicines.history.editTitle })
  const select = within(form).getByLabelText(en.medicines.history.form.slot)
  expect(within(select).getByRole('option', { name: en.medicines.history.noSlot })).toBeInTheDocument()
  await userEvent.selectOptions(select, SLOT_DUE)
  await userEvent.click(within(form).getByRole('button', { name: en.medicines.history.form.save }))
  await waitFor(() => expect(calls.some((c) => c.key === 'PATCH /api/medicines/m1/doses/d1')).toBe(true))
  expect(calls.find((c) => c.key === 'PATCH /api/medicines/m1/doses/d1')!.body).toMatchObject({ scheduled_for: SLOT_DUE })
})

test('a dose that counts for a slot can be taken off it', async () => {
  const onSlot = { ...DOSES[0], scheduled_for: SLOT_DUE }
  const calls = mockApi({ ...slotApi(), 'GET /api/medicines/m1/doses': { body: [onSlot] } })
  renderApp(<App />, '/health?tab=medicines')
  await userEvent.click(await screen.findByTestId('medicine-m1'))
  const dialog = await screen.findByRole('dialog', { name: en.medicines.history.title })
  await userEvent.click(await within(dialog).findByRole('button', { name: en.medicines.history.edit }))
  const form = await screen.findByRole('dialog', { name: en.medicines.history.editTitle })
  const select = within(form).getByLabelText(en.medicines.history.form.slot) as HTMLSelectElement
  expect(select.value).toBe(SLOT_DUE)
  await userEvent.selectOptions(select, '')
  await userEvent.click(within(form).getByRole('button', { name: en.medicines.history.form.save }))
  await waitFor(() => expect(calls.some((c) => c.key === 'PATCH /api/medicines/m1/doses/d1')).toBe(true))
  expect(calls.find((c) => c.key === 'PATCH /api/medicines/m1/doses/d1')!.body).toMatchObject({ scheduled_for: null })
})

test('a past dose is preselected for the open slot so it clears the overdue row', async () => {
  const calls = mockApi(slotApi())
  renderApp(<App />, '/health?tab=medicines')
  await userEvent.click(await screen.findByTestId('medicine-m1'))
  const dialog = await screen.findByRole('dialog', { name: en.medicines.history.title })
  await userEvent.click(await within(dialog).findByRole('button', { name: en.medicines.history.add }))
  const form = await screen.findByRole('dialog', { name: en.medicines.history.addTitle })
  expect((within(form).getByLabelText(en.medicines.history.form.slot) as HTMLSelectElement).value).toBe(SLOT_DUE)
  await userEvent.click(within(form).getByRole('button', { name: en.medicines.history.form.save }))
  await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/medicines/m1/doses/history')).toBe(true))
  expect(calls.find((c) => c.key === 'POST /api/medicines/m1/doses/history')!.body).toMatchObject({ scheduled_for: SLOT_DUE })
})

test('an SOS medicine has no slot choice in the history form', async () => {
  mockApi({ ...histApi(), 'GET /api/medicines': { body: [syrup({ schedule_kind: 'as_needed', times: [], slots: [] })] } })
  renderApp(<App />, '/health?tab=medicines')
  // an SOS medicine sits in the SOS card, whose History button opens the same dose history
  await userEvent.click(await within(await screen.findByRole('region', { name: en.medicines.page.sos })).findByRole('button', { name: new RegExp(en.medicines.history.open) }))
  const dialog = await screen.findByRole('dialog', { name: en.medicines.history.title })
  await userEvent.click(await within(dialog).findByRole('button', { name: en.medicines.history.add }))
  const form = await screen.findByRole('dialog', { name: en.medicines.history.addTitle })
  expect(within(form).queryByLabelText(en.medicines.history.form.slot)).not.toBeInTheDocument()
})

test('the dose screen says when a slot is from yesterday', async () => {
  mockApi(base([syrup({ slots: [slot({ due_at: minsAgo(26 * 60) }), slot({ due_at: minsAgo(20) })] })]))
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.medicines.reviewMissed }))
  const partials = await screen.findAllByRole('button', { name: en.medicines.givePartial })
  await userEvent.click(partials[0]!) // the current dose keeps Partial dose under More, so this is the expanded missed one
  const dialog = await screen.findByRole('dialog', { name: en.medicines.giveTitle })
  expect(dialog).toHaveTextContent(`(${en.medicines.yesterday})`)
})

// --- grouped by the time each dose was for -----------------------------------------------------------------------------

test('doses of one slot sit together under the slot time, with when and who logged each piece in small text', async () => {
  const at = new Date()
  at.setHours(8, 0, 0, 0)
  if (at.getTime() > Date.now()) at.setDate(at.getDate() - 1)
  const slotIso = at.toISOString()
  const piece = (id: string, minutes: number, amount: number, by: string) => ({
    id, medicine_id: 'm1', status: 'given', amount, scheduled_for: slotIso, given_at: new Date(at.getTime() + minutes * 60_000).toISOString(), by_user_id: 'u1', by_name: by, note: '',
  })
  mockApi({ ...histApi(), 'GET /api/medicines/m1/doses': { body: [piece('p2', 25, 0.5, 'Dad'), piece('p1', 5, 0.5, 'Mom')] } })
  renderApp(<App />, '/health?tab=medicines')
  await userEvent.click(await screen.findByTestId('medicine-m1'))
  const dialog = await screen.findByRole('dialog', { name: en.medicines.history.title })
  const group = (await within(dialog).findAllByText('8:00 AM'))[0]!.closest('li')!
  expect(within(group).getByText('1 ml')).toBeInTheDocument() // the two pieces add up
  expect(within(group).getAllByText('0.5 ml')).toHaveLength(2)
  expect(within(group).getByText(`${en.medicines.history.logged.replace('{{time}}', '8:05 AM')} · ${en.medicines.history.by.replace('{{name}}', 'Mom')}`)).toBeInTheDocument()
  expect(within(group).getByText(`${en.medicines.history.logged.replace('{{time}}', '8:25 AM')} · ${en.medicines.history.by.replace('{{name}}', 'Dad')}`)).toBeInTheDocument()
  expect(within(dialog).getAllByText('8:00 AM')).toHaveLength(1) // one heading for both pieces
})

test('a tile opens the dose history straight away, with the medicine details above it', async () => {
  mockApi(histApi())
  renderApp(<App />, '/health?tab=medicines')
  await userEvent.click(await screen.findByTestId('medicine-m1'))
  const dialog = await screen.findByRole('dialog', { name: en.medicines.history.title })
  expect(within(dialog).getByText('Syrup')).toBeInTheDocument()
  expect(within(dialog).getByRole('button', { name: en.medicines.history.add })).toBeInTheDocument()
})
