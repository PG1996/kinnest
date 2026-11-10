import { screen } from '@testing-library/react'
import en from '../i18n/en.json'
import QuickLog from './QuickLog'
import { mockApi, renderApp, ME_ADMIN } from '../test/utils'
import SleepCard from './SleepCard'

const midnight = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime()

test('the Home sleep card shows a small donut of today, linking to the sleep screen', async () => {
  // slept from midnight to 01:00 today, so the card has something to draw whatever the time now
  const s = { id: 's1', started_at: new Date(midnight).toISOString(), ended_at: new Date(midnight + 3_600_000).toISOString(), duration_min: 60, started_by_name: 'Mom' }
  mockApi({ 'GET /api/me': { body: ME_ADMIN }, 'GET /api/sleep': { body: [s] } })
  renderApp(<SleepCard sleep={undefined} now={Date.now()} />)
  const donut = await screen.findByRole('img', { name: /slept/i })
  expect(donut.closest('a')).toHaveAttribute('href', '/sleep')
  expect(donut.getAttribute('width')).toBe('72')
})

test('the mini donut has no legend or hour labels', async () => {
  mockApi({ 'GET /api/me': { body: ME_ADMIN }, 'GET /api/sleep': { body: [] } })
  renderApp(<SleepCard sleep={undefined} now={Date.now()} />)
  await screen.findByRole('img', { name: /slept/i })
  expect(screen.queryByText('12 AM')).not.toBeInTheDocument()
})

const icon = (el: Element, name: string) => el.querySelector(`svg.lucide-${name}`)

test('the sleep tile shows a moon to start a sleep and a sunrise to wake up', () => {
  const props = { onFeed: () => {}, onDiaper: () => {}, onSleep: () => {}, onMedicine: () => {} }
  const awake = renderApp(<QuickLog {...props} asleep={false} />)
  const start = screen.getByRole('button', { name: en.sleep.start })
  expect(icon(start, 'moon')).not.toBeNull()
  expect(icon(start, 'sunrise')).toBeNull()
  awake.unmount()
  renderApp(<QuickLog {...props} asleep />)
  const wake = screen.getByRole('button', { name: en.sleep.end })
  expect(icon(wake, 'sunrise')).not.toBeNull()
  expect(icon(wake, 'moon')).toBeNull()
})

test('the Home sleep card shows a moon while asleep and a sun once awake', async () => {
  mockApi({ 'GET /api/me': { body: ME_ADMIN }, 'GET /api/sleep': { body: [] } })
  const started = new Date(Date.now() - 3_600_000).toISOString()
  const asleep = renderApp(<SleepCard sleep={{ open: { id: 's1', started_at: started, ended_at: null, duration_min: null, started_by_name: 'Mom' }, last: null } as never} now={Date.now()} />)
  const card = await screen.findByTestId('sleep-card')
  expect(icon(card, 'moon')).not.toBeNull()
  asleep.unmount()
  const ended = new Date(Date.now() - 600_000).toISOString()
  renderApp(<SleepCard sleep={{ open: null, last: { id: 's1', started_at: started, ended_at: ended, duration_min: 50, started_by_name: 'Mom', ended_by_name: 'Mom' } } as never} now={Date.now()} />)
  const awakeCard = await screen.findByTestId('sleep-card')
  expect(icon(awakeCard, 'sun')).not.toBeNull()
  expect(icon(awakeCard, 'moon')).toBeNull()
})
