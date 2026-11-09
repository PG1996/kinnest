import { screen, within } from '@testing-library/react'
import App from '../App'
import en from '../i18n/en.json'
import { ME_ADMIN, ME_VIEWER, mockApi, renderApp } from '../test/utils'

const MEMBERS = [
  { user_id: 'u1', email: 'owner@x.com', name: 'Owner Person', role: 'admin', pending: false },
  { user_id: 'u2', email: 'mom@x.com', name: 'Mom', role: 'caregiver', pending: false },
  { user_id: null, email: 'aunt@x.com', name: '', role: 'viewer', pending: true },
]
const KID = { id: 'k1', name: 'Aanya', birth_date: null, feed_interval_minutes: 180, diaper_alert_minutes: 240 }
const api = (me: object) => ({
  'GET /api/me': { body: me },
  'GET /api/family/members': { body: MEMBERS },
  'GET /api/kid': { body: KID },
  'GET /api/notification-prefs': { body: { feed: true, diaper: false, medicine: true, vaccine: true, visit: true } },
})

test('members show an avatar with initials, the role and who is still invited', async () => {
  mockApi(api(ME_VIEWER))
  renderApp(<App />, '/family')
  const row = (await screen.findByText('mom@x.com')).closest('li')!
  expect(within(row).getByText('M')).toBeInTheDocument()
  expect(within(row).getByText(en.roles.caregiver)).toBeInTheDocument()
  const owner = screen.getByText('owner@x.com').closest('li')!
  expect(within(owner).getByText('OP')).toBeInTheDocument()
  expect(within(screen.getByText('aunt@x.com').closest('li')!).getByText(en.members.pending)).toBeInTheDocument()
})

test('reminder switches show the saved state', async () => {
  mockApi(api(ME_ADMIN))
  renderApp(<App />, '/family?tab=settings')
  expect(await screen.findByRole('switch', { name: en.settings.feedReminders, checked: true })).toBeInTheDocument()
  expect(await screen.findByRole('switch', { name: en.settings.diaperAlerts, checked: false })).toBeInTheDocument()
})

test('a viewer sees no write controls in Family', async () => {
  mockApi(api(ME_VIEWER))
  const { unmount } = renderApp(<App />, '/family')
  await screen.findByText('mom@x.com')
  expect(screen.queryByLabelText(en.members.inviteEmail)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: en.members.remove })).not.toBeInTheDocument()
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  unmount()
  renderApp(<App />, '/family?tab=settings')
  expect(await screen.findByLabelText(en.settings.kidName)).toBeDisabled()
  expect(screen.queryByRole('button', { name: en.settings.save })).not.toBeInTheDocument()
})

test('only the admin can change roles, invite and edit the baby', async () => {
  mockApi(api(ME_ADMIN))
  const { unmount } = renderApp(<App />, '/family')
  expect(await screen.findByLabelText(en.members.inviteEmail)).toBeInTheDocument()
  expect(await screen.findByLabelText(en.members.roleFor.replace('{{email}}', 'mom@x.com'))).toBeInTheDocument()
  unmount()
  renderApp(<App />, '/family?tab=settings')
  expect(await screen.findByLabelText(en.settings.kidName)).toBeEnabled()
  expect(screen.getByRole('button', { name: en.settings.save })).toBeInTheDocument()
})
