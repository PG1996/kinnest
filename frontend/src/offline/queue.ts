import { openDB } from 'idb'

export type QueueEntry = {
  kind: 'feed' | 'diaper' | 'dose' | 'nudge' | 'sleep_start' | 'sleep_end' | 'vital'
  id: string
  payload: Record<string, unknown>
  queuedAt: number
  seq: number
}
export type Rejected = QueueEntry & { reason: string }

const open = () =>
  openDB('kinnest-offline', 1, {
    upgrade(db) {
      db.createObjectStore('queue', { keyPath: 'id' })
      db.createObjectStore('rejected', { keyPath: 'id' })
    },
  })

let counter = 0
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((cb) => cb())
export const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => void listeners.delete(cb)
}

async function all<T>(store: 'queue' | 'rejected'): Promise<T[]> {
  const db = await open()
  const rows = (await db.getAll(store)) as T[]
  db.close()
  return rows
}

/** Entries waiting to sync, oldest first. */
export async function list(): Promise<QueueEntry[]> {
  const rows = await all<QueueEntry>('queue')
  return rows.sort((a, b) => a.queuedAt - b.queuedAt || a.seq - b.seq)
}

/** Queue an entry. The client-generated id makes re-sending safe: the server keeps one row per id. */
export async function enqueue(e: Pick<QueueEntry, 'kind' | 'id' | 'payload'>): Promise<void> {
  const db = await open()
  await db.put('queue', { ...e, queuedAt: Date.now(), seq: counter++ })
  db.close()
  notify()
}

export async function remove(id: string): Promise<void> {
  const db = await open()
  await db.delete('queue', id)
  db.close()
  notify()
}

export async function reject(e: QueueEntry, reason: string): Promise<void> {
  const db = await open()
  const tx = db.transaction(['queue', 'rejected'], 'readwrite')
  await tx.objectStore('queue').delete(e.id)
  await tx.objectStore('rejected').put({ ...e, reason })
  await tx.done
  db.close()
  notify()
}

export const listRejected = () => all<Rejected>('rejected')

export async function clearRejected(): Promise<void> {
  const db = await open()
  await db.clear('rejected')
  db.close()
  notify()
}
