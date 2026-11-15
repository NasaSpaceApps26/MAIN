import type { Site } from '../../api/types'
import type { LandingPoint } from '../../store/simStore'

/** Colours shared by the Moon markers, the mission panel and the results map. */
export const ACTIVE_COLOUR = '#ffd23f' // the landing point being edited / looked at
export const OTHER_COLOUR = '#ff9f1c' // the other landing points in the mission

/** Name for a landing point: the lunar site it came from, or "Point 2" for a point of your own. */
export function landingLabel(point: LandingPoint | null, slot: number, sites?: Site[]) {
  if (!point) return 'Not set'
  if (point.siteId) return sites?.find((s) => s.id === point.siteId)?.name ?? point.siteId
  return `Point ${slot + 1}`
}
