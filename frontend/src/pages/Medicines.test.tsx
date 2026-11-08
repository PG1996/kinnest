import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import en from '../i18n/en.json'
import { formatClock } from '../lib/time'
import { enqueue } from '../offline/queue'
import { ME_ADMIN, ME_VIEWER, mockApi, renderApp } from '../test/utils'
import Home from './Home'
import Settings from './Settings'

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
const minsFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString()
const text = (key: string, vars: Record<string, string>) => Object.entries(vars).reduce((s, [k, v]) => s.replace(`{{${k}}}`, v), key)

const slot = (over: object = {}) => ({
  due_at: minsAgo(20), status: 'pending', given_amount: 0, remaining: 5, doses: [], dose_id: null, given_at: null, by_name: null, nudge: null, ...over,
})
const piece = (over: object = {}) => ({ id: 'p1', amount: 0.25, status: 'given', given_at: minsAgo(10), by_name: 'Mom', ...over })
const med = (over: object = {}) => ({
  id: 'm1', name: 'Vitamin D', dose_amount: 5, dose_unit: 'drops', schedule_kind: 'fixed', times: ['09:00'], interval_hours: null, first_dose_at: null,
  min_gap_hours: null, start_date: '2026-11-01', end_date: null, notes: '', ended: false, slots: [slot()], last_dose: null, ...over,
})
/** A 1 ml syrup with one slot. */
const syrup = (slotOver: object = {}, over: object = {}) => med({ name: 'Syrup', dose_amount: 1, dose_unit: 'ml', slots: [slot({ remaining: 1, ...slotOver })], ...over })
const asNeeded = (lastGivenMinsAgo: number | null, over: object = {}) =>
  med({
    id: 'm2', name: 'Paracetamol', dose_amount: 1.5, dose_unit: 'ml', schedule_kind: 'as_needed', times: [], min_gap_hours: 6, slots: [],
    last_dose: lastGivenMinsAgo === null ? null : { id: 'd9', status: 'given', amount: 1.5, given_at: minsAgo(lastGivenMinsAgo), by_name: 'Mom' }, ...over,
  })
const legacy = (over: object = {}) => med({ dose_amount: null, dose_unit: null, slots: [slot({ remaining: null })], ...over })
const summary = { last_feed: null, next_feed_due_at: null, last_diaper: null, feeds_today: 0, diapers_today: { wet: 0, dirty: 0, both: 0 }, sleep: { open: null, last: null } }
const base = (medicines: object[], me = ME_ADMIN) => ({
  'GET /api/me': { body: me },
  'GET /api/summary': { body: summary },
  'GET /api/medicines': { body: medicines },
})
const posted = (over: object = {}) => ({ status: 201, body: { id: 'x', by_name: 'Owner', gap_warning: null, slot: { status: 'given', given_amount: 5, remaining: 0 }, ...over } })
const doseCall = (calls: { key: string; body: unknown }[], id = 'm1') => calls.find((c) => c.key === `POST /api/medicines/${id}/doses`)?.body as Record<string, unknown>
const sent = (calls: { key: string }[], key: string) => calls.some((c) => c.key === key)

// --- structured doses: full, partial, progress ------------------------------------------------------------------

test('a pending slot offers Give full dose, Partial dose and Skip; full posts the whole amount', async () => {
  const s = slot()
  const calls = mockApi({ ...base([med({ slots: [s] })]), 'POST /api/medicines/m1/doses': posted() })
  renderApp(<Home />)
  expect(await screen.findByText('Vitamin D · 5 drops')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: en.medicines.givePartial })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: en.medicines.skip })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: en.medicines.giveFull }))
  await waitFor(() => expect(doseCall(calls)).toBeTruthy())
  expect(doseCall(calls)).toMatchObject({ status: 'given', amount: 5, scheduled_for: s.due_at })
  expect(doseCall(calls).id).toMatch(/^[0-9a-f-]{36}$/)
})

