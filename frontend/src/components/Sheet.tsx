import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from './ui/button'

export default function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="fixed inset-0 z-10 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90dvh] w-full max-w-xl space-y-4 overflow-y-auto rounded-t-3xl bg-surface p-5"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <Button variant="ghost" onClick={onClose}>
            {t('home.close')}
          </Button>
        </div>
        {children}
      </div>
    </div>
  )
}
