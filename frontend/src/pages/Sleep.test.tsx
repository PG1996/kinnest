import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import en from '../i18n/en.json'
import { formatClock } from '../lib/time'
import { list } from '../offline/queue'
import { ME_ADMIN, ME_VIEWER, mockApi, renderApp } from '../test/utils'
import Home from './Home'

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
const session = (over: object = {}) => ({
  id: 's1', started_at: minsAgo(45), ended_at: null, started_by_name: 'Mom', ended_by_name: null, duration_min: null, note: '', ...over,
})
const summary = (sleep: object) => ({
  last_feed: null, next_feed_due_at: null, last_diaper: null, feeds_today: 0, diapers_today: { wet: 0, dirty: 0, both: 0 }, sleep,
})
const base = (sleep: object, me = ME_ADMIN) => ({ 'GET /api/me': { body: me }, 'GET /api/summary': { body: summary(sleep) } })
const confirmStart = async () => userEvent.click(within(await screen.findByRole('dialog', { name: en.sleep.confirmStartTitle })).getByRole('button', { name: en.sleep.confirmStart }))
const confirmEnd = async () => userEvent.click(within(await screen.findByRole('dialog', { name: en.sleep.confirmEndTitle })).getByRole('button', { name: en.sleep.confirmEnd }))
const text = (key: string, vars: Record<string, string>) => Object.entries(vars).reduce((s, [k, v]) => s.replace(`{{${k}}}`, v), key)

test('shows asleep since and the wake button when a session is open', async () => {
  const open = session()
  mockApi(base({ open, last: null }))
  renderApp(<Home />)
  const card = within(await screen.findByTestId('sleep-card'))
  expect(card.getByText(text(en.sleep.asleepFor, { ago: '45m' }))).toBeInTheDocument()
  expect(card.getByText(text(en.sleep.since, { time: formatClock(open.started_at) }))).toBeInTheDocument() // a pill
  expect(card.getByText(text(en.home.by, { name: open.started_by_name }))).toBeInTheDocument()
  expect(screen.getByRole('button', { name: en.sleep.end })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: en.sleep.start })).not.toBeInTheDocument()
})

test('shows the last sleep length when awake', async () => {
  const last = session({ started_at: minsAgo(180), ended_at: minsAgo(50), ended_by_name: 'Mom', duration_min: 130 })
  mockApi(base({ open: null, last }))
  renderApp(<Home />)
  const card = within(await screen.findByTestId('sleep-card'))
  expect(card.getByText(text(en.sleep.wokeAgo, { ago: '50m' }))).toBeInTheDocument()
  expect(card.getByText(text(en.sleep.sleptFor, { duration: '2h 10m' }))).toBeInTheDocument() // a pill
  expect(card.getByText(text(en.home.by, { name: 'Mom' }))).toBeInTheDocument()
  expect(screen.getByRole('button', { name: en.sleep.start })).toBeInTheDocument()
})

test('shows an empty state before any sleep is logged', async () => {
  mockApi(base({ open: null, last: null }))
  renderApp(<Home />)
  expect(await screen.findByText(en.sleep.none)).toBeInTheDocument()
})

test('tapping Sleep posts a start with a client id and the current time', async () => {
  const calls = mockApi({ ...base({ open: null, last: null }), 'POST /api/sleep': { status: 201, body: session() } })
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.sleep.start }))
  await confirmStart()
  await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/sleep')).toBe(true))
  const body = calls.find((c) => c.key === 'POST /api/sleep')!.body as { id: string; started_at: string }
  expect(body.id).toMatch(/^[0-9a-f-]{36}$/)
  expect(Date.parse(body.started_at)).toBeLessThanOrEqual(Date.now())
})

