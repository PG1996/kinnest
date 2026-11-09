export function formatAgo(ms: number): string {
  const m = Math.floor(ms / 60_000)
  if (m < 1) return '<1m'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

// Times are always 12-hour with AM or PM, whatever the phone's own clock setting.
const clockFormat = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit', hour12: true })
const hourFormat = new Intl.DateTimeFormat('en', { hour: 'numeric', hour12: true })

/** "9:05 PM" for a Date, an ISO string or a timestamp in ms. */
export function formatTime(when: Date | string | number): string {
  return clockFormat.format(new Date(when))
}

/** "9 PM" for an hour of the day (0 to 23). */
export function formatHour(hour: number): string {
  return hourFormat.format(new Date(2000, 0, 1, hour))
}

export function formatClock(iso: string): string {
  return formatTime(iso)
}

/** Local "YYYY-MM-DDTHH:mm" for <input type="datetime-local">. */
export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Local "YYYY-MM-DD" for <input type="date"> and date-only comparisons. */
export function toLocalDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** "23 Oct 2026" for a date-only "YYYY-MM-DD". */
export function formatDay(day: string): string {
  return new Date(`${day}T00:00:00`).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
}
