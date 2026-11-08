import { useTranslation } from 'react-i18next'
import type { VaccineTemplate } from '../api/hooks'
import { Button } from './ui/button'
import { Card } from './ui/card'

/** The bundled schedules, each with where it was taken from, and a button to use it. */
export default function TemplatePicker({
  templates,
  disabled,
  onPick,
}: {
  templates: VaccineTemplate[]
  disabled?: boolean
  onPick: (id: string) => void
}) {
  const { t } = useTranslation()
  return (
    <ul className="space-y-3">
      {templates.map((tpl) => (
        <li key={tpl.id}>
          <Card className="space-y-2 p-4">
            <h3 className="font-medium">{tpl.name}</h3>
            <p className="text-sm text-muted">{tpl.description}</p>
            <p className="text-sm">{t('vaccines.picker.count', { count: tpl.count })}</p>
            <p className="text-xs text-muted">
              <span>{t('vaccines.picker.source', { date: tpl.source_date })}</span>{' '}
              <a href={tpl.source_url} target="_blank" rel="noreferrer" className="underline">
                {tpl.source_title || tpl.source_url}
              </a>
            </p>
            <Button disabled={disabled} onClick={() => onPick(tpl.id)}>
              {t('vaccines.picker.use')}
            </Button>
          </Card>
        </li>
      ))}
    </ul>
  )
}
