import type { Site } from '../../api/types'
import type { LandingPoint } from '../../store/simStore'
import { historicLandingById } from '../../components/SolarSystem/moonLandingsData'
import { moonFeatureById } from '../../components/SolarSystem/moonFeaturesData'

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
 * The mission's landing slots are lettered. A (slot 0) is the primary landing: the rocket flies
 * there and Lunar Sky shows it. B, C… are alternatives: dots on the Moon, no rocket, compared with A
 * in Lunar Sky ("Landing comparison").
 */
export const PRIMARY_SLOT = 0
export const landingLetter = (slot: number) => 'ABCDEFGH'[slot] ?? String(slot + 1)

/** Name of the named place a landing point is on, if any (lunar site, historic landing, Moon feature). */
function placeName(point: LandingPoint, sites?: Site[]) {
  if (point.siteId) {
    return sites?.find((s) => s.id === point.siteId)?.name
      ?? historicLandingById(point.siteId)?.name
      ?? moonFeatureById(point.siteId)?.name
      ?? point.siteId
  }
  // also a lunar site picked by its coordinates (on the Lunar Sky map or typed in)
  return siteAt(point.latDeg, point.lonDeg, sites)?.name ?? null
}

/** "Landing A", "Landing B · Tycho" (on a named place), "Landing C: not set". */
export function landingLabel(point: LandingPoint | null, slot: number, sites?: Site[]) {
  const base = `Landing ${landingLetter(slot)}`
  if (!point) return `${base}: not set`
  const name = placeName(point, sites)
  return name ? `${base} · ${name}` : base
}