test('tapping Wake up posts an end for the open session', async () => {
  const calls = mockApi({ ...base({ open: session(), last: null }), 'POST /api/sleep/s1/end': { body: session({ ended_at: minsAgo(0) }) } })
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.sleep.end }))
  await confirmEnd()
  await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/sleep/s1/end')).toBe(true))
  expect(Date.parse((calls.find((c) => c.key === 'POST /api/sleep/s1/end')!.body as { ended_at: string }).ended_at)).toBeLessThanOrEqual(Date.now())
})

test('viewer sees the sleep card without buttons', async () => {
  mockApi(base({ open: session(), last: null }, ME_VIEWER))
  renderApp(<Home />)
  await screen.findByText(/Asleep for/)
  expect(screen.queryByRole('button', { name: en.sleep.end })).not.toBeInTheDocument()
})

test('a 409 on start says who already started the sleep instead of an error', async () => {
  mockApi({
    ...base({ open: null, last: null }),
    'POST /api/sleep': { status: 409, body: { detail: 'already asleep', open: session({ id: 's9', started_by_name: 'Nanny' }) } },
  })
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.sleep.start }))
  await confirmStart()
  expect(await screen.findByText(text(en.sleep.alreadyAsleep, { name: 'Nanny' }))).toBeInTheDocument()
})

test('with no connection the start is queued and the card shows asleep', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') throw new TypeError('offline')
      const url = String(input)
      const body = url.includes('/api/me') ? ME_ADMIN : summary({ open: null, last: null })
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }),
  )
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.sleep.start }))
  await confirmStart()
  expect(await screen.findByText(en.home.queued)).toBeInTheDocument()
  expect(await screen.findByRole('button', { name: en.sleep.end })).toBeInTheDocument()
  expect((await list())[0]).toMatchObject({ kind: 'sleep_start' })
})

test('a failed save tells the caregiver', async () => {
  mockApi({ ...base({ open: null, last: null }), 'POST /api/sleep': { status: 422, body: { detail: 'timestamp is in the future' } } })
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.sleep.start }))
  await confirmStart()
  expect((await screen.findByText(en.home.saveError)).closest('[role=status]')).toHaveAttribute('data-tone', 'error')
})

// --- a confirmation before sleep is logged (accidental touches) -------------------------------------------------------

test('tapping Sleep asks first and logs nothing until it is confirmed', async () => {
  const calls = mockApi({ ...base({ open: null, last: null }), 'POST /api/sleep': { status: 201, body: { id: 'x' } } })
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.sleep.start }))
  const dialog = await screen.findByRole('dialog', { name: en.sleep.confirmStartTitle })
  expect(within(dialog).getByText(/AM|PM/)).toBeInTheDocument() // says what time it will be logged at
  expect(calls.some((c) => c.key === 'POST /api/sleep')).toBe(false)
  await userEvent.click(within(dialog).getByRole('button', { name: en.sleep.confirmStart }))
  await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/sleep')).toBe(true))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('cancelling the confirmation logs nothing', async () => {
  const calls = mockApi({ ...base({ open: null, last: null }), 'POST /api/sleep': { status: 201, body: { id: 'x' } } })
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.sleep.start }))
  const dialog = await screen.findByRole('dialog', { name: en.sleep.confirmStartTitle })
  await userEvent.click(within(dialog).getByRole('button', { name: en.sleep.cancel }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await userEvent.click(await screen.findByRole('button', { name: en.sleep.start }))
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(calls.some((c) => c.key === 'POST /api/sleep')).toBe(false)
})

test('waking up asks first too, and says how long she has been asleep', async () => {
  const calls = mockApi({ ...base({ open: session(), last: null }), 'POST /api/sleep/s1/end': { body: { id: 's1' } } })
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.sleep.end }))
  const dialog = await screen.findByRole('dialog', { name: en.sleep.confirmEndTitle })
  expect(dialog).toHaveTextContent('45m')
  expect(calls.some((c) => c.key === 'POST /api/sleep/s1/end')).toBe(false)
  await userEvent.click(within(dialog).getByRole('button', { name: en.sleep.confirmEnd }))
  await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/sleep/s1/end')).toBe(true))
})