test('a partly given slot shows its progress and full dose posts only what is left', async () => {
  const s = slot({ status: 'partial', given_amount: 0.25, remaining: 0.75, doses: [piece()] })
  const calls = mockApi({ ...base([syrup({ ...s, remaining: 0.75 })]), 'POST /api/medicines/m1/doses': posted() })
  renderApp(<Home />)
  expect(await screen.findByText(text(en.medicines.progress, { given: '0.25 ml', total: '1 ml', left: '0.75 ml' }))).toBeInTheDocument()
  expect(screen.getByText(text(en.medicines.pieceBy, { name: 'Mom', amount: '0.25 ml', time: formatClock(piece().given_at) }))).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: en.medicines.giveFull }))
  await waitFor(() => expect(doseCall(calls)).toMatchObject({ amount: 0.75, scheduled_for: s.due_at }))
})

test('the partial sheet posts the typed amount and refuses more than is left', async () => {
  const calls = mockApi({ ...base([syrup()]), 'POST /api/medicines/m1/doses': posted({ slot: { status: 'partial', given_amount: 0.25, remaining: 0.75 } }) })
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.medicines.givePartial }))
  const dialog = await screen.findByRole('dialog')
  const amount = within(dialog).getByLabelText(en.medicines.amountLabel)
  expect(amount).toHaveValue(0.5) // half of what is left to start with
  for (const bad of ['', '0', '1.01', '0.001', '-1']) {
    await userEvent.clear(amount)
    if (bad) await userEvent.type(amount, bad)
    await userEvent.click(within(dialog).getByRole('button', { name: en.medicines.giveAmount }))
    expect(await within(dialog).findByText(en.medicines.amountInvalid), bad).toBeInTheDocument()
  }
  expect(sent(calls, 'POST /api/medicines/m1/doses')).toBe(false)
  await userEvent.clear(amount)
  await userEvent.type(amount, '0.25')
  await userEvent.click(within(dialog).getByRole('button', { name: en.medicines.giveAmount }))
  await waitFor(() => expect(doseCall(calls)).toMatchObject({ status: 'given', amount: 0.25 }))
})

test('after a partial dose the reminder sheet offers five times and posts the chosen one', async () => {
  const s = slot({ remaining: 1 })
  const calls = mockApi({
    ...base([syrup(s)]),
    'POST /api/medicines/m1/doses': posted({ slot: { status: 'partial', given_amount: 0.25, remaining: 0.75 } }),
    'POST /api/medicines/m1/nudges': { status: 201, body: { id: 'n1' } },
  })
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.medicines.givePartial }))
  await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: en.medicines.giveAmount }))
  const dialog = await screen.findByRole('dialog', { name: en.medicines.nudgeTitle })
  expect(dialog).toHaveTextContent('0.75 ml')
  for (const minutes of [5, 10, 15, 30, 60]) {
    expect(within(dialog).getByRole('button', { name: text(en.medicines.nudgeIn, { minutes: String(minutes) }) })).toBeInTheDocument()
  }
  await userEvent.click(within(dialog).getByRole('button', { name: text(en.medicines.nudgeIn, { minutes: '15' }) }))
  await waitFor(() => expect(sent(calls, 'POST /api/medicines/m1/nudges')).toBe(true))
  const body = calls.find((c) => c.key === 'POST /api/medicines/m1/nudges')!.body as { scheduled_for: string; remind_at: string; id: string }
  expect(body.scheduled_for).toBe(s.due_at)
  expect(Date.parse(body.remind_at) - Date.now()).toBeGreaterThan(14 * 60_000)
  expect(Date.parse(body.remind_at) - Date.now()).toBeLessThan(16 * 60_000)
  expect(body.id).toMatch(/^[0-9a-f-]{36}$/)
})

test('declining the reminder posts nothing, and a complete dose offers none', async () => {
  const calls = mockApi({
    ...base([syrup()]),
    'POST /api/medicines/m1/doses': posted({ slot: { status: 'partial', given_amount: 0.5, remaining: 0.5 } }),
    'POST /api/medicines/m1/nudges': { status: 201, body: { id: 'n1' } },
  })
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.medicines.givePartial }))
  await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: en.medicines.giveAmount }))
  await userEvent.click(await screen.findByRole('button', { name: en.medicines.nudgeNo }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(sent(calls, 'POST /api/medicines/m1/nudges')).toBe(false)
})

