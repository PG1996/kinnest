import { useTranslation } from 'react-i18next'
import { cn } from '../lib/cn'
import { useThemeMode, type ThemeMode } from '../lib/theme'

const OPTIONS: ThemeMode[] = ['light', 'dark', 'auto', 'night']

/** Light, Dark, Auto (follow the phone) and Night dim (dark from 22:00 to 06:00). */
export default function ThemeToggle() {
  const { t } = useTranslation()
  const [mode, setMode] = useThemeMode()
  return (
    <div role="radiogroup" aria-label={t('theme.label')} className="flex gap-1 rounded-2xl bg-surface-2 p-1">
      {OPTIONS.map((m) => (
        <button
          key={m}
          role="radio"
          aria-checked={mode === m}
          onClick={() => setMode(m)}
          className={cn(
            'min-h-11 flex-1 rounded-xl px-2 text-sm font-semibold',
            mode === m ? 'bg-surface text-ink shadow-sm' : 'text-muted',
          )}
        >
          {t(`theme.${m}`)}
        </button>
      ))}
    </div>
  )
}
