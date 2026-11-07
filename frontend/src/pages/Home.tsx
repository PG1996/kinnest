import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { useMe, useMedicines, useSummary, type DiaperKind } from '../api/hooks'
import DiaperSheet from '../components/DiaperSheet'
import FeedSheet from '../components/FeedSheet'
import PushPrompt from '../components/PushPrompt'
import LastDiaperCard from '../components/LastDiaperCard'
import LastFeedCard from '../components/LastFeedCard'
import MedicinesToday from '../components/MedicinesToday'
import SleepCard from '../components/SleepCard'
import Toast, { type ToastData } from '../components/Toast'
import Today from '../components/Today'
import { Button } from '../components/ui/button'
import { useLogDiaper, useLogFeed, useUndoDiaper, type FeedInput } from '../hooks/log'
import { formatClock } from '../lib/time'
import { useNow } from '../lib/useNow'
import { mergePending, useQueue } from '../offline/pending'
import { clearRejected, remove } from '../offline/queue'
import { Card } from '../components/ui/card'

export default function Home() {
  const { t } = useTranslation()
  const me = useMe().data
  const canLog = me ? me.role !== 'viewer' : false
  const serverSummary = useSummary().data
  const { pending, rejected } = useQueue()
  const medicines = useMedicines().data ?? []
  const medsRef = useRef<HTMLDivElement>(null)
  const [scrollToMeds, setScrollToMeds] = useState(false)
  const summary = serverSummary && mergePending(serverSummary, pending, me?.user.name ?? '')
  const now = useNow()
  const [sheet, setSheet] = useState<'feed' | 'diaper' | null>(null)
  const [toast, setToast] = useState<ToastData | null>(null)
  const [params, setParams] = useSearchParams()
  useEffect(() => {
    // a tapped notification opens the app at /?log=feed or /?log=diaper
    const want = params.get('log')
    if (want === 'medicine') {
      setScrollToMeds(true)
      setParams({}, { replace: true })
    } else if (canLog && (want === 'feed' || want === 'diaper')) {
      setSheet(want)
      setParams({}, { replace: true })
    }
  }, [canLog, params, setParams])
  const closeToast = useCallback(() => setToast(null), [])
  const logFeed = useLogFeed()
  const logDiaper = useLogDiaper()
  const undoDiaper = useUndoDiaper()

  useEffect(() => {
    if (scrollToMeds && medsRef.current) {
      medsRef.current.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
      setScrollToMeds(false)
    }
  }, [scrollToMeds, medicines.length])

  const saveFeed = (body: FeedInput) =>
    logFeed.mutate(body, {
      onSuccess: (r) => {
        setSheet(null)
        setToast({
          message: r.queued
            ? t('home.queued')
            : r.recent_other
              ? t('home.alsoLogged', { name: r.recent_other.user_name, time: formatClock(r.recent_other.at) })
              : t('home.logged'),
        })
      },
    })

  const pickDiaper = (kind: DiaperKind) => {
    const id = crypto.randomUUID()
    setSheet(null)
    logDiaper.mutate(
      { id, kind, at: new Date().toISOString() },
      {
        onError: () => setToast({ message: t('home.saveError') }),
        onSuccess: (r) =>
          setToast({
            message: r.queued
              ? t('home.queued')
              : r.recent_other
                ? t('home.alsoLogged', { name: r.recent_other.user_name, time: formatClock(r.recent_other.at) })
                : t('home.logged'),
            action: {
              label: t('home.undo'),
              run: () => (r.queued ? remove(id).then(closeToast) : undoDiaper.mutate(id, { onSettled: closeToast })),
            },
          }),
      },
    )
  }

  return (
    <>
      {canLog && <PushPrompt />}
      {pending.length > 0 && <Card className="text-sm">{t('offline.pending', { count: pending.length })}</Card>}
      {rejected.length > 0 && (
        <Card className="flex items-center justify-between gap-3 text-sm text-danger">
          <span>{t('offline.rejected', { count: rejected.length })}</span>
          <Button variant="ghost" onClick={() => clearRejected()}>
            {t('offline.dismiss')}
          </Button>
        </Card>
      )}
      {summary && (
        <>
          <LastFeedCard summary={summary} now={now} />
          <LastDiaperCard summary={summary} now={now} />
          <SleepCard sleep={summary.sleep} now={now} canLog={canLog} onToast={setToast} />
          <Today summary={summary} />
          {medicines.length > 0 && (
            <div ref={medsRef} className="space-y-4">
              <MedicinesToday
                medicines={medicines}
                pending={pending}
                canLog={canLog}
                myName={me?.user.name ?? ''}
                now={now}
                onToast={setToast}
              />
            </div>
          )}
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
