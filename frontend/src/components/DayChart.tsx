import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { markRange, packMoments, tickStep, type Lane, type Mark, type Range } from '../lib/dayChart'
import { describe } from '../lib/timeline'
import { formatHour, formatTime } from '../lib/time'

/**
 * The Timeline's day chart: one lane per kind across the day, the lane's name in the top band of its row and the marks
 * below it. Bars for things with a length, a shape for each moment. Tap a mark to pick its time, tap an empty spot for the
 * whole day, drag (mouse) or hold then drag (touch) to pick a range, and drag the handles to change it. A plain sideways
 * touch drag is left alone, so the page around it can turn the day.
 */

const PAD = 10
const ROW = 62
const BAND = 22 // the lane name's band at the top of each row
const AXIS = 22
const SHAPE = 12
const HOLD_MS = 380
const FALLBACK_W = 340

const LANE_COLOR: Record<Lane, string> = {
  sleep: 'var(--sleep)',
  feed: 'var(--feed)',
  diaper: 'var(--diaper)',
  dose: 'var(--med)',
  vital: 'var(--primary)',
  health: 'var(--primary)',
}
type Shape = 'dot' | 'square' | 'pill' | 'diamond'
const SHAPE_OF: Record<Lane, Shape> = { sleep: 'dot', feed: 'dot', diaper: 'square', dose: 'pill', vital: 'diamond', health: 'diamond' }

/** A small mark for a moment, with a ring in the card's colour so neighbours stay apart. */
export function Glyph({
  shape,
  x,
  y,
  s,
  color,
  hollow = false,
  halo = true,
}: {
  shape: Shape
  x: number
  y: number
  s: number
  color: string
  hollow?: boolean
  halo?: boolean
}) {
  const paint = hollow
    ? { fill: 'var(--surface)', stroke: color, strokeWidth: 1.75 }
    : { fill: color, ...(halo ? { stroke: 'var(--surface)', strokeWidth: 3, paintOrder: 'stroke' as const } : {}) }
  if (shape === 'square') return <rect x={x - s / 2} y={y - s / 2} width={s} height={s} rx={2.5} {...paint} />
  if (shape === 'pill') return <rect x={x - s * 0.75} y={y - s * 0.38} width={s * 1.5} height={s * 0.76} rx={s * 0.38} {...paint} />
  if (shape === 'diamond') {
    const d = s * 0.66
    return <path d={`M${x} ${y - d}L${x + d} ${y}L${x} ${y + d}L${x - d} ${y}Z`} {...paint} />
  }
  return <circle cx={x} cy={y} r={s / 2} {...paint} />
}

/** The lane's key: a short bar for kinds with a length (feeds add a dot for bottles), else its shape. */
export function LaneKey({ lane, size = 14 }: { lane: Lane; size?: number }) {
  const c = LANE_COLOR[lane]
  if (lane === 'feed')
    return (
      <svg width={size + 8} height={size} viewBox="0 0 22 14" aria-hidden="true" className="shrink-0">
        <rect x={1} y={4} width={12} height={6} rx={3} fill={c} />
        <Glyph shape="dot" x={17} y={7} s={8} color={c} halo={false} />
      </svg>
    )
  if (lane === 'sleep')
    return (
      <svg width={size + 2} height={size} viewBox="0 0 16 14" aria-hidden="true" className="shrink-0">
        <rect x={1} y={4} width={14} height={6} rx={3} fill={c} />
      </svg>
    )
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true" className="shrink-0">
      <Glyph shape={SHAPE_OF[lane]} x={7} y={7} s={9} color={c} halo={false} />
    </svg>
  )
}

/** "3p" on the hour, "3:30" between hours: short enough for a phone-wide day. */
const tickLabel = (m: number) =>
  m % 60
    ? formatTime(new Date(2000, 0, 1, 0, m)).replace(/\s?[AP]M$/i, '')
    : formatHour(Math.floor(m / 60) % 24).replace(/\s?([AP])M$/i, (_, a: string) => a.toLowerCase())

type Drag = {
  x0: number
  y0: number
  m0: number
  mode: 'pending' | 'brush' | 'end-a' | 'end-b' | 'none'
  mouse: boolean
  target: Element
  timer?: ReturnType<typeof setTimeout>
  id: number
}

