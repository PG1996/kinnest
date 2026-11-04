import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMe, useSummary, type DiaperKind } from '../api/hooks'
import DiaperSheet from '../components/DiaperSheet'
import FeedSheet from '../components/FeedSheet'
import LastDiaperCard from '../components/LastDiaperCard'
import LastFeedCard from '../components/LastFeedCard'
import Toast, { type ToastData } from '../components/Toast'
import Today from '../components/Today'
import { Button } from '../components/ui/button'
import { useLogDiaper, useLogFeed, useUndoDiaper, type FeedInput } from '../hooks/log'
import { useNow } from '../lib/useNow'

export default function Home() {
  const { t } = useTranslation()
  const canLog = useMe().data?.role !== 'viewer'
  const summary = useSummary().data
  const now = useNow()
  const [sheet, setSheet] = useState<'feed' | 'diaper' | null>(null)
  const [toast, setToast] = useState<ToastData | null>(null)
  const closeToast = useCallback(() => setToast(null), [])
  const logFeed = useLogFeed()
  const logDiaper = useLogDiaper()
  const undoDiaper = useUndoDiaper()

  const saveFeed = (body: FeedInput) =>
    logFeed.mutate(body, {
      onSuccess: (r) => {
        setSheet(null)
        setToast({ message: r.recent_other ? t('home.alsoLogged', { name: r.recent_other.user_name }) : t('home.logged') })
      },
    })

  const pickDiaper = (kind: DiaperKind) => {
    const id = crypto.randomUUID()
    setSheet(null)
    logDiaper.mutate(
      { id, kind, at: new Date().toISOString() },
      {
        onSuccess: (r) =>
          setToast({
            message: r.recent_other ? t('home.alsoLogged', { name: r.recent_other.user_name }) : t('home.logged'),
            action: { label: t('home.undo'), run: () => undoDiaper.mutate(id, { onSettled: closeToast }) },
          }),
      },
    )
  }

  return (
    <>
      {summary && (
        <>
          <LastFeedCard summary={summary} now={now} />
          <LastDiaperCard summary={summary} now={now} />
          <Today summary={summary} />
        </>
      )}
      {canLog && (
        <div className="sticky bottom-20 grid grid-cols-2 gap-3">
          <Button className="min-h-16 text-lg" onClick={() => setSheet('feed')}>
            {t('home.feed')}
          </Button>
          <Button variant="soft" className="min-h-16 text-lg" onClick={() => setSheet('diaper')}>
            {t('home.diaper')}
          </Button>
        </div>
      )}
      {sheet === 'feed' && (
        <FeedSheet
          last={summary?.last_feed ?? null}
          saving={logFeed.isPending}
          failed={logFeed.isError}
          onSave={saveFeed}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'diaper' && <DiaperSheet onPick={pickDiaper} onClose={() => setSheet(null)} />}
      {toast && <Toast toast={toast} onClose={closeToast} />}
    </>
  )
}
