import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import en from '../i18n/en.json'
import type { ReactElement } from 'react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import i18n from '../i18n'

type Reply = { status?: number; body?: unknown }
export type Routes = Record<string, Reply | ((body: unknown) => Reply)>

/** Stub fetch; keys look like "GET /api/me". Unlisted calls answer 404. Returns the call log. */
export function mockApi(routes: Routes) {
  const calls: { key: string; body: unknown; url: string }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).split('?')[0]
      const key = `${init?.method ?? 'GET'} ${url}`
      // JSON bodies are parsed for assertions; a FormData upload is passed through as is
      const body = init?.body instanceof FormData ? init.body : init?.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ key, body, url: String(input) })
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

/** Click a button of the open medicine card; the less common ones (Partial dose, Skip, At another time) wait under More. */
export async function clickAction(name: string) {
  await waitFor(() => expect(screen.queryAllByRole('button', { name }).length + screen.queryAllByRole('button', { name: en.medicines.more }).length).toBeGreaterThan(0))
  let found = screen.queryAllByRole('button', { name })
  if (found.length === 0) {
    await userEvent.click(await screen.findByRole('button', { name: en.medicines.more }))
    found = await screen.findAllByRole('button', { name })
  }
  await userEvent.click(found[0]!)
}
