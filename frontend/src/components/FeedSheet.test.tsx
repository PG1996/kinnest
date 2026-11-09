import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import en from '../i18n/en.json'
import { ME_ADMIN, mockApi, renderApp } from '../test/utils'
import FeedSheet from './FeedSheet'

const MEMBERS = [
  { user_id: 'u1', email: 'owner@x.com', name: 'Owner', role: 'admin', pending: false },
  { user_id: 'u2', email: 'mom@x.com', name: 'Mom', role: 'caregiver', pending: false },
]
const KID = { id: 'k1', name: 'Aanya', birth_date: '2026-10-23', feed_interval_minutes: 180, diaper_alert_minutes: 240 }
const api = () => ({
  'GET /api/me': { body: { ...ME_ADMIN, user: { ...ME_ADMIN.user, id: 'u1', name: 'Owner' } } },
  'GET /api/family/members': { body: MEMBERS },
  'GET /api/kid': { body: KID },
})
const last = { id: 'f', type: 'formula', started_at: '2026-11-08T08:00:00Z', duration_min: null, quantity_ml: 60, note: '', fed_by_user_id: 'u2', fed_by_name: 'Mom', created_by: 'u2' } as const

afterEach(() => vi.useRealTimers())

test('bottle type shows the amount stepper and breast type shows duration', async () => {
  mockApi(api())
  renderApp(<FeedSheet last={last} saving={false} failed={false} onSave={() => {}} onClose={() => {}} />)
  expect(screen.getByLabelText(en.home.amount)).toHaveTextContent('60')
  expect(screen.queryByLabelText(en.home.duration)).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /Amount \+10 ml|\+10 ml/ }))
  expect(screen.getByLabelText(en.home.amount)).toHaveTextContent('70')
  await userEvent.click(screen.getByRole('radio', { name: en.feedTypes.breast_both }))
  expect(screen.queryByLabelText(en.home.amount)).not.toBeInTheDocument()
  expect(screen.getByLabelText(en.home.duration)).toBeInTheDocument()
})

test('fed by defaults to me and can change', async () => {
  mockApi(api())
  const onSave = vi.fn()
  renderApp(<FeedSheet last={last} saving={false} failed={false} onSave={onSave} onClose={() => {}} />)
  expect(await screen.findByRole('button', { name: 'Owner', pressed: true })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Mom' }))
  expect(screen.getByRole('button', { name: 'Mom', pressed: true })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: en.home.saveFeed }))
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ type: 'formula', quantity_ml: 60, fed_by_user_id: 'u2' }))
})

test('saving as myself sends no fed_by_user_id', async () => {
  mockApi(api())
  const onSave = vi.fn()
  renderApp(<FeedSheet last={last} saving={false} failed={false} onSave={onSave} onClose={() => {}} />)
  await screen.findByRole('button', { name: 'Owner', pressed: true })
  await userEvent.click(screen.getByRole('button', { name: en.home.saveFeed }))
  expect(onSave.mock.calls[0]![0]).not.toHaveProperty('fed_by_user_id')
})

test('footer says when the next feed is due', async () => {
  mockApi(api())
  renderApp(<FeedSheet last={null} saving={false} failed={false} onSave={() => {}} onClose={() => {}} />)
  expect(await screen.findByText(/Next feed due about .* \(every 3h\)/)).toBeInTheDocument()
})

test('the timer fills the duration and the start time', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  mockApi(api())
  const onSave = vi.fn()
  renderApp(<FeedSheet last={null} saving={false} failed={false} onSave={onSave} onClose={() => {}} />)
  await act(async () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole('button', { name: en.home.timerStart })))
  await act(async () => vi.advanceTimersByTime(5 * 60_000))
  await act(async () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole('button', { name: new RegExp(en.home.timerStop) })))
  expect(screen.getByLabelText(en.home.duration)).toHaveValue(5)
})

// --- who fed: breast is always mom -----------------------------------------------------------------------------------

const FAMILY = [
  { user_id: 'u1', email: 'owner@x.com', name: 'Owner', role: 'admin', relation: 'dad', pending: false },
  { user_id: 'u2', email: 'mom@x.com', name: 'Pankhuri', role: 'admin', relation: 'mom', pending: false },
  { user_id: 'u3', email: 'nanny@x.com', name: 'Nanny', role: 'caregiver', relation: 'nanny', pending: false },
  { user_id: 'u4', email: 'aunt@x.com', name: 'Aunt', role: 'viewer', relation: null, pending: false },
]
const familyApi = () => ({ ...api(), 'GET /api/family/members': { body: FAMILY } })

test('a breast feed says it is fed by mom and offers no other choice', async () => {
  mockApi(familyApi())
  const onSave = vi.fn()
  renderApp(<FeedSheet last={null} saving={false} failed={false} onSave={onSave} onClose={() => {}} />)
  await userEvent.click(screen.getByRole('radio', { name: en.feedTypes.breast_left }))
  expect(await screen.findByText(en.feed.fedByMom.replace('{{name}}', 'Pankhuri'))).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Nanny' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: en.home.saveFeed }))
  expect(onSave.mock.calls[0]![0]).not.toHaveProperty('fed_by_user_id')
})

test('a bottle feed can be given by any admin or caregiver, never a viewer', async () => {
  mockApi(familyApi())
  const onSave = vi.fn()
  renderApp(<FeedSheet last={last} saving={false} failed={false} onSave={onSave} onClose={() => {}} />)
  expect(await screen.findByRole('button', { name: 'Nanny' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Pankhuri' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Aunt' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Nanny' }))
  await userEvent.click(screen.getByRole('button', { name: en.home.saveFeed }))
  expect(onSave.mock.calls[0]![0]).toMatchObject({ fed_by_user_id: 'u3' })
})

test('without a mom set, a breast feed still shows who is logging it', async () => {
  mockApi({ ...api(), 'GET /api/family/members': { body: FAMILY.map((m) => ({ ...m, relation: m.relation === 'mom' ? null : m.relation })) } })
  renderApp(<FeedSheet last={null} saving={false} failed={false} onSave={() => {}} onClose={() => {}} />)
  await userEvent.click(screen.getByRole('radio', { name: en.feedTypes.breast_left }))
  expect(await screen.findByRole('button', { name: 'Owner', pressed: true })).toBeInTheDocument()
})
