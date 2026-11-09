import { useTranslation } from 'react-i18next'
import { useMembers, type FeedType } from '../api/hooks'
import PersonPicker from './PersonPicker'

export const isBreast = (type: FeedType) => type.startsWith('breast')

/** Who fed: always mom for breast milk, otherwise any admin or caregiver (default: me). */
export default function FedBy({ type, value, onChange }: { type: FeedType; value: string | null; onChange: (userId: string) => void }) {
  const { t } = useTranslation()
  const rows = useMembers().data
  const people = (Array.isArray(rows) ? rows : []).filter((m) => !m.pending && m.user_id && m.role !== 'viewer')
  const mom = people.find((m) => m.relation === 'mom')
  if (isBreast(type) && mom) return <p className="text-sm font-medium">{t('feed.fedByMom', { name: mom.name || mom.email })}</p>
  return <PersonPicker label={t('home.fedBy')} value={value} onChange={onChange} />
}
