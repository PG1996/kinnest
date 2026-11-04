import { screen } from '@testing-library/react'
import App from './App'
import en from './i18n/en.json'
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
