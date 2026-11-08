import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { cn } from '../lib/cn'
import VitalsTab from './VitalsTab'

export type HealthTab = 'vitals' | 'vaccines' | 'visits'
const TABS: HealthTab[] = ['vitals', 'vaccines', 'visits']

/** Vitals, vaccines and doctor visits as sub-tabs; the tab lives in the URL (?tab=) so links and notifications open it. */
export default function Health({ panels = {} }: { panels?: Partial<Record<HealthTab, React.ReactNode>> }) {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const wanted = params.get('tab') as HealthTab | null
  const tab: HealthTab = wanted && TABS.includes(wanted) ? wanted : 'vitals'
  return (
    <>
      <h1 className="text-xl font-semibold">{t('health.title')}</h1>
      <div role="tablist" className="flex gap-2">
        {TABS.map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setParams({ tab: k })}
            className={cn(
              'min-h-12 flex-1 rounded-full px-3 text-sm font-medium',
              tab === k ? 'bg-primary text-primary-ink' : 'bg-line/40 text-ink',
            )}
          >
            {t(`health.tabs.${k}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel">{panels[tab] ?? (tab === 'vitals' ? <VitalsTab /> : null)}</div>
    </>
  )
}
