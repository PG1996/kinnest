import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api/client'
import { RELATIONS, useMe, type Relation, type Role } from '../api/hooks'
import { Button } from '../components/ui/button'
import { Avatar } from '../components/ui/avatar'
import { Badge } from '../components/ui/badge'
import { Card } from '../components/ui/card'
import { Input, Select } from '../components/ui/field'

type Row = { user_id: string | null; email: string; name: string; role: Role; relation?: Relation | null; pending: boolean }
const ROLES: Role[] = ['admin', 'caregiver', 'viewer']

export default function Members() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const me = useMe().data
  const isAdmin = me?.role === 'admin'
  const members = useQuery({ queryKey: ['members'], queryFn: () => api<Row[]>('/api/family/members') })
  const refresh = () => qc.invalidateQueries({ queryKey: ['members'] })
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('caregiver')
  const [relation, setRelation] = useState<Relation | ''>('')
  const [confirming, setConfirming] = useState<string | null>(null)

  const invite = useMutation({
    mutationFn: () => api('/api/family/invites', { json: { email, role, ...(relation ? { relation } : {}) } }),
    onSuccess: () => {
      setEmail('')
      setRelation('')
      refresh()
    },
  })
  const changeRole = useMutation({
    mutationFn: (v: { id: string; role: Role }) => api(`/api/family/members/${v.id}`, { method: 'PATCH', json: { role: v.role } }),
    onSuccess: refresh,
  })
  const changeRelation = useMutation({
    mutationFn: (v: { id: string; relation: Relation | null }) => api(`/api/family/members/${v.id}`, { method: 'PATCH', json: { relation: v.relation } }),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/family/members/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setConfirming(null)
      refresh()
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    invite.mutate()
  }

  return (
    <>
      <Card className="p-0">
        <ul className="divide-y divide-line">
        {(members.data ?? []).map((m, i) => (
          <li key={m.email} className="space-y-3 p-4">
            <div className="flex items-start gap-3">
              <Avatar name={m.pending ? '' : m.name || m.email} index={i} size={40} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold break-words">{m.pending ? t('members.pending') : m.name || m.email}</p>
                <p className="text-sm text-muted break-all">{m.email}</p>
                {m.relation && <p className="text-sm font-medium text-primary">{t(`relations.${m.relation}`)}</p>}
              </div>
              {!(isAdmin && !m.pending && m.user_id) && (
                <Badge tone={m.role === 'admin' ? 'med' : m.role === 'caregiver' ? 'diaper' : 'plain'}>{t(`roles.${m.role}`)}</Badge>
              )}
            </div>
            {isAdmin && !m.pending && m.user_id && (
              <div data-testid="member-actions" className="flex flex-wrap items-center justify-between gap-2 pl-[52px]">
                <Select
                  className="w-auto min-w-36"
                  aria-label={t('members.relationFor', { email: m.email })}
                  value={m.relation ?? ''}
                  onChange={(e) => changeRelation.mutate({ id: m.user_id!, relation: (e.target.value || null) as Relation | null })}
                >
                  <option value="">{t('members.noRelation')}</option>
                  {RELATIONS.map((r) => (
                    <option key={r} value={r}>
                      {t(`relations.${r}`)}
                    </option>
                  ))}
                </Select>
                <Select
                  className="w-auto min-w-36"
                  aria-label={t('members.roleFor', { email: m.email })}
                  value={m.role}
                  onChange={(e) => changeRole.mutate({ id: m.user_id!, role: e.target.value as Role })}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t(`roles.${r}`)}
                    </option>
                  ))}
                </Select>
                {confirming === m.user_id ? (
                  <div className="flex gap-1">
                    <Button variant="danger" onClick={() => remove.mutate(m.user_id!)}>
                      {t('members.confirmRemove')}
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirming(null)}>
                      {t('members.cancel')}
                    </Button>
                  </div>
                ) : (
                  <Button variant="ghost" onClick={() => setConfirming(m.user_id)}>
                    {t('members.remove')}
                  </Button>
                )}
              </div>
            )}
          </li>
        ))}
        </ul>
      </Card>
      {changeRelation.isError && <p className="text-sm text-danger">{t('members.relationRefused')}</p>}
      {isAdmin && (
        <Card>
          <h2 className="mb-3 font-medium">{t('members.inviteTitle')}</h2>
          <form onSubmit={submit} className="space-y-3">
            <label htmlFor="invite-email" className="block text-sm text-muted">
              {t('members.inviteEmail')}
            </label>
            <Input id="invite-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            <label htmlFor="invite-role" className="block text-sm text-muted">
              {t('members.role')}
            </label>
            <Select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`roles.${r}`)}
                </option>
              ))}
            </Select>
            <label htmlFor="invite-relation" className="block text-sm text-muted">
              {t('members.inviteRelation')}
            </label>
            <Select id="invite-relation" value={relation} onChange={(e) => setRelation(e.target.value as Relation | '')}>
              <option value="">{t('members.noRelation')}</option>
              {RELATIONS.map((r) => (
                <option key={r} value={r}>
                  {t(`relations.${r}`)}
                </option>
              ))}
            </Select>
            <Button type="submit" disabled={invite.isPending}>
              {t('members.sendInvite')}
            </Button>
            {invite.isError && <p className="text-sm text-danger">{t('members.relationRefused')}</p>}
          </form>
        </Card>
      )}
    </>
  )
}