test('a full dose that completes the slot offers no reminder', async () => {
  mockApi({ ...base([syrup()]), 'POST /api/medicines/m1/doses': posted({ slot: { status: 'given', given_amount: 1, remaining: 0 } }) })
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.medicines.giveFull }))
  expect(await screen.findByText(en.home.logged)).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('a slot with a reminder shows its time and can cancel it', async () => {
  const at = minsFromNow(12)
  const calls = mockApi({
    ...base([syrup({ status: 'partial', given_amount: 0.25, remaining: 0.75, doses: [piece()], nudge: { id: 'n1', remind_at: at } })]),
    'DELETE /api/medicines/m1/nudges/n1': { body: { ok: true } },
  })
  renderApp(<Home />)
  expect(await screen.findByText(text(en.medicines.reminderAt, { time: formatClock(at) }))).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: en.medicines.cancelReminder }))
  await waitFor(() => expect(sent(calls, 'DELETE /api/medicines/m1/nudges/n1')).toBe(true))
})

test('a 409 about the amount says how much is left and refreshes', async () => {
  mockApi({ ...base([syrup()]), 'POST /api/medicines/m1/doses': { status: 409, body: { detail: 'only 0.25 left to give', remaining: 0.25 } } })
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.medicines.giveFull }))
  expect(await screen.findByText(text(en.medicines.onlyLeft, { left: '0.25 ml' }))).toBeInTheDocument()
})

test('a 409 on a dose already given in full says so', async () => {
  mockApi({ ...base([syrup()]), 'POST /api/medicines/m1/doses': { status: 409, body: { detail: 'that dose was already given in full', remaining: 0 } } })
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.medicines.giveFull }))
  expect(await screen.findByText(en.medicines.alreadyComplete)).toBeInTheDocument()
})

test('a 409 for a dose that is not due explains and refreshes', async () => {
  mockApi({ ...base([med()]), 'POST /api/medicines/m1/doses': { status: 409, body: { detail: 'that dose is not due' } } })
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.medicines.giveFull }))
  expect(await screen.findByText(en.medicines.notDue)).toBeInTheDocument()
})

test('a queued piece reduces what is offered and shows as waiting to sync', async () => {
  const s = slot({ remaining: 1 })
  await enqueue({ kind: 'dose', id: 'q1', payload: { id: 'q1', medicine_id: 'm1', status: 'given', amount: 0.25, scheduled_for: s.due_at } })
  const calls = mockApi({ ...base([syrup(s)]), 'POST /api/medicines/m1/doses': posted() })
  renderApp(<Home />)
  expect(await screen.findByText(text(en.medicines.waitingAmount, { amount: '0.25 ml' }))).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: en.medicines.giveFull }))
  await waitFor(() => expect(doseCall(calls)).toMatchObject({ amount: 0.75 }))
})

test('a slot whose remaining dose is all queued shows waiting and no buttons', async () => {
  const s = slot({ remaining: 1 })
  await enqueue({ kind: 'dose', id: 'q1', payload: { id: 'q1', medicine_id: 'm1', status: 'given', amount: 1, scheduled_for: s.due_at } })
  mockApi(base([syrup(s)]))
  renderApp(<Home />)
  expect(await screen.findByText(text(en.medicines.waitingAmount, { amount: '1 ml' }))).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: en.medicines.giveFull })).not.toBeInTheDocument()
})

// --- as needed --------------------------------------------------------------------------------------------------

test('as-needed offers full or partial; full posts the whole dose with no slot', async () => {
  const calls = mockApi({ ...base([asNeeded(8 * 60)]), 'POST /api/medicines/m2/doses': posted() })
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.medicines.giveFull }))
  await waitFor(() => expect(doseCall(calls, 'm2')).toMatchObject({ status: 'given', amount: 1.5 }))
  expect(doseCall(calls, 'm2')).not.toHaveProperty('scheduled_for')
})

