import { History } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import PageHeader from '../components/PageHeader'
import { EmptyState } from '../components/ui/empty'

export default function Timeline() {
  const { t } = useTranslation()
  return (
    <>
      <PageHeader title={t('timeline.title')} />
      <EmptyState icon={<History size={32} />} title={t('timeline.soon')} />
    </>
  )
}
