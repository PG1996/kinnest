// Loaded by the generated service worker (workbox importScripts). Shows push notifications and opens the app on tap.
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {}
  event.waitUntil(
    self.registration.showNotification(data.title || 'Kinnest', {
      body: data.body || '',
      tag: data.tag,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/', stopUrl: data.stopUrl },
      // a status such as "feeding since 9:10 PM" is quiet, shows when it started, and may carry buttons (Android)
      silent: data.silent === true,
      timestamp: typeof data.timestamp === 'number' ? data.timestamp : undefined,
      actions: Array.isArray(data.actions) ? data.actions : undefined,
      requireInteraction: data.requireInteraction === true,
      // a reminder shouts again if it repeats; a status only refreshes in place
      renotify: data.silent !== true,
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const info = event.notification.data || {}
  // a button on the notification ("Stop") goes to its own address; a tap on the body opens the app
  const url = (event.action && info.stopUrl) || info.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if ('focus' in w) return w.navigate(url).then(() => w.focus())
      }
      return self.clients.openWindow(url)
    }),
  )
})
