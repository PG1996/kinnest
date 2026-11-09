import { useMutation } from '@tanstack/react-query'
import { Baby } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api/client'
import { Button, linkButtonClass } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/field'

export default function Login() {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const send = useMutation({
    mutationFn: () => api('/api/auth/magic/request', { json: { email } }),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    send.mutate()
  }
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4">
      <div aria-hidden="true" className="mx-auto flex size-16 items-center justify-center rounded-full bg-feed-bg text-feed">
        <Baby size={34} />
      </div>
      <h1 className="text-center text-xl font-bold">{t('login.title')}</h1>
      <p className="text-center text-muted">{t('app.tagline')}</p>
      <Card className="space-y-4 shadow-[0_12px_32px_-16px_rgba(85,70,184,0.35)]">
        <a href="/api/auth/google/start" className={linkButtonClass('primary', 'lg') + ' w-full'}>
          {t('login.google')}
        </a>
        <p className="text-center text-sm text-muted">{t('login.or')}</p>
        <form onSubmit={submit} className="space-y-3">
          <label htmlFor="login-email" className="block text-sm text-muted">
            {t('login.email')}
          </label>
          <Input id="login-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" variant="soft" className="w-full" disabled={send.isPending}>
            {t('login.sendLink')}
          </Button>
          {send.isSuccess && <p className="text-sm text-ink">{t('login.sent')}</p>}
          {send.isError && <p className="text-sm text-danger">{t('common.error')}</p>}
        </form>
      </Card>
      <p className="text-center text-xs text-muted">{t('login.note')}</p>
    </div>
  )
}
