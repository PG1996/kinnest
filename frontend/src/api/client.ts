export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
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
    const detail = await res.json().then((d) => d?.detail).catch(() => undefined)
    throw new ApiError(res.status, typeof detail === 'string' ? detail : res.statusText)
  }
  return (await res.json()) as T
}
