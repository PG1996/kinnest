export class ApiError extends Error {
  status: number
  /** The parsed response body, e.g. a 409 on sleep start carries the session that is already open. */
  body?: unknown
  constructor(status: number, message: string, body?: unknown) {
    super(message)
    this.status = status
    this.body = body
  }
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...rest,
    method: rest.method ?? (json !== undefined ? 'POST' : 'GET'),
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => undefined)
    const detail = body?.detail
    throw new ApiError(res.status, typeof detail === 'string' ? detail : res.statusText, body)
  }
  return (await res.json()) as T
}
