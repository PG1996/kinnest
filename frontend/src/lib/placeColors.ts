import type { PlaceKind } from '../api/hooks'

/** One colour per place, so hospital and home readings are easy to tell apart on every chart. */
export const PLACE_COLORS: Record<PlaceKind, string> = {
  home: '#2f7d6d',
  hospital: '#c2410c',
  clinic: '#7c3aed',
  other: '#64748b',
}
