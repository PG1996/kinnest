import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import en from '../i18n/en.json'
import { ME_ADMIN, mockApi, renderApp } from '../test/utils'
import FeedEditForm from './FeedEditForm'

const started = new Date(Date.now() - 3_600_000).toISOString()
const FEED = { id: 'f1', type: 'breast_left', started_at: started, duration_min: 35, break_min: 15, quantity_ml: null, note: '', fed_by_user_id: 'u2', fed_by_name: 'Mom', created_by: 'u2' }
const api = () => ({
  'GET /api/me': { body: ME_ADMIN },
  'GET /api/family/members': { body: [] },
  'PATCH /api/feeds/f1': (b: unknown) => ({ body: { ...FEED, ...(b as object) } }),
  'POST /api/feeds': (b: unknown) => ({ status: 201, body: { ...(b as object), fed_by_name: 'Owner', recent_other: null } }),
})

test('the breaks of a feed are shown and can be fixed', async () => {
  const calls = mockApi(api())
  renderApp(<FeedEditForm feed={FEED as never} onClose={() => {}} />)
  const input = await screen.findByLabelText(en.feed.breaksInput)
  expect(input).toHaveValue(15)
  await userEvent.clear(input)
  await userEvent.type(input, '20')
  await userEvent.click(screen.getByRole('button', { name: en.timeline.save }))
  await waitFor(() => expect(calls.find((c) => c.key === 'PATCH /api/feeds/f1')?.body).toEqual({ break_min: 20 }))
})

test('a feed with no breaks shows 0, and a past feed can be added with breaks', async () => {
  const calls = mockApi(api())
  renderApp(<FeedEditForm onClose={() => {}} />)
  await userEvent.click(await screen.findByRole('radio', { name: en.feedTypes.breast_left }))
  expect(await screen.findByLabelText(en.feed.breaksInput)).toHaveValue(0)
  await userEvent.type(screen.getByLabelText(en.home.duration), '30')
  await userEvent.clear(screen.getByLabelText(en.feed.breaksInput))
  await userEvent.type(screen.getByLabelText(en.feed.breaksInput), '10')
  await userEvent.click(screen.getByRole('button', { name: en.timeline.save }))
  await waitFor(() => expect(calls.find((c) => c.key === 'POST /api/feeds')?.body).toMatchObject({ duration_min: 30, break_min: 10 }))
})

test('a bottle feed has no breaks field', async () => {
  mockApi(api())
  renderApp(<FeedEditForm feed={{ ...FEED, type: 'formula', quantity_ml: 60, duration_min: null, break_min: 0 } as never} onClose={() => {}} />)
  await screen.findByRole('radio', { name: en.feedTypes.formula })
  expect(screen.queryByLabelText(en.feed.breaksInput)).not.toBeInTheDocument()
})
