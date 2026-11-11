import { useTranslation } from 'react-i18next'
import { Switch } from './ui/switch'

/** "Woke up": also end the running sleep when this diaper is saved. Off unless turned on. */
export default function WokeUp({ checked, onChange }: { checked: boolean; onChange: (on: boolean) => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-between gap-3 rounded-card bg-sleep-bg px-4 py-3">
      <div>
        <p className="font-semibold text-ink">{t('diapers.wokeUp')}</p>
        <p className="text-sm text-muted">{t('diapers.wokeUpHint')}</p>
      </div>
      <Switch checked={checked} onChange={() => onChange(!checked)} label={t('diapers.wokeUp')} />
    </div>
  )
}
