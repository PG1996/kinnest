/** Stub the browser push APIs: Notification, PushManager and a ready service worker. */
export function fakePushSupport(opts: { permission?: NotificationPermission; subscribed?: boolean } = {}) {
  const subscription = {
    endpoint: 'https://push.test/1',
    toJSON: () => ({ endpoint: 'https://push.test/1', keys: { p256dh: 'P', auth: 'A' } }),
    unsubscribe: vi.fn(async () => true),
  }
  const pushManager = {
    getSubscription: vi.fn(async () => (opts.subscribed ? subscription : null)),
    subscribe: vi.fn(async () => subscription),
  }
  const requestPermission = vi.fn(async () => 'granted' as NotificationPermission)
  vi.stubGlobal('Notification', { permission: opts.permission ?? 'default', requestPermission })
  vi.stubGlobal('PushManager', class {})
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve({ pushManager }) } })
  return { pushManager, requestPermission, subscription }
}