test('as-needed partial posts the typed amount and cannot exceed one dose', async () => {
  const calls = mockApi({ ...base([asNeeded(8 * 60)]), 'POST /api/medicines/m2/doses': posted() })
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.medicines.givePartial }))
  const dialog = await screen.findByRole('dialog')
  const amount = within(dialog).getByLabelText(en.medicines.amountLabel)
  await userEvent.clear(amount)
  await userEvent.type(amount, '2')
  await userEvent.click(within(dialog).getByRole('button', { name: en.medicines.giveAmount }))
  expect(await within(dialog).findByText(en.medicines.amountInvalid)).toBeInTheDocument()
  await userEvent.clear(amount)
  await userEvent.type(amount, '0.5')
  await userEvent.click(within(dialog).getByRole('button', { name: en.medicines.giveAmount }))
  await waitFor(() => expect(doseCall(calls, 'm2')).toMatchObject({ amount: 0.5 }))
})

test('as-needed inside the minimum gap still asks to confirm before posting', async () => {
  const calls = mockApi({ ...base([asNeeded(120)]), 'POST /api/medicines/m2/doses': posted() })
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.medicines.giveFull }))
  const dialog = await screen.findByRole('dialog')
  expect(dialog).toHaveTextContent('2h')
  expect(sent(calls, 'POST /api/medicines/m2/doses')).toBe(false)
  await userEvent.click(screen.getByRole('button', { name: en.medicines.giveAnyway }))
  await waitFor(() => expect(doseCall(calls, 'm2')).toMatchObject({ status: 'given', amount: 1.5 }))
})

test('declining the gap confirm saves nothing', async () => {
  const calls = mockApi({ ...base([asNeeded(120)]), 'POST /api/medicines/m2/doses': posted() })
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.medicines.giveFull }))
  await userEvent.click(await screen.findByRole('button', { name: en.medicines.cancel }))
  expect(sent(calls, 'POST /api/medicines/m2/doses')).toBe(false)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

// --- legacy medicines, viewers, resolved slots, the rest -------------------------------------------------------

test('a medicine saved before structured doses keeps Given and Skip and posts no amount', async () => {
  const s = slot({ remaining: null })
  const calls = mockApi({ ...base([legacy({ slots: [s] })]), 'POST /api/medicines/m1/doses': posted() })
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.medicines.given }))
  await waitFor(() => expect(doseCall(calls)).toMatchObject({ status: 'given', scheduled_for: s.due_at }))
  expect(doseCall(calls)).not.toHaveProperty('amount')
  expect(screen.queryByRole('button', { name: en.medicines.giveFull })).not.toBeInTheDocument()
})

test('Skip posts a skipped dose for the slot', async () => {
  const s = slot()
  const calls = mockApi({ ...base([med({ slots: [s] })]), 'POST /api/medicines/m1/doses': posted() })
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.medicines.skip }))
  await waitFor(() => expect(doseCall(calls)).toMatchObject({ status: 'skipped', scheduled_for: s.due_at }))
  expect(doseCall(calls)).not.toHaveProperty('amount')
})

test('a late slot is flagged overdue and a future one is not', async () => {
  mockApi(base([med({ slots: [slot({ due_at: minsAgo(20) }), slot({ due_at: minsFromNow(180) })] })]))
  renderApp(<Home />)
  expect(await screen.findByText(text(en.medicines.overdue, { ago: '20m' }))).toBeInTheDocument()
  expect(screen.getAllByText(en.medicines.overdue.split('{{')[0], { exact: false })).toHaveLength(1)
})

test('a complete slot lists who gave each piece and offers undo per piece', async () => {
  const p1 = piece({ id: 'p1', amount: 0.5, by_name: 'Mom', given_at: minsAgo(30) })
  const p2 = piece({ id: 'p2', amount: 0.5, by_name: 'Nanny', given_at: minsAgo(25) })
  const calls = mockApi({
    ...base([syrup({ status: 'given', given_amount: 1, remaining: 0, doses: [p1, p2], dose_id: 'p2', given_at: p2.given_at, by_name: 'Nanny' })]),
    'DELETE /api/medicines/m1/doses/p2': { body: { ok: true } },
  })
  renderApp(<Home />)
  expect(await screen.findByText(text(en.medicines.pieceBy, { name: 'Mom', amount: '0.5 ml', time: formatClock(p1.given_at) }))).toBeInTheDocument()
  expect(screen.getByText(text(en.medicines.pieceBy, { name: 'Nanny', amount: '0.5 ml', time: formatClock(p2.given_at) }))).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: en.medicines.giveFull })).not.toBeInTheDocument()
  const undo = screen.getAllByRole('button', { name: en.medicines.undo })
  expect(undo).toHaveLength(2)
  await userEvent.click(undo[1])
  await waitFor(() => expect(sent(calls, 'DELETE /api/medicines/m1/doses/p2')).toBe(true))
})

