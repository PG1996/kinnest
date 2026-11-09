import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import en from '../i18n/en.json'
import { ME_ADMIN, mockApi, renderApp } from '../test/utils'

const base = () => ({
  'GET /api/me': { body: ME_ADMIN },
  'GET /api/summary': { status: 500 },
  'GET /api/vitals': { body: [] },
  'GET /api/medicines': { body: [] },
  'GET /api/vaccines': { body: [] },
  'GET /api/visits': { body: [] },
  'GET /api/family/members': { body: [{ user_id: 'u1', email: 'owner@x.com', name: 'Owner', role: 'admin', pending: false }] },
})

test('nav has five links and marks the current one', async () => {
  mockApi(base())
  renderApp(<App />, '/')
  for (const name of [en.nav.home, en.nav.timeline, en.nav.health, en.nav.patterns, en.nav.family])
    expect(await screen.findByRole('link', { name })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: en.nav.home })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('link', { name: en.nav.timeline })).not.toHaveAttribute('aria-current')
  await userEvent.click(screen.getByRole('link', { name: en.nav.patterns }))
  expect(await screen.findByRole('heading', { name: en.patterns.title })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: en.nav.patterns })).toHaveAttribute('aria-current', 'page')
})

test('old links still land: /medicines opens the Medicines tab', async () => {
  mockApi(base())
  renderApp(<App />, '/medicines')
  expect(await screen.findByRole('tab', { name: en.health.tabs.medicines, selected: true })).toBeInTheDocument()
})

test('old links still land: /medicines?add=1 keeps the tab and opens the form', async () => {
  mockApi(base())
  renderApp(<App />, '/medicines?add=1')
  expect(await screen.findByRole('tab', { name: en.health.tabs.medicines, selected: true })).toBeInTheDocument()
  expect(await screen.findByLabelText(en.medicines.form.name)).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: en.health.tabs.medicines, selected: true })).toBeInTheDocument()
})

test('old links still land: /members and /settings open the Family tabs', async () => {
  mockApi(base())
  const { unmount } = renderApp(<App />, '/members')
  expect(await screen.findByRole('tab', { name: en.family.tabs.members, selected: true })).toBeInTheDocument()
  expect(await screen.findByText('owner@x.com')).toBeInTheDocument()
  unmount()
  renderApp(<App />, '/settings')
  expect(await screen.findByRole('tab', { name: en.family.tabs.settings, selected: true })).toBeInTheDocument()
})

test('old links still land: notification links open vaccines and visits', async () => {
  mockApi(base())
  const { unmount } = renderApp(<App />, '/?log=vaccine')
  expect(await screen.findByRole('tab', { name: en.health.tabs.vaccines, selected: true })).toBeInTheDocument()
  unmount()
  renderApp(<App />, '/?log=visit')
  expect(await screen.findByRole('tab', { name: en.health.tabs.visits, selected: true })).toBeInTheDocument()
})

test('sign out is in Family settings', async () => {
  const calls = mockApi({ ...base(), 'POST /api/auth/logout': { body: { ok: true } } })
  renderApp(<App />, '/family?tab=settings')
  await userEvent.click(await screen.findByRole('button', { name: en.common.signOut }))
  await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/auth/logout')).toBe(true))
})
