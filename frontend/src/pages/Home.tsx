import { useTranslation } from 'react-i18next'
import { Card } from '../components/ui/card'

export default function Home() {
  const { t } = useTranslation()
  return (
    <>
      <h1 className="text-xl font-semibold">{t('home.title')}</h1>
      <Card>{t('home.soon')}</Card>
    </>
  )
}
