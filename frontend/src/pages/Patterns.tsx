import { LayoutGrid } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import PageHeader from '../components/PageHeader'
import { EmptyState } from '../components/ui/empty'

export default function Patterns() {
  const { t } = useTranslation()
  return (
    <>
      <PageHeader title={t('patterns.title')} />
      <EmptyState icon={<LayoutGrid size={32} />} title={t('patterns.soon')} />
    </>
  )
}
