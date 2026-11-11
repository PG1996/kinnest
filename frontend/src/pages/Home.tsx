import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useKid, useMe, useMedicines, useSummary, useTimeline, useVaccines, useVisits, type DiaperKind, type FeedType } from '../api/hooks'
import DiaperSheet from '../components/DiaperSheet'
import FeedSheet from '../components/FeedSheet'
import FeedSidePicker from '../components/FeedSidePicker'
import FeedTimerBanner from '../components/FeedTimerBanner'
import HomeHeader from '../components/HomeHeader'
import PushPrompt from '../components/PushPrompt'
import QuickLog from '../components/QuickLog'
import SleepConfirm from '../components/SleepConfirm'
import LastDiaperCard from '../components/LastDiaperCard'
import LastFeedCard from '../components/LastFeedCard'
import LatestVitalsCard from '../components/LatestVitalsCard'
import MedicinesToday from '../components/MedicinesToday'
import SleepCard from '../components/SleepCard'
import Toast, { type ToastData } from '../components/Toast'
import UpcomingCard from '../components/UpcomingCard'
import Today from '../components/Today'
import { Button } from '../components/ui/button'
import { useFeedTimerActions, useLogDiaper, useLogFeed, useUndoDiaper, useUpdateSleep, type FeedInput } from '../hooks/log'
import { useSleepActions } from '../hooks/sleepActions'
import { lastDays, wetPerDay } from '../lib/timeline'
import { formatClock, toLocalDate } from '../lib/time'
import { useDismissStaleNotifications } from '../lib/staleNotifications'
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
  const [focusMed, setFocusMed] = useState<string | null>(null)
  const summary = serverSummary && mergePending(serverSummary, pending, me?.user.name ?? '')
  const now = useNow()
  const kid = useKid().data
  useDismissStaleNotifications({ summary, kid, medicines, now })
  const today = toLocalDate(new Date(now))
  // the seven local days ending today; stable for the whole day so the query key does not change every tick
  const week = useMemo(() => {
    const days = lastDays(7, new Date(`${today}T12:00:00`))
    const last = days[6]!
    return { days, from: days[0]!, to: new Date(last.getFullYear(), last.getMonth(), last.getDate(), 23, 59, 59, 999) }
  }, [today])
  const diapersWeek = useTimeline({ from: week.from, to: week.to, kinds: ['diaper'] }).data
  const wetSeries = diapersWeek ? wetPerDay(diapersWeek, week.days) : undefined
  const [sheet, setSheet] = useState<'feed' | 'diaper' | null>(null)
  const [toast, setToast] = useState<ToastData | null>(null)
  const sleepActions = useSleepActions(summary?.sleep, setToast)
  const [sleepAsk, setSleepAsk] = useState(false)
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  // never let a side card take Home down: anything but a list (an old server, an odd reply) shows nothing
  const vaccinesData = useVaccines().data
  const visitsData = useVisits().data
  const vaccines = Array.isArray(vaccinesData) ? vaccinesData : []
  const visits = Array.isArray(visitsData) ? visitsData : []
  useEffect(() => {
    // a tapped notification opens the app at /?log=feed or /?log=diaper
    const want = params.get('log')
    if (want === 'vaccine' || want === 'visit') {
      navigate(`/health?tab=${want === 'vaccine' ? 'vaccines' : 'visits'}`, { replace: true })
    } else if (want === 'medicine') {
      setScrollToMeds(true)
      setFocusMed(params.get('med'))
      setParams({}, { replace: true })
    } else if (canLog && (want === 'feed' || want === 'diaper')) {
      setSheet(want)
      if (want === 'feed' && params.get('timer') === 'stop') setStopWanted(true)
      setParams({}, { replace: true })
    }
  }, [canLog, navigate, params, setParams])
  const closeToast = useCallback(() => setToast(null), [])
  const logFeed = useLogFeed()
  const timerActions = useFeedTimerActions()
  /** The play icon on the feed card asks which side first, then starts the timer with it. */
  const [sideAsk, setSideAsk] = useState(false)
  const startTimer = (type: FeedType) => {
    setSideAsk(false)
    timerActions.start.mutate(
      { id: crypto.randomUUID(), type, started_at: new Date().toISOString() },
      { onError: () => setToast({ message: t('home.timerFailed'), tone: 'error' }) },
    )
  }
  // a tapped "Stop" on the notification: stop the timer once the summary is here, then the form asks about breaks
  const [stopWanted, setStopWanted] = useState(false)
  useEffect(() => {
    if (!stopWanted || !serverSummary) return
    setStopWanted(false)
    const timer = serverSummary.feed_timer
    if (timer && !timer.ended_at) timerActions.change.mutate({ ended_at: new Date().toISOString() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopWanted, serverSummary])
  const logDiaper = useLogDiaper()
  const undoDiaper = useUndoDiaper()
  const reopenSleep = useUpdateSleep()

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

  const pickDiaper = (kind: DiaperKind, changedBy?: string, woke = false) => {
    const id = crypto.randomUUID()
    const at = new Date().toISOString()
    setSheet(null)
    logDiaper.mutate(
      { id, kind, at, ...(changedBy ? { changed_by_user_id: changedBy } : {}) },
      {
        onError: () => setToast({ message: t('home.saveError'), tone: 'error' }),
        onSuccess: (r) => {
          // the baby woke for this change: end the sleep at the same minute, only once the diaper is saved
          const wake = woke ? sleepActions.wake(at) : Promise.resolve(null)
          // undo takes the wake back too: the sleep runs on as if nothing happened
          const unwake = () =>
            wake
              .then((w) => w && (w.queued ? remove(`${w.id}:end`) : reopenSleep.mutateAsync({ id: w.id, ended_at: null })))
              .catch(() => {})
          setToast({
            message: r.queued
              ? t('home.queued')
              : r.recent_other
                ? t('home.alsoLogged', { name: r.recent_other.user_name, time: formatClock(r.recent_other.at) })
                : t('home.logged'),
            action: {
              label: t('home.undo'),
              run: () => {
                void unwake()
                return r.queued ? remove(id).then(closeToast) : undoDiaper.mutate(id, { onSettled: closeToast })
              },
            },
          })
        },
      },
    )
  }

  return (
    <>
      <HomeHeader now={now} />
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
          {summary.feed_timer && canLog && <FeedTimerBanner timer={summary.feed_timer} onOpen={() => setSheet('feed')} />}
          <LastFeedCard summary={summary} now={now} canLog={canLog} feeding={!!summary.feed_timer} onLogFeed={() => setSheet('feed')} onStartTimer={() => setSideAsk(true)} />
          <LastDiaperCard summary={summary} now={now} wetPerDay={wetSeries} />
          <SleepCard sleep={summary.sleep} now={now} />
        </>
      )}
      {canLog && (
        <QuickLog
          asleep={sleepActions.open !== null}
          sleepBusy={sleepActions.pending}
          onFeed={() => setSheet('feed')}
          onDiaper={() => setSheet('diaper')}
          onSleep={() => setSleepAsk(true)}
          onMedicine={() =>
            medicines.length > 0 ? medsRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }) : navigate('/health?tab=medicines')
          }
        />
      )}
      {summary && (
        <>
          <Today summary={summary} />
          <UpcomingCard vaccines={vaccines} visits={visits} now={now} />
          {summary.vitals && <LatestVitalsCard latest={summary.vitals.latest} previous={summary.vitals.previous} canLog={canLog} now={now} />}
          {medicines.length > 0 && (
            <div ref={medsRef} className="space-y-4">
              <MedicinesToday
                focusId={focusMed}
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
      {sheet === 'feed' && (
        <FeedSheet
          last={summary?.last_feed ?? null}
          saving={logFeed.isPending}
          failed={logFeed.isError}
          onSave={saveFeed}
          onClose={() => setSheet(null)}
        />
      )}
      {sleepAsk && (
        <SleepConfirm
          open={sleepActions.open}
          now={now}
          onCancel={() => setSleepAsk(false)}
          onConfirm={() => {
            setSleepAsk(false)
            sleepActions.toggle()
          }}
        />
      )}
      {sideAsk && <FeedSidePicker last={summary?.last_feed?.type ?? null} onPick={startTimer} onClose={() => setSideAsk(false)} />}
      {sheet === 'diaper' && <DiaperSheet asleep={sleepActions.open !== null} onPick={pickDiaper} onClose={() => setSheet(null)} />}
      {toast && <Toast toast={toast} onClose={closeToast} />}
    </>
  )
}
