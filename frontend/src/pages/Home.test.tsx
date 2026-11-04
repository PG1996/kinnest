import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import en from '../i18n/en.json'
import { formatAgo, formatClock } from '../lib/time'
import { ME_ADMIN, ME_VIEWER, mockApi, renderApp } from '../test/utils'
import Home from './Home'

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
const minsFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString()

const SUMMARY = (over: object = {}) => ({
  last_feed: {
    id: 'f1', type: 'formula', started_at: minsAgo(130), duration_min: null, quantity_ml: 60,
    note: '', fed_by_user_id: 'u2', fed_by_name: 'Mom', created_by: 'u2',
  },
  next_feed_due_at: minsFromNow(50),
  last_diaper: { id: 'd1', kind: 'wet', at: minsAgo(65), changed_by_name: 'Nanny' },
  feeds_today: 4,
  diapers_today: { wet: 3, dirty: 1, both: 0 },
  ...over,
})

const base = (me = ME_ADMIN, summary: object = SUMMARY()) => ({
  'GET /api/me': { body: me },
  'GET /api/summary': { body: summary },
})

test('formatAgo renders minutes, hours and days', () => {
  expect(formatAgo(30_000)).toBe('<1m')
  expect(formatAgo(5 * 60_000)).toBe('5m')
  expect(formatAgo(130 * 60_000)).toBe('2h 10m')
  expect(formatAgo((26 * 60 + 5) * 60_000)).toBe('1d 2h')
})

test('shows last fed relative time and next due', async () => {
  mockApi(base())
  renderApp(<Home />)
  expect(await screen.findByText(en.home.lastFed.replace('{{ago}}', '2h 10m'))).toBeInTheDocument()
  expect(screen.getByText(/Mom/)).toHaveTextContent('60 ml')
  const due = SUMMARY().next_feed_due_at
  expect(screen.getByText(en.home.nextDue.replace('{{time}}', formatClock(due)))).toBeInTheDocument()
  expect(screen.getByText(en.home.lastDiaper.replace('{{ago}}', '1h 5m'))).toBeInTheDocument()
})

test('flags an overdue feed', async () => {
  mockApi(base(ME_ADMIN, SUMMARY({ next_feed_due_at: minsAgo(20) })))
  renderApp(<Home />)
  expect(await screen.findByText(en.home.overdue.replace('{{ago}}', '20m'))).toBeInTheDocument()
})

test('shows empty states before anything is logged', async () => {
  mockApi(base(ME_ADMIN, SUMMARY({ last_feed: null, next_feed_due_at: null, last_diaper: null })))
  renderApp(<Home />)
  expect(await screen.findByText(en.home.neverFed)).toBeInTheDocument()
  expect(screen.getByText(en.home.noDiaper)).toBeInTheDocument()
})

test('viewer sees no log buttons', async () => {
  mockApi(base(ME_VIEWER))
  renderApp(<Home />)
  await screen.findByText(en.home.lastFed.replace('{{ago}}', '2h 10m'))
  expect(screen.queryByRole('button', { name: en.home.feed })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: en.home.diaper })).not.toBeInTheDocument()
})

test('diaper wet button posts immediately and offers undo', async () => {
  const calls = mockApi({
    ...base(),
    'POST /api/diapers': { status: 201, body: { id: 'x', recent_other: null } },
    'DELETE /api/diapers/': { body: { ok: true } },
  })
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.home.diaper }))
  await userEvent.click(screen.getByRole('button', { name: en.diaperKinds.wet }))
  const post = await waitFor(() => {
    const c = calls.find((c) => c.key === 'POST /api/diapers')
    expect(c).toBeTruthy()
    return c!
  })
  expect(post.body).toMatchObject({ kind: 'wet' })
  const id = (post.body as { id: string }).id
  expect(id).toMatch(/^[0-9a-f-]{36}$/)
  expect(new Date((post.body as { at: string }).at).getTime()).toBeLessThanOrEqual(Date.now())
  const undo = await screen.findByRole('button', { name: en.home.undo })
  mockApi({ ...base(), [`DELETE /api/diapers/${id}`]: { body: { ok: true } } })
  await userEvent.click(undo)
  await waitFor(() => expect(screen.queryByRole('button', { name: en.home.undo })).not.toBeInTheDocument())
})

test('feed sheet is prefilled from the last feed and saves in one tap', async () => {
  const calls = mockApi({ ...base(), 'POST /api/feeds': { status: 201, body: { id: 'x', recent_other: null } } })
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.home.feed }))
  expect(screen.getByLabelText(en.home.amount)).toHaveValue(60)
  await userEvent.click(screen.getByRole('button', { name: en.home.saveFeed }))
  await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/feeds')).toBe(true))
  const body = calls.find((c) => c.key === 'POST /api/feeds')!.body as Record<string, unknown>
  expect(body).toMatchObject({ type: 'formula', quantity_ml: 60 })
  expect(body.id).toMatch(/^[0-9a-f-]{36}$/)
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

test('feed sheet hides ml for breast types', async () => {
  mockApi(base())
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.home.feed }))
  expect(screen.getByLabelText(en.home.amount)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('radio', { name: en.feedTypes.breast_left }))
  expect(screen.queryByLabelText(en.home.amount)).not.toBeInTheDocument()
  expect(screen.getByLabelText(en.home.duration)).toBeInTheDocument()
})

test('warns when someone else just logged the same thing', async () => {
  mockApi({
    ...base(),
    'POST /api/feeds': { status: 201, body: { id: 'x', recent_other: { user_name: 'Mom', at: new Date().toISOString() } } },
  })
  renderApp(<Home />)
  await userEvent.click(await screen.findByRole('button', { name: en.home.feed }))
  await userEvent.click(screen.getByRole('button', { name: en.home.saveFeed }))
  expect(await screen.findByText(en.home.alsoLogged.replace('{{name}}', 'Mom'))).toBeInTheDocument()
})
