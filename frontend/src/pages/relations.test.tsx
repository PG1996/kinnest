import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import en from '../i18n/en.json'
import { ME_ADMIN, ME_VIEWER, mockApi, renderApp } from '../test/utils'
import Members from './Members'

const MEMBERS = [
  { user_id: 'u1', email: 'owner@x.com', name: 'Parth Goel', role: 'admin', relation: 'dad', pending: false },
  { user_id: 'u2', email: 'mom@x.com', name: 'Pankhuri Agrawal', role: 'admin', relation: 'mom', pending: false },
  { user_id: 'u3', email: 'nanny@x.com', name: 'Nanny', role: 'caregiver', relation: null, pending: false },
]
const api = (me: object = ME_ADMIN, extra: object = {}) => ({ 'GET /api/me': { body: me }, 'GET /api/family/members': { body: MEMBERS }, ...extra })

test('the member list names how each person is related to the baby', async () => {
  mockApi(api(ME_VIEWER))
  renderApp(<Members />, '/family')
  expect(await screen.findByText(en.relations.mom)).toBeInTheDocument()
  expect(screen.getByText(en.relations.dad)).toBeInTheDocument()
})

test('an admin sets or clears a relation', async () => {
  const calls = mockApi(api(ME_ADMIN, { 'PATCH /api/family/members/u3': { body: { ok: true } } }))
  renderApp(<Members />, '/family')
  const pick = await screen.findByLabelText(en.members.relationFor.replace('{{email}}', 'nanny@x.com'))
  await userEvent.selectOptions(pick, 'nanny')
  await waitFor(() => expect(calls.find((c) => c.key === 'PATCH /api/family/members/u3')?.body).toEqual({ relation: 'nanny' }))
  await userEvent.selectOptions(pick, '')
  await waitFor(() => expect(calls.filter((c) => c.key === 'PATCH /api/family/members/u3').at(-1)?.body).toEqual({ relation: null }))
})

test('a refused relation change explains itself', async () => {
  mockApi(api(ME_ADMIN, { 'PATCH /api/family/members/u3': { status: 409, body: { detail: 'the baby already has a mom' } } }))
  renderApp(<Members />, '/family')
  await userEvent.selectOptions(await screen.findByLabelText(en.members.relationFor.replace('{{email}}', 'nanny@x.com')), 'mom')
  expect(await screen.findByText(en.members.relationRefused)).toBeInTheDocument()
})

test('an invite can carry an optional relation', async () => {
  const calls = mockApi(api(ME_ADMIN, { 'POST /api/family/invites': { body: { ok: true } } }))
  renderApp(<Members />, '/family')
  await userEvent.type(await screen.findByLabelText(en.members.inviteEmail), 'gran@x.com')
  await userEvent.selectOptions(screen.getByLabelText(en.members.inviteRelation), 'grandparent')
  await userEvent.click(screen.getByRole('button', { name: en.members.sendInvite }))
  await waitFor(() => expect(calls.find((c) => c.key === 'POST /api/family/invites')?.body).toEqual({ email: 'gran@x.com', role: 'caregiver', relation: 'grandparent' }))
})

test('an invite can name the baby\'s aunt', async () => {
  const calls = mockApi(api(ME_ADMIN, { 'POST /api/family/invites': { body: { ok: true } } }))
  renderApp(<Members />, '/family')
  await userEvent.type(await screen.findByLabelText(en.members.inviteEmail), 'aunt@x.com')
  const pick = screen.getByLabelText(en.members.inviteRelation)
  expect(within(pick).getByRole('option', { name: 'Aunt' })).toBeInTheDocument()
  await userEvent.selectOptions(pick, 'aunt')
  await userEvent.click(screen.getByRole('button', { name: en.members.sendInvite }))
  await waitFor(() => expect(calls.find((c) => c.key === 'POST /api/family/invites')?.body).toEqual({ email: 'aunt@x.com', role: 'caregiver', relation: 'aunt' }))
})

test('an invite without a relation sends none', async () => {
  const calls = mockApi(api(ME_ADMIN, { 'POST /api/family/invites': { body: { ok: true } } }))
  renderApp(<Members />, '/family')
  await userEvent.type(await screen.findByLabelText(en.members.inviteEmail), 'gran@x.com')
  await userEvent.click(screen.getByRole('button', { name: en.members.sendInvite }))
  await waitFor(() => expect(calls.find((c) => c.key === 'POST /api/family/invites')?.body).toEqual({ email: 'gran@x.com', role: 'caregiver' }))
})

// --- the baby needs a mom or a dad -------------------------------------------------------------------------------

test('a family without a mom or dad asks the admin who they are, before anything else', async () => {
  const calls = mockApi(api({ ...ME_ADMIN, relation: null, needs_parent: true }, { 'PATCH /api/family/members/u1': { body: { ok: true } }, 'GET /api/timeline': { body: { items: [] } } }))
  renderApp(<App />, '/timeline')
  const gate = await screen.findByRole('dialog', { name: en.setup.title })
  await userEvent.click(within(gate).getByRole('button', { name: en.relations.mom }))
  await waitFor(() => expect(calls.find((c) => c.key === 'PATCH /api/family/members/u1')?.body).toEqual({ relation: 'mom' }))
})

test('the question is only for the admin and only while it is missing', async () => {
  mockApi(api({ ...ME_VIEWER, relation: null, needs_parent: true }, { 'GET /api/timeline': { body: { items: [] } } }))
  const viewer = renderApp(<App />, '/timeline')
  await screen.findByText(en.timeline.empty)
  expect(screen.queryByRole('dialog', { name: en.setup.title })).not.toBeInTheDocument()
  viewer.unmount()
  mockApi(api({ ...ME_ADMIN, relation: 'dad', needs_parent: false }, { 'GET /api/timeline': { body: { items: [] } } }))
  renderApp(<App />, '/timeline')
  await screen.findByText(en.timeline.empty)
  expect(screen.queryByRole('dialog', { name: en.setup.title })).not.toBeInTheDocument()
})
