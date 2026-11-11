import type { Medicine } from '../api/hooks'

/** How long an SOS medicine stays on Home after its last dose (or after it was added, if never given). */
export const SOS_ON_HOME_MS = 48 * 3_600_000

/**
 * Whether Home shows this current medicine. Scheduled ones always; an SOS one only while its last dose is under 48 hours
 * old, or, never given yet, for 48 hours after it was added. Older SOS medicines are given from the Medicines page.
 */
export function onHome(m: Medicine, now: number): boolean {
  if (m.schedule_kind !== 'as_needed') return true
  const since = m.last_dose?.status === 'given' ? m.last_dose.given_at : m.created_at
  if (!since) return true // an older server that does not say when it was added
  return now - Date.parse(since) < SOS_ON_HOME_MS
}