test('a legacy resolved slot still says who gave it', async () => {
  const at = minsAgo(30)
  mockApi(base([legacy({ slots: [slot({ status: 'given', remaining: null, dose_id: 'd1', given_at: at, by_name: 'Mom', doses: [] })] })]))
  renderApp(<Home />)
  expect(await screen.findByText(text(en.medicines.givenBy, { name: 'Mom', time: formatClock(at) }))).toBeInTheDocument()
})

test('a skipped slot says so, and keeps what was given before', async () => {
  const at = minsAgo(30)
  const skip = piece({ id: 's1', status: 'skipped', amount: null, by_name: 'Nanny', given_at: at })
  mockApi(base([syrup({ status: 'skipped', given_amount: 0.5, remaining: 0.5, doses: [piece({ amount: 0.5 }), skip] })]))
  renderApp(<Home />)
  expect(await screen.findByText(text(en.medicines.skippedBy, { name: 'Nanny', time: formatClock(at) }))).toBeInTheDocument()
  expect(screen.getByText(text(en.medicines.pieceBy, { name: 'Mom', amount: '0.5 ml', time: formatClock(piece().given_at) }))).toBeInTheDocument()
})

test('viewer sees medicines and progress but no buttons', async () => {
  mockApi(base([syrup({ status: 'partial', given_amount: 0.25, remaining: 0.75, doses: [piece()] }), asNeeded(120)], ME_VIEWER))
  renderApp(<Home />)
  await screen.findByText(text(en.medicines.progress, { given: '0.25 ml', total: '1 ml', left: '0.75 ml' }))
  for (const name of [en.medicines.giveFull, en.medicines.givePartial, en.medicines.skip, en.medicines.undo, en.medicines.given]) {
    expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
  }
})

test('a dose another phone already recorded says who gave it', async () => {
  mockApi({ ...base([med()]), 'POST /api/medicines/m1/doses': { status: 200, body: { id: 'x', by_name: 'Nanny', gap_warning: null } } })
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.medicines.giveFull }))
  expect(await screen.findByText(text(en.medicines.alreadyGave, { name: 'Nanny' }))).toBeInTheDocument()
})

test('no medicines means no medicines card', async () => {
  mockApi(base([]))
  renderApp(<Home />)
  await screen.findByText(en.sleep.none)
  expect(screen.queryByText(en.medicines.title)).not.toBeInTheDocument()
})

test('tapping a medicine notification (?log=medicine) scrolls to the medicines card', async () => {
  const scroll = vi.fn()
  Element.prototype.scrollIntoView = scroll
  mockApi(base([med()]))
  renderApp(<Home />, '/?log=medicine')
  await waitFor(() => expect(scroll).toHaveBeenCalled())
})

test('Settings saves the medicine reminders toggle with the other preferences', async () => {
  const kid = { id: 'k1', name: 'Baby', birth_date: null, feed_interval_minutes: 180, diaper_alert_minutes: 240 }
  const calls = mockApi({
    'GET /api/me': { body: ME_ADMIN },
    'GET /api/kid': { body: kid },
    'GET /api/notification-prefs': { body: { feed: true, diaper: true, medicine: true } },
    'PUT /api/notification-prefs': { body: { feed: true, diaper: true, medicine: false } },
  })
  renderApp(<Settings />)
  await userEvent.click(await screen.findByRole('checkbox', { name: en.settings.medicineReminders }))
  await waitFor(() => expect(calls.find((c) => c.key === 'PUT /api/notification-prefs')?.body).toEqual({ feed: true, diaper: true, medicine: false }))
})
