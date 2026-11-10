import { ChevronLeft } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, IconButton } from './ui/button'
import type { Tone } from './ui/card'

// open sheets, newest last: Escape closes only the one on top (a picker over a form)
const openSheets: symbol[] = []

/**
 * A bottom sheet (`sheet`) or a full-screen page (`full`). Focus moves to the title on open, Escape
 * closes, and focus returns to whatever opened it.
 */
export default function Sheet({
  title,
  onClose,
  children,
  variant = 'sheet',
  footer,
  tone = 'plain',
}: {
  title: string
  onClose: () => void
  children: ReactNode
  variant?: 'sheet' | 'full'
  footer?: ReactNode
  /** the colour of the card this was opened from (feed, diaper, sleep, med); marked on the sheet, which itself stays plain */
  tone?: Tone
}) {
  const { t } = useTranslation()
  const titleRef = useRef<HTMLHeadingElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const me = Symbol('sheet')
    openSheets.push(me)
    titleRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openSheets.at(-1) === me) closeRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      openSheets.splice(openSheets.indexOf(me), 1)
      document.removeEventListener('keydown', onKey)
      opener?.focus?.()
    }
  }, [])

  if (variant === 'full') {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-sheet-tone={tone === 'plain' ? undefined : tone}
        className="fixed inset-0 z-30 flex flex-col bg-app"
      >
        <div className="mx-auto flex w-full max-w-xl items-center gap-2 px-3 pt-4 pb-2">
          <IconButton label={t('home.close')} onClick={onClose} className="bg-transparent shadow-none">
            <ChevronLeft size={24} />
          </IconButton>
          <h2 ref={titleRef} tabIndex={-1} className="text-base font-bold outline-none">
            {title}
          </h2>
        </div>
        <div className="mx-auto w-full max-w-xl flex-1 space-y-5 overflow-y-auto px-5 pb-6 pt-2">{children}</div>
        {footer && <div className="mx-auto w-full max-w-xl border-t border-line bg-surface px-5 pb-7 pt-3">{footer}</div>}
      </div>
    )
  }
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-sheet-tone={tone === 'plain' ? undefined : tone}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90dvh] w-full max-w-xl space-y-4 overflow-y-auto rounded-t-3xl bg-surface p-5 pb-8"
      >
        <div aria-hidden="true" className="mx-auto h-1.5 w-10 rounded-full bg-line" />
        <div className="flex items-center justify-between">
          <h2 ref={titleRef} tabIndex={-1} className="text-base font-bold outline-none">
            {title}
          </h2>
          <Button variant="ghost" onClick={onClose}>
            {t('home.close')}
          </Button>
        </div>
        {children}
        {footer}
      </div>
    </div>
  )
}
