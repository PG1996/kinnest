import type { ReactNode } from 'react'

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-line px-6 py-8 text-center">
      <div className="text-muted" aria-hidden="true">
        {icon}
      </div>
      <p className="text-base font-bold">{title}</p>
      {body && <p className="text-sm text-muted">{body}</p>}
      {action}
    </div>
  )
}
