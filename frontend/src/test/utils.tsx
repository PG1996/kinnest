import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import i18n from '../i18n'

type Reply = { status?: number; body?: unknown }
export type Routes = Record<string, Reply | ((body: unknown) => Reply)>

/** Stub fetch; keys look like "GET /api/me". Unlisted calls answer 404. Returns the call log. */
export function mockApi(routes: Routes) {
  const calls: { key: string; body: unknown }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).split('?')[0]
      const key = `${init?.method ?? 'GET'} ${url}`
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ key, body })
      const r = routes[key]
      const reply = typeof r === 'function' ? r(body) : (r ?? { status: 404, body: { detail: 'nope' } })
      return new Response(JSON.stringify(reply.body ?? {}), {
        status: reply.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  )
  return calls
}

export function renderApp(ui: ReactElement, route = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

export const ME_ADMIN = {
  user: { id: 'u1', email: 'owner@x.com', name: 'Owner' },
  family_id: 'f1',
  kid_id: 'k1',
  role: 'admin',
}
export const ME_VIEWER = { ...ME_ADMIN, role: 'viewer' }
