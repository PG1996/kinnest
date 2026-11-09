import { Check, CircleAlert } from 'lucide-react'
import { useEffect } from 'react'
import { Button } from './ui/button'

export type ToastData = { message: string; tone?: 'success' | 'error'; action?: { label: string; run: () => void } }

export default function Toast({ toast, onClose, ms = 5000 }: { toast: ToastData; onClose: () => void; ms?: number }) {
  useEffect(() => {
    const id = setTimeout(onClose, ms)
    return () => clearTimeout(id)
  }, [toast, onClose, ms])
  const error = toast.tone === 'error'
  return (
    <div
      role="status"
      data-tone={error ? 'error' : 'success'}
      className={`fixed inset-x-4 bottom-24 z-40 mx-auto flex max-w-md items-center gap-3 rounded-2xl py-1.5 pr-2 pl-4 shadow-xl ${error ? 'bg-danger text-primary-ink' : 'bg-ink text-app'}`}
    >
      {error ? <CircleAlert size={20} aria-hidden="true" className="shrink-0" /> : <Check size={20} aria-hidden="true" className="shrink-0 text-diaper" />}
      <span className="flex-1 font-bold">{toast.message}</span>
      {toast.action && (
        <Button variant="ghost" className="min-h-11 rounded-xl bg-white/15 px-4 text-app hover:bg-white/25" onClick={toast.action.run}>
          {toast.action.label}
        </Button>
      )}
    </div>
  )
}
