import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import { Segmented } from '../components/ui/segmented'
import MedicinesPage from './Medicines'
import VaccinesTab from './VaccinesTab'
import VisitsTab from './VisitsTab'
import VitalsTab from './VitalsTab'

export type HealthTab = 'vitals' | 'vaccines' | 'visits' | 'medicines'
const TABS: HealthTab[] = ['vitals', 'vaccines', 'visits', 'medicines']

const DEFAULT_PANELS: Record<HealthTab, React.ReactNode> = {
  vitals: <VitalsTab />,
  vaccines: <VaccinesTab />,
  visits: <VisitsTab />,
  medicines: <MedicinesPage />,
}

/** Vitals, vaccines, doctor visits and medicines as sub-tabs; the tab lives in the URL (?tab=) so links and notifications open it. */
export default function Health({ panels = {} }: { panels?: Partial<Record<HealthTab, React.ReactNode>> }) {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const wanted = params.get('tab') as HealthTab | null
  const tab: HealthTab = wanted && TABS.includes(wanted) ? wanted : 'vitals'
  return (
    <>
      <PageHeader title={t('health.title')} />
      <Segmented
        kind="tab"
        label={t('health.tablist')}
        value={tab}
        options={TABS.map((k) => ({ value: k, label: t(`health.tabs.${k}`) }))}
        onChange={(k) => setParams({ tab: k })}
      />
      <div role="tabpanel" className="space-y-4">
        {panels[tab] ?? DEFAULT_PANELS[tab]}
      </div>
    </>
  )
}
