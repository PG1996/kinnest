import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import en from './i18n/en.json'
import { fakePushSupport } from './test/push'
import { ME_ADMIN, mockApi, renderApp } from './test/utils'

test('signed-out visitor is sent to the login page', async () => {
  mockApi({ 'GET /api/me': { status: 401, body: { detail: 'not signed in' } } })
  renderApp(<App />, '/')
  expect(await screen.findByRole('link', { name: en.login.google })).toBeInTheDocument()
})

test('signed-in member sees the app navigation', async () => {
  mockApi({ 'GET /api/me': { body: ME_ADMIN } })
  renderApp(<App />, '/')
  expect(await screen.findByRole('link', { name: en.nav.members })).toBeInTheDocument()
})

test('theme toggle switches the data-theme attribute', async () => {
  mockApi({ 'GET /api/me': { body: ME_ADMIN } })
  renderApp(<App />, '/')
  const toggle = await screen.findByRole('button', { name: en.theme.toggle })
  const before = document.documentElement.dataset.theme
  toggle.click()
  expect(document.documentElement.dataset.theme).not.toBe(before)
})

test('signing out removes this phone push subscription first', async () => {
  const fake = fakePushSupport({ permission: 'granted', subscribed: true })
  const calls = mockApi({
    'GET /api/me': { body: ME_ADMIN },
    'DELETE /api/push/subscribe': { body: { ok: true } },
    'POST /api/auth/logout': { body: { ok: true } },
  })
  renderApp(<App />, '/')
  await userEvent.click(await screen.findByRole('button', { name: en.common.signOut }))
  await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/auth/logout')).toBe(true))
  const keys = calls.map((c) => c.key)
  expect(keys.indexOf('DELETE /api/push/subscribe')).toBeGreaterThan(-1)
  expect(keys.indexOf('DELETE /api/push/subscribe')).toBeLessThan(keys.indexOf('POST /api/auth/logout'))
  expect(calls.find((c) => c.key === 'DELETE /api/push/subscribe')?.body).toEqual({ endpoint: 'https://push.test/1' })
  expect(fake.subscription.unsubscribe).toHaveBeenCalled()
})

test('signing out still works when push is unavailable or never becomes ready', async () => {
  const calls = mockApi({ 'GET /api/me': { body: ME_ADMIN }, 'POST /api/auth/logout': { body: { ok: true } } })
  renderApp(<App />, '/')
  await userEvent.click(await screen.findByRole('button', { name: en.common.signOut }))
  await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/auth/logout')).toBe(true))
})
