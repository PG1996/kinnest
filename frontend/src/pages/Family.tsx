import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import { Segmented } from '../components/ui/segmented'
import Members from './Members'
import Settings from './Settings'

export type FamilyTab = 'members' | 'settings'
const TABS: FamilyTab[] = ['members', 'settings']

/** Members and settings as two tabs; the tab lives in the URL (?tab=) so old links can redirect here. */
export default function Family() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const wanted = params.get('tab') as FamilyTab | null
  const tab: FamilyTab = wanted && TABS.includes(wanted) ? wanted : 'members'
  return (
    <>
      <PageHeader title={t('family.title')} />
      <Segmented
        kind="tab"
        label={t('family.tablist')}
        value={tab}
        options={TABS.map((k) => ({ value: k, label: t(`family.tabs.${k}`) }))}
        onChange={(k) => setParams({ tab: k })}
      />
      <div role="tabpanel" className="space-y-4">
        {tab === 'members' ? <Members /> : <Settings />}
      </div>
    </>
  )
}