export default function DayChart({
  marks,
  lanes,
  range,
  view,
  onRange,
  nowMin = null,
  span = 1440,
}: {
  marks: Mark[]
  /** the lanes to draw, top to bottom */
  lanes: Lane[]
  range: Range | null
  /** the part of the day shown (all of it, or a zoomed range) */
  view: Range
  onRange: (r: Range | null) => void
  /** minutes since midnight now, on today's chart: later hours are greyed */
  nowMin?: number | null
  span?: number
}) {
  const { t } = useTranslation()
  const clip = useId()
  const box = useRef<HTMLDivElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  const [width, setWidth] = useState(FALLBACK_W)
  const drag = useRef<Drag | null>(null)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth || FALLBACK_W)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => () => clearTimeout(drag.current?.timer), [])

  const W = width
  const H = Math.max(120, lanes.length * ROW + AXIS + 2)
  const plotB = lanes.length * ROW
  const x = (m: number) => PAD + ((m - view.from) / (view.to - view.from)) * (W - PAD * 2)
  const minuteAt = (clientX: number) => {
    const r = svg.current?.getBoundingClientRect()
    const px = r && r.width ? ((clientX - r.left) / r.width) * W : clientX
    return Math.min(span, Math.max(0, Math.round(view.from + ((px - PAD) / (W - PAD * 2)) * (view.to - view.from))))
  }
  const pick = (a: number, b: number) => onRange({ from: Math.min(a, b), to: Math.max(a, b) })
  const inRange = (m: Mark) => !range || (m.from <= range.to && m.to >= range.from)
  const labelOf = (m: Mark) => `${describe(m.item, t).title}, ${formatTime(m.item.data.started_at ? String(m.item.data.started_at) : m.item.at)}`
  const markById = (id: string | undefined) => marks.find((m) => `${m.item.kind}:${m.item.id}` === id)

  const capture = (id: number) => {
    try {
      svg.current?.setPointerCapture(id)
    } catch {
      // the pointer is already gone
    }
  }
  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button > 0) return
    clearTimeout(drag.current?.timer)
    const target = e.target as Element
    const handle = target.closest?.('[data-handle]')?.getAttribute('data-handle')
    const d: Drag = { x0: e.clientX, y0: e.clientY, m0: minuteAt(e.clientX), mode: 'pending', mouse: e.pointerType === 'mouse', target, id: e.pointerId }
    if (handle) {
      d.mode = handle === 'a' ? 'end-a' : 'end-b'
      capture(e.pointerId)
      e.stopPropagation()
    } else if (!d.mouse) {
      d.timer = setTimeout(() => {
        if (drag.current !== d || d.mode !== 'pending') return
        d.mode = 'brush'
        capture(d.id)
        navigator.vibrate?.(12)
        pick(d.m0, d.m0 + 1)
      }, HOLD_MS)
    }
    drag.current = d
  }
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (!d || e.pointerId !== d.id) return
    const dx = e.clientX - d.x0
    const dy = e.clientY - d.y0
    if (d.mode === 'pending') {
      if (d.mouse && Math.abs(dx) > 4) {
        d.mode = 'brush'
        capture(d.id)
      } else if (!d.mouse && Math.hypot(dx, dy) > 8) {
        // a sideways swipe or a scroll: not ours
        clearTimeout(d.timer)
        d.mode = 'none'
        return
      } else return
    }
    if (d.mode === 'none') return
    e.stopPropagation()
    const m = minuteAt(e.clientX)
    if (d.mode === 'brush') pick(d.m0, m)
    else if (range) {
      const a = d.mode === 'end-a' ? m : range.from
      const b = d.mode === 'end-b' ? m : range.to
      pick(a, b)
    }
  }
  const onUp = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (!d || e.pointerId !== d.id) return
    clearTimeout(d.timer)
    drag.current = null
    if (d.mode === 'pending') {
      const hit = markById(d.target.closest?.('[data-mark]')?.getAttribute('data-mark') ?? undefined)
      onRange(hit ? markRange(hit, span) : null)
    } else if (d.mode !== 'none') {
      e.stopPropagation()
      if (d.mode === 'brush' && Math.abs(minuteAt(e.clientX) - d.m0) < 5) onRange(null)
    }
  }
  const onCancel = () => {
    clearTimeout(drag.current?.timer)
    drag.current = null
  }
  const onKey = (e: KeyboardEvent<SVGElement>, m: Mark) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    onRange(markRange(m, span))
  }

  const step = tickStep(view.to - view.from, W - PAD * 2)
  const ticks: number[] = []
  for (let m = Math.ceil(view.from / step) * step; m <= view.to; m += step) ticks.push(m)

  const rows: ReactNode[] = []
  lanes.forEach((lane, i) => {
    const top = i * ROW
    const cy = top + BAND + (ROW - BAND) / 2
    const color = LANE_COLOR[lane]
    const mine = marks.filter((m) => m.lane === lane)
    const bh = 18 * (lane === 'sleep' ? 1 : 0.86)
    for (const m of mine.filter((mm) => mm.bar)) {
      const x0 = x(m.from)
      const w = Math.max(3, x(m.to) - x0 - 1)
      rows.push(
        <g key={`${m.item.kind}:${m.item.id}`} data-dim={String(!inRange(m))} opacity={inRange(m) ? 1 : 0.25}>
          <rect x={x0} y={cy - bh / 2} width={w} height={bh} rx={4} fill={color} />
          {m.live && <circle cx={x0 + w} cy={cy} r={bh / 2 + 2} fill="none" stroke={color} strokeWidth={2} />}
          <rect
            data-mark={`${m.item.kind}:${m.item.id}`}
            role="button"
            tabIndex={0}
            aria-label={labelOf(m)}
            onKeyDown={(e) => onKey(e, m)}
            x={x0 - 3}
            y={cy - bh / 2 - 7}
            width={w + 6}
            height={bh + 14}
            fill="transparent"
            className="cursor-pointer outline-none focus-visible:stroke-[var(--ink)]"
          />
        </g>,
      )
    }
    const moments = mine.filter((mm) => !mm.bar).sort((a, b) => a.from - b.from)
    const xs = moments.map((m) => x(m.from))
    const half = ((SHAPE + 3) / 2) * (SHAPE_OF[lane] === 'pill' ? 1.4 : 1)
    const slot = packMoments(xs, half, 3)
    const extra = new Map<number, number>()
    slot.forEach((s, j) => {
      if (s !== -1) return
      // count it on the nearest shape in the last row
      let best = -1
      for (let k = 0; k < j; k++) if (slot[k] === 2 && (best < 0 || Math.abs(xs[k] - xs[j]) < Math.abs(xs[best] - xs[j]))) best = k
      if (best >= 0) extra.set(best, (extra.get(best) ?? 0) + 1)
    })
    const offs = [0, -SHAPE * 0.8, SHAPE * 0.8]
    moments.forEach((m, j) => {
      if (slot[j] === -1) return
      const y = cy + offs[slot[j]]
      const more = extra.get(j)
      rows.push(
        <g key={`${m.item.kind}:${m.item.id}`} data-dim={String(!inRange(m))} opacity={inRange(m) ? 1 : 0.25}>
          <Glyph shape={SHAPE_OF[lane]} x={xs[j]} y={y} s={SHAPE} color={color} hollow={m.skipped} />
          <circle
            data-mark={`${m.item.kind}:${m.item.id}`}
            role="button"
            tabIndex={0}
            aria-label={labelOf(m)}
            onKeyDown={(e) => onKey(e, m)}
            cx={xs[j]}
            cy={y}
            r={SHAPE * 0.85}
            fill="transparent"
            className="cursor-pointer outline-none"
          />
          {more ? (
            <g aria-hidden="true">
              <rect x={xs[j] + 8} y={y - 7} width={22} height={14} rx={7} fill="var(--ink)" />
              <text
                x={xs[j] + 19}
                y={y + 0.5}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={9.5}
                fontWeight={700}
                fill="var(--surface)"
              >{`+${more}`}</text>
            </g>
          ) : null}
        </g>,
      )
    })
  })

  const sel = range && range.to >= view.from && range.from <= view.to ? { a: x(Math.max(range.from, view.from)), b: x(Math.min(range.to, view.to)) } : null

  return (
    <div ref={box} role="group" aria-label={t('dayChart.label')} className="relative overflow-hidden rounded-xl">
      <svg
        ref={svg}
        width="100%"
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="block touch-pan-y select-none [-webkit-touch-callout:none]"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
        onContextMenu={(e) => e.preventDefault()}
      >
        <defs>
          <clipPath id={clip}>
            <rect x={PAD - 1} y={0} width={W - PAD * 2 + 2} height={H} />
          </clipPath>
        </defs>
        <rect x={0} y={0} width={W} height={H} fill="transparent" />
        {lanes.map((l, i) => (i % 2 === 0 ? <rect key={l} x={0} y={i * ROW} width={W} height={ROW} fill="var(--app)" opacity={0.75} /> : null))}
        {ticks.map((m) => {
          const tx = x(m)
          const anchor = tx < PAD + 12 ? 'start' : tx > W - PAD - 12 ? 'end' : 'middle'
          return (
            <g key={m} aria-hidden="true">
              <line x1={tx} y1={0} x2={tx} y2={plotB} stroke="var(--line)" strokeWidth={1} />
              <text x={tx} y={H - 7} textAnchor={anchor} fontSize={10.5} fontWeight={700} fill="var(--muted)">
                {tickLabel(m)}
              </text>
            </g>
          )
        })}
        {nowMin != null && nowMin < view.to && (
          <g aria-hidden="true">
            <rect
              x={x(Math.max(nowMin, view.from))}
              y={0}
              width={Math.max(0, W - PAD - x(Math.max(nowMin, view.from)))}
              height={plotB}
              fill="var(--muted)"
              opacity={0.08}
            />
            <line
              x1={x(Math.max(nowMin, view.from))}
              y1={0}
              x2={x(Math.max(nowMin, view.from))}
              y2={plotB}
              stroke="var(--ink)"
              strokeOpacity={0.5}
              strokeWidth={1.5}
              strokeDasharray="3 3"
            />
          </g>
        )}
        {sel && <rect aria-hidden="true" x={sel.a} y={0} width={Math.max(4, sel.b - sel.a)} height={plotB} fill="var(--primary)" opacity={0.12} />}
        <g clipPath={`url(#${clip})`}>{rows}</g>
        {lanes.map((l, i) => (
          <g key={l} pointerEvents="none">
            <rect
              x={4}
              y={i * ROW + 3}
              width={t(`dayChart.lanes.${l}`).length * 6.2 + (l === 'feed' ? 34 : 28)}
              height={17}
              rx={8.5}
              fill="var(--surface)"
              opacity={0.92}
            />
            <g transform={`translate(9 ${i * ROW + 4.5})`}>
              <LaneKey lane={l} size={14} />
            </g>
            <text x={l === 'feed' ? 32 : 27} y={i * ROW + 12} dominantBaseline="middle" fontSize={10.5} fontWeight={700} fill="var(--ink)">
              {t(`dayChart.lanes.${l}`)}
            </text>
          </g>
        ))}
        {sel && range && (
          <>
            {(['a', 'b'] as const).map((end) => {
              const hx = end === 'a' ? sel.a : sel.b
              const value = end === 'a' ? range.from : range.to
              return (
                <g
                  key={end}
                  data-handle={end}
                  role="slider"
                  aria-label={t(end === 'a' ? 'dayChart.rangeStart' : 'dayChart.rangeEnd')}
                  aria-valuemin={0}
                  aria-valuemax={span}
                  aria-valuenow={value}
                  aria-valuetext={formatTime(new Date(2000, 0, 1, 0, value))}
                  className="cursor-ew-resize"
                >
                  <line x1={hx} y1={0} x2={hx} y2={plotB} stroke="var(--primary)" strokeWidth={1.5} />
                  <rect x={hx - 14} y={0} width={28} height={plotB} fill="transparent" />
                  <rect x={hx - 5} y={plotB / 2 - 13} width={10} height={26} rx={5} fill="var(--primary)" stroke="var(--surface)" strokeWidth={2} />
                </g>
              )
            })}
          </>
        )}
      </svg>
    </div>
  )
}
