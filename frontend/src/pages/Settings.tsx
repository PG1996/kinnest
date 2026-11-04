import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api/client'
import { useMe } from '../api/hooks'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/field'
import PushPrompt from '../components/PushPrompt'

type Prefs = { feed: boolean; diaper: boolean }

type Kid = {
  id: string
  name: string
  birth_date: string | null
  feed_interval_minutes: number
  diaper_alert_minutes: number
}

export default function Settings() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const isAdmin = useMe().data?.role === 'admin'
  const kid = useQuery({ queryKey: ['kid'], queryFn: () => api<Kid>('/api/kid') })
  const [form, setForm] = useState({ name: '', birth_date: '', feed: '180', diaper: '240' })
  useEffect(() => {
    if (kid.data)
      setForm({
        name: kid.data.name,
        birth_date: kid.data.birth_date ?? '',
        feed: String(kid.data.feed_interval_minutes),
        diaper: String(kid.data.diaper_alert_minutes),
      })
  }, [kid.data])

  const prefs = useQuery({ queryKey: ['prefs'], queryFn: () => api<Prefs>('/api/notification-prefs') })
  const savePrefs = useMutation({
    mutationFn: (next: Prefs) => api<Prefs>('/api/notification-prefs', { method: 'PUT', json: next }),
    onSuccess: (data) => qc.setQueryData(['prefs'], data),
  })
  const toggle = (k: keyof Prefs) => prefs.data && savePrefs.mutate({ ...prefs.data, [k]: !prefs.data[k] })

  const save = useMutation({
    mutationFn: () =>
      api<Kid>('/api/kid', {
        method: 'PATCH',
        json: {
          name: form.name,
          birth_date: form.birth_date || null,
          feed_interval_minutes: Number(form.feed),
          diaper_alert_minutes: Number(form.diaper),
        },
      }),
    onSuccess: (data) => {
      qc.setQueryData(['kid'], data)
      qc.invalidateQueries({ queryKey: ['summary'] })
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })
  const field = (id: string, label: string, k: keyof typeof form, type = 'text') => (
    <>
      <label htmlFor={id} className="block text-sm text-muted">
        {label}
      </label>
      <Input id={id} type={type} value={form[k]} onChange={set(k)} disabled={!isAdmin} />
    </>
  )

  return (
    <>
      <h1 className="text-xl font-semibold">{t('settings.title')}</h1>
      <Card>
        <form onSubmit={submit} className="space-y-3">
          {field('kid-name', t('settings.kidName'), 'name')}
          {field('kid-birth', t('settings.birthDate'), 'birth_date', 'date')}
          {field('kid-feed', t('settings.feedInterval'), 'feed', 'number')}
          {field('kid-diaper', t('settings.diaperAlert'), 'diaper', 'number')}
          {isAdmin ? (
            <Button type="submit" disabled={save.isPending}>
              {t('settings.save')}
            </Button>
          ) : (
            <p className="text-sm text-muted">{t('settings.adminOnly')}</p>
          )}
          {save.isSuccess && <p className="text-sm">{t('settings.saved')}</p>}
          {save.isError && <p className="text-sm text-danger">{t('common.error')}</p>}
        </form>
      </Card>
      <h2 className="font-medium">{t('settings.notifications')}</h2>
      <PushPrompt alwaysShow />
      <Card className="space-y-2">
        {(['feed', 'diaper'] as const).map((k) => (
          <label key={k} className="flex min-h-12 items-center justify-between gap-3">
            <span>{t(k === 'feed' ? 'settings.feedReminders' : 'settings.diaperAlerts')}</span>
            <input
              type="checkbox"
              className="size-6 accent-primary"
              checked={prefs.data?.[k] ?? true}
              disabled={!prefs.data}
              onChange={() => toggle(k)}
            />
          </label>
        ))}
      </Card>
    </>
  )
}
