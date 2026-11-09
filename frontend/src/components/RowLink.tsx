import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

/** A list row that opens its entry in the timeline, where entries are fixed or deleted. Plain for viewers. */
export default function RowLink({ to, enabled, label, children }: { to: string; enabled: boolean; label: string; children: ReactNode }) {
  if (!enabled) return <>{children}</>
  return (
    <Link to={to} aria-label={label} className="block rounded-tile">
      {children}
    </Link>
  )
}
