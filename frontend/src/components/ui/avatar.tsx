const TINTS = [
  'bg-feed-bg text-feed-ink',
  'bg-sleep-bg text-sleep-ink',
  'bg-diaper-bg text-diaper-ink',
  'bg-med-bg text-med-ink',
]

export const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('') || '?'

export function Avatar({ name, index = 0, size = 30 }: { name: string; index?: number; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      className={`inline-flex items-center justify-center rounded-full border-2 border-app font-extrabold ${TINTS[index % TINTS.length]}`}
    >
      {initials(name)}
    </span>
  )
}

/** Overlapping circles for the family; the group has one accessible label listing everyone. */
export function AvatarStack({ names, max = 4, label }: { names: string[]; max?: number; label?: string }) {
  const shown = names.slice(0, max)
  return (
    <span role="group" aria-label={label ?? names.join(', ')} className="inline-flex items-center">
      {shown.map((n, i) => (
        <span key={`${n}-${i}`} className={i ? '-ml-2' : ''}>
          <Avatar name={n} index={i} />
        </span>
      ))}
    </span>
  )
}
