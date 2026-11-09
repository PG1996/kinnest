import { useTranslation } from 'react-i18next'
import { useMe, useMembers, type FeedType } from '../api/hooks'
import { Chip, ChipGroup } from './ui/chip'

export const isBreast = (type: FeedType) => type.startsWith('breast')

/** Who fed: always mom for breast milk, otherwise any admin or caregiver (default: me). */
export default function FedBy({ type, value, onChange }: { type: FeedType; value: string | null; onChange: (userId: string) => void }) {
  const { t } = useTranslation()
  const me = useMe().data
  const rows = useMembers().data
  const people = (Array.isArray(rows) ? rows : []).filter((m) => !m.pending && m.user_id && m.role !== 'viewer')
  const mom = people.find((m) => m.relation === 'mom')
  if (isBreast(type) && mom) return <p className="text-sm font-medium">{t('feed.fedByMom', { name: mom.name || mom.email })}</p>
  if (people.length < 2) return null
  const current = value ?? me?.user.id ?? null
  return (
    <ChipGroup label={t('home.fedBy')}>
      {people.map((m) => (
        <Chip key={m.user_id} pressed={current === m.user_id} onClick={() => onChange(m.user_id!)}>
          {m.name || m.email}
        </Chip>
      ))}
    </ChipGroup>
  )
}
