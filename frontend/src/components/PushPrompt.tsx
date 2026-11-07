import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { disablePush, enablePush, getPushState, type PushState } from '../push/subscribe'
import { Button } from './ui/button'
import { Card } from './ui/card'

/** Turns phone reminders on/off. On Home it hides once on; in Settings (`alwaysShow`) it stays as a control. */
export default function PushPrompt({ alwaysShow = false }: { alwaysShow?: boolean }) {
  const { t } = useTranslation()
  const [state, setState] = useState<PushState | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    getPushState().then((s) => alive && setState(s)).catch(() => alive && setState('unsupported'))
    return () => {
      alive = false
    }
  }, [])

  const run = async (action: () => Promise<PushState>) => {
    setBusy(true)
    setFailed(false)
    try {
      setState(await action())
    } catch (e) {
      console.error('enablePush failed', e) // the browser's reason (e.g. AbortError: push service error) is the only clue
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  if (state === null || (state === 'unsupported' && !alwaysShow) || (state === 'subscribed' && !alwaysShow)) return null
  return (
    <Card className="space-y-3">
      {alwaysShow && <p className="font-medium">{t('push.title')}</p>}
      {state === 'default' && (
        <Button className="w-full" disabled={busy} onClick={() => run(enablePush)}>
          {t('push.enable')}
        </Button>
      )}
      {state === 'subscribed' && (
        <div className="flex items-center justify-between gap-3">
          <p>{t('push.on')}</p>
          <Button variant="ghost" disabled={busy} onClick={() => run(disablePush)}>
            {t('push.off')}
          </Button>
        </div>
      )}
      {state === 'denied' && <p className="text-sm text-muted">{t('push.denied')}</p>}
      {state === 'ios-install' && <p className="text-sm text-muted">{t('push.iosInstall')}</p>}
      {state === 'unsupported' && <p className="text-sm text-muted">{t('push.unsupported')}</p>}
      {failed && <p className="text-sm text-danger">{t('push.error')}</p>}
    </Card>
  )
}
