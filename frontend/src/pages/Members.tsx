import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api/client'
import { useMe, type Role } from '../api/hooks'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input, Select } from '../components/ui/field'

type Row = { user_id: string | null; email: string; name: string; role: Role; pending: boolean }
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
  const [confirming, setConfirming] = useState<string | null>(null)

  const invite = useMutation({
    mutationFn: () => api('/api/family/invites', { json: { email, role } }),
    onSuccess: () => {
      setEmail('')
      refresh()
    },
  })
  const changeRole = useMutation({
    mutationFn: (v: { id: string; role: Role }) => api(`/api/family/members/${v.id}`, { method: 'PATCH', json: { role: v.role } }),
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
      <h1 className="text-xl font-semibold">{t('members.title')}</h1>
      <Card className="divide-y divide-line p-0">
        {(members.data ?? []).map((m) => (
          <div key={m.email} className="flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{m.email}</p>
              <p className="text-sm text-muted">{m.pending ? t('members.pending') : m.name}</p>
            </div>
            {isAdmin && !m.pending && m.user_id ? (
              <>
                <Select
                  className="w-auto"
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
                  <>
                    <Button variant="danger" onClick={() => remove.mutate(m.user_id!)}>
                      {t('members.confirmRemove')}
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirming(null)}>
                      {t('members.cancel')}
                    </Button>
                  </>
                ) : (
                  <Button variant="ghost" onClick={() => setConfirming(m.user_id)}>
                    {t('members.remove')}
                  </Button>
                )}
              </>
            ) : (
              <span className="text-sm text-muted">{t(`roles.${m.role}`)}</span>
            )}
          </div>
        ))}
      </Card>
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
            <Button type="submit" disabled={invite.isPending}>
              {t('members.sendInvite')}
            </Button>
            {invite.isError && <p className="text-sm text-danger">{t('common.error')}</p>}
          </form>
        </Card>
      )}
    </>
  )
}
