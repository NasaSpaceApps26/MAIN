import type { Site } from '../../api/types'
import type { LandingPoint } from '../../store/simStore'

/** Colours shared by the Moon markers, the mission panel and the results map. */
export const ACTIVE_COLOUR = '#ffd23f' // the landing point being edited / looked at
export const OTHER_COLOUR = '#ff9f1c' // the other landing points in the mission

/** A named landing point is this close to it (degrees, about 1.5 km): picked there, not elsewhere. */
const SAME_SITE_DEG = 0.05

/** The named lunar site at these coordinates, if any. */
export function siteAt(latDeg: number, lonDeg: number, sites?: Site[]) {
  return sites?.find((s) => Math.abs(s.lat_deg - latDeg) < SAME_SITE_DEG && Math.abs(s.lon_deg - lonDeg) < SAME_SITE_DEG) ?? null
}

/**
 * Name for a landing point: the lunar site chosen (also when it was picked by its coordinates, on
 * the Lunar Sky map or typed in), or "Selected point" for a place of the user's own ("Selected
 * point 2" in the second slot, …).
 */
export function landingLabel(point: LandingPoint | null, slot: number, sites?: Site[]) {
  if (!point) return 'Not set'
  if (point.siteId) return sites?.find((s) => s.id === point.siteId)?.name ?? point.siteId
  const site = siteAt(point.latDeg, point.lonDeg, sites)
  if (site) return site.name
  return slot === 0 ? 'Selected point' : `Selected point ${slot + 1}`
}
