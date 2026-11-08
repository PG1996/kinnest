import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import en from '../i18n/en.json'
import { ME_ADMIN, ME_VIEWER, mockApi, renderApp } from '../test/utils'
import Login from './Login'
import Members from './Members'
import Settings from './Settings'

const MEMBERS = [
  { user_id: 'u1', email: 'owner@x.com', name: 'Owner', role: 'admin', pending: false },
  { user_id: null, email: 'aunt@x.com', name: '', role: 'viewer', pending: true },
]

test('Login renders Google button and email field using i18n keys', async () => {
  mockApi({})
  renderApp(<Login />, '/login')
  expect(screen.getByRole('link', { name: en.login.google })).toHaveAttribute('href', '/api/auth/google/start')
  expect(screen.getByLabelText(en.login.email)).toBeInTheDocument()
})

test('Login sends a magic link and confirms', async () => {
  const calls = mockApi({ 'POST /api/auth/magic/request': { body: { ok: true } } })
  renderApp(<Login />, '/login')
  await userEvent.type(screen.getByLabelText(en.login.email), 'mom@x.com')
  await userEvent.click(screen.getByRole('button', { name: en.login.sendLink }))
  expect(await screen.findByText(en.login.sent)).toBeInTheDocument()
  expect(calls.find((c) => c.key === 'POST /api/auth/magic/request')?.body).toEqual({ email: 'mom@x.com' })
})

test('Members page hides invite form for non-admin', async () => {
  mockApi({ 'GET /api/me': { body: ME_VIEWER }, 'GET /api/family/members': { body: MEMBERS } })
  renderApp(<Members />, '/members')
  expect(await screen.findByText('owner@x.com')).toBeInTheDocument()
  expect(screen.queryByLabelText(en.members.inviteEmail)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: en.members.remove })).not.toBeInTheDocument()
})

test('Members page lets admin invite and shows pending invites', async () => {
  const calls = mockApi({
    'GET /api/me': { body: ME_ADMIN },
    'GET /api/family/members': { body: MEMBERS },
    'POST /api/family/invites': { body: { ok: true } },
  })
  renderApp(<Members />, '/members')
  expect(await screen.findByText(en.members.pending)).toBeInTheDocument()
  await userEvent.type(screen.getByLabelText(en.members.inviteEmail), 'nanny@x.com')
  await userEvent.selectOptions(screen.getByLabelText(en.members.role), 'caregiver')
  await userEvent.click(screen.getByRole('button', { name: en.members.sendInvite }))
  await waitFor(() =>
    expect(calls.find((c) => c.key === 'POST /api/family/invites')?.body).toEqual({
      email: 'nanny@x.com',
      role: 'caregiver',
    }),
  )
})

test('pages contain no hard-coded English text outside t()', () => {
  const dir = __dirname
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.tsx') && !n.includes('.test.'))) {
    const src = readFileSync(join(dir, f), 'utf8')
    const textNodes = [...src.matchAll(/(?<![=-])>([^<>{}=;\n]*[A-Za-z]{2,}[^<>{}=;\n]*)</g)].map((m) => m[1].trim())
    expect(textNodes, `${f} has literal text`).toEqual([])
  }
})

test('Settings lets admin save feed interval and locks fields for viewers', async () => {
  const kid = { id: 'k1', name: 'Baby', birth_date: null, feed_interval_minutes: 180, diaper_alert_minutes: 240 }
  const calls = mockApi({
    'GET /api/me': { body: ME_ADMIN },
    'GET /api/kid': { body: kid },
    'PATCH /api/kid': { body: { ...kid, feed_interval_minutes: 150 } },
  })
  renderApp(<Settings />, '/settings')
  const input = await screen.findByLabelText(en.settings.feedInterval)
  await waitFor(() => expect(input).toBeEnabled())
  await userEvent.clear(input)
  await userEvent.type(input, '150')
  await userEvent.click(screen.getByRole('button', { name: en.settings.save }))
  await waitFor(() =>
    expect(calls.find((c) => c.key === 'PATCH /api/kid')?.body).toMatchObject({ feed_interval_minutes: 150 }),
  )
})

test('Settings fields are read-only for non-admin', async () => {
  const kid = { id: 'k1', name: 'Baby', birth_date: null, feed_interval_minutes: 180, diaper_alert_minutes: 240 }
  mockApi({ 'GET /api/me': { body: ME_VIEWER }, 'GET /api/kid': { body: kid } })
  renderApp(<Settings />, '/settings')
  expect(await screen.findByLabelText(en.settings.feedInterval)).toBeDisabled()
  expect(screen.queryByRole('button', { name: en.settings.save })).not.toBeInTheDocument()
})

test('Settings saves vaccine and visit toggles with the other preferences', async () => {
  const kid = { id: 'k1', name: 'Baby', birth_date: null, feed_interval_minutes: 180, diaper_alert_minutes: 240 }
  const prefs = { feed: true, diaper: true, medicine: true, vaccine: true, visit: true }
  const calls = mockApi({
    'GET /api/me': { body: ME_ADMIN },
    'GET /api/kid': { body: kid },
    'GET /api/notification-prefs': { body: prefs },
    'PUT /api/notification-prefs': (b) => ({ body: b }),
  })
  renderApp(<Settings />, '/settings')
  expect(await screen.findByText(en.settings.birthDateHint)).toBeInTheDocument()
  const vaccine = await screen.findByRole('checkbox', { name: en.settings.vaccineReminders })
  await waitFor(() => expect(vaccine).toBeEnabled())
  await userEvent.click(vaccine)
  await waitFor(() =>
    expect(calls.find((c) => c.key === 'PUT /api/notification-prefs')?.body).toEqual({ ...prefs, vaccine: false }),
  )
  await userEvent.click(screen.getByRole('checkbox', { name: en.settings.visitReminders }))
  await waitFor(() =>
    expect(calls.filter((c) => c.key === 'PUT /api/notification-prefs').at(-1)?.body).toEqual({
      ...prefs,
      vaccine: false,
      visit: false,
    }),
  )
})
