import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { useMe, type Relation } from '../api/hooks'
import { Button } from './ui/button'

/** Every baby profile needs a mom or a dad: until one is set, the admin is asked who they are. */
export default function ParentSetup() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const me = useMe().data
  const save = useMutation({
    mutationFn: (relation: Relation) => api(`/api/family/members/${me!.user.id}`, { method: 'PATCH', json: { relation } }),
    onSuccess: () => qc.invalidateQueries(),
  })
  if (!me || me.role !== 'admin' || !me.needs_parent) return null
  return (
    <div role="dialog" aria-modal="true" aria-label={t('setup.title')} className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-5">
      <div className="w-full max-w-sm space-y-4 rounded-3xl bg-surface p-6">
        <h2 className="text-lg font-bold">{t('setup.title')}</h2>
        <p className="text-sm text-muted">{t('setup.hint')}</p>
        <div className="grid grid-cols-2 gap-3">
          <Button size="lg" disabled={save.isPending} onClick={() => save.mutate('mom')}>
            {t('relations.mom')}
          </Button>
          <Button size="lg" disabled={save.isPending} onClick={() => save.mutate('dad')}>
            {t('relations.dad')}
          </Button>
        </div>
        {save.isError && <p className="text-sm text-danger">{t('setup.saveError')}</p>}
        <Link to="/family" className="block text-center text-sm text-primary underline">
          {t('setup.other')}
        </Link>
      </div>
    </div>
  )
}
