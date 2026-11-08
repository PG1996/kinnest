import { list, reject, remove, type QueueEntry } from './queue'

/** Where each kind of queued entry is sent. The id in a sleep_end payload is the session being ended. */
const pathFor = (e: QueueEntry): string => {
  switch (e.kind) {
    case 'feed':
      return '/api/feeds'
    case 'diaper':
      return '/api/diapers'
    case 'dose':
      return `/api/medicines/${e.payload.medicine_id}/doses`
    case 'nudge':
      return `/api/medicines/${e.payload.medicine_id}/nudges`
    case 'sleep_start':
      return '/api/sleep'
    case 'sleep_end':
      return `/api/sleep/${e.payload.id}/end`
  }
}

async function reasonFrom(res: Response): Promise<string> {
  const detail = await res.json().then((d) => d?.detail).catch(() => undefined)
  return typeof detail === 'string' ? detail : res.statusText || String(res.status)
}

async function run(): Promise<{ sent: number; failed: number }> {
  let sent = 0
  let failed = 0
  for (const entry of await list()) {
    let res: Response
    try {
      res = await fetch(pathFor(entry), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry.payload),
      })
    } catch {
      failed++ // still offline: keep everything, try again on the next trigger
      break
    }
    if (res.ok) {
      await remove(entry.id) // 200 (already stored) and 201 both mean the server has it
      sent++
    } else if (res.status === 401 || res.status === 429 || res.status >= 500) {
      failed++ // signed out, throttled or server trouble: keep and stop
      break
    } else {
      await reject(entry, await reasonFrom(res)) // the server will never accept this one
      failed++
    }
  }
  return { sent, failed }
}

let running: Promise<{ sent: number; failed: number }> | null = null

/** Send queued entries oldest first. Concurrent callers share one run so nothing is sent twice at once. */
export function flush() {
  running ??= run().finally(() => {
    running = null
  })
  return running
}
