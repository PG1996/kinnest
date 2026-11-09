import { useMe, useMembers } from '../api/hooks'
import { Chip, ChipGroup } from './ui/chip'

/** Who did it: any admin or caregiver, never a viewer; the person logging it unless another is picked. Hidden when there is no choice. */
export default function PersonPicker({ label, value, onChange }: { label: string; value: string | null; onChange: (userId: string) => void }) {
  const me = useMe().data
  const rows = useMembers().data
  const people = (Array.isArray(rows) ? rows : []).filter((m) => !m.pending && m.user_id && m.role !== 'viewer')
  if (people.length < 2) return null
  const current = value ?? me?.user.id ?? null
  return (
    <ChipGroup label={label}>
      {people.map((m) => (
        <Chip key={m.user_id} pressed={current === m.user_id} onClick={() => onChange(m.user_id!)}>
          {m.name || m.email}
        </Chip>
      ))}
    </ChipGroup>
  )
}
