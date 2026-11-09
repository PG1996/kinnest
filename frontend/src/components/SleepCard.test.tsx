import { screen } from '@testing-library/react'
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
