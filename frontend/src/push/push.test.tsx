import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import en from '../i18n/en.json'
import Home from '../pages/Home'
import Settings from '../pages/Settings'
import { fakePushSupport } from '../test/push'
import { ME_ADMIN, ME_VIEWER, mockApi, renderApp } from '../test/utils'
import PushPrompt from '../components/PushPrompt'
import { urlBase64ToUint8Array } from './subscribe'

const SUMMARY = { last_feed: null, next_feed_due_at: null, last_diaper: null, feeds_today: 0, diapers_today: { wet: 0, dirty: 0, both: 0 } }

afterEach(() => {
  // @ts-expect-error cleanup of the stubbed property
  delete navigator.serviceWorker
})

test('urlBase64ToUint8Array decodes a VAPID public key', () => {
  expect(Array.from(urlBase64ToUint8Array('AQID'))).toEqual([1, 2, 3])
  expect(Array.from(urlBase64ToUint8Array('-_8'))).toEqual([251, 255])
})

test('enable reminders asks permission, subscribes and registers with the server', async () => {
  const fake = fakePushSupport()
  const calls = mockApi({
    'GET /api/push/public-key': { body: { public_key: 'AQID' } },
    'POST /api/push/subscribe': { body: { ok: true } },
  })
  renderApp(<PushPrompt alwaysShow />)
  await userEvent.click(await screen.findByRole('button', { name: en.push.enable }))
  await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/push/subscribe')).toBe(true))
  expect(fake.requestPermission).toHaveBeenCalled()
  expect(fake.pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }))
  expect(calls.find((c) => c.key === 'POST /api/push/subscribe')?.body).toEqual({
    endpoint: 'https://push.test/1',
    keys: { p256dh: 'P', auth: 'A' },
  })
  expect(await screen.findByText(en.push.on)).toBeInTheDocument()
})

test('iPhone browser tab explains Add to Home Screen instead of offering push', async () => {
  vi.stubGlobal('navigator', Object.create(navigator, { userAgent: { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari' } }))
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  mockApi({})
  renderApp(<PushPrompt />)
  expect(await screen.findByText(en.push.iosInstall)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: en.push.enable })).not.toBeInTheDocument()
})

test('blocked notifications show how to unblock', async () => {
  fakePushSupport({ permission: 'denied' })
  mockApi({})
  renderApp(<PushPrompt />)
  expect(await screen.findByText(en.push.denied)).toBeInTheDocument()
})

test('Home offers reminders to caregivers but not viewers', async () => {
  fakePushSupport()
  mockApi({ 'GET /api/me': { body: ME_ADMIN }, 'GET /api/summary': { body: SUMMARY } })
  const { unmount } = renderApp(<Home />)
  expect(await screen.findByRole('button', { name: en.push.enable })).toBeInTheDocument()
  unmount()
  mockApi({ 'GET /api/me': { body: ME_VIEWER }, 'GET /api/summary': { body: SUMMARY } })
  renderApp(<Home />)
  await screen.findByText(en.home.neverFed)
  expect(screen.queryByRole('button', { name: en.push.enable })).not.toBeInTheDocument()
})

test('tapping a notification (?log=feed) opens the feed sheet', async () => {
  mockApi({ 'GET /api/me': { body: ME_ADMIN }, 'GET /api/summary': { body: SUMMARY } })
  renderApp(<Home />, '/?log=feed')
  expect(await screen.findByRole('dialog', { name: en.home.feed })).toBeInTheDocument()
})

test('Settings toggles save notification preferences', async () => {
  const kid = { id: 'k1', name: 'Baby', birth_date: null, feed_interval_minutes: 180, diaper_alert_minutes: 240 }
  const calls = mockApi({
    'GET /api/me': { body: ME_ADMIN },
    'GET /api/kid': { body: kid },
    'GET /api/notification-prefs': { body: { feed: true, diaper: true } },
    'PUT /api/notification-prefs': { body: { feed: false, diaper: true } },
  })
  renderApp(<Settings />)
  await userEvent.click(await screen.findByRole('checkbox', { name: en.settings.feedReminders }))
  await waitFor(() =>
    expect(calls.find((c) => c.key === 'PUT /api/notification-prefs')?.body).toEqual({ feed: false, diaper: true }),
  )
})

test('a browser push failure is logged with its real reason and shown as an error', async () => {
  const fake = fakePushSupport()
  fake.pushManager.subscribe.mockRejectedValue(new DOMException('Registration failed - push service error', 'AbortError'))
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  mockApi({ 'GET /api/push/public-key': { body: { public_key: 'AQID' } } })
  renderApp(<PushPrompt alwaysShow />)
  await userEvent.click(await screen.findByRole('button', { name: en.push.enable }))
  expect(await screen.findByText(en.push.error)).toBeInTheDocument()
  expect(log).toHaveBeenCalledWith('enablePush failed', expect.objectContaining({ name: 'AbortError' }))
  log.mockRestore()
})
