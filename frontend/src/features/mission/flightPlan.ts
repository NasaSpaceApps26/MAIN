import type { LaunchSite } from '../launchSites/sites'
import type { MissionResult } from './types'

/**
 * Rockets the mission panel can choose from, and how long each one takes to reach the Moon.
 *
 * The rocket calculations are the mission simulation (backend/app/mission/misja.py), run from the
 * mission panel (step 4) for the highlighted launch site and landing point. `flightPlan` uses that
 * computed flight for the site it was computed for. For the other sites (or before it is computed)
 * it falls back to the flown Apollo 11 timeline and marks the result `illustrative: true`.
 */

export type RocketId = 'saturnV'

export type Rocket = {
  id: RocketId
  name: string
  description: string
}

export const ROCKETS: readonly Rocket[] = [
  {
    id: 'saturnV',
    name: 'Saturn V',
    description: 'Apollo profile: Earth parking orbit, translunar injection, lunar orbit, landing.',
  },
]

export const rocketById = (id: RocketId) => ROCKETS.find((r) => r.id === id)!

export type FlightPlan = {
  launchMs: number // liftoff, UTC ms
  arrivalMs: number // touchdown at the landing point, UTC ms
  transitH: number // liftoff → touchdown, hours
  illustrative: boolean // true = not computed for this rocket/site, just a reference timeline
  method: string // what the numbers come from
}

/** Apollo 11: liftoff 16 Jul 1969 13:32:00 UTC, touchdown 20 Jul 1969 20:17:40 UTC. */
const APOLLO_11_LAUNCH_TO_LANDING_H = (Date.UTC(1969, 6, 20, 20, 17, 40) - Date.UTC(1969, 6, 16, 13, 32)) / 3_600_000

const MODE_NAMES: Record<string, string> = { szybki: 'fastest', oszczedny: 'least fuel' }

/** Touchdown of a computed flight, seconds after liftoff (null if it never lands). */
function touchdownS(flight: MissionResult) {
  if (!flight.landed) return null
  const ev = flight.events.find((e) => e.name.startsWith('TOUCHDOWN'))
  return ev ? ev.t_s : null
}

/**
 * Liftoff → touchdown for one rocket from one launch site. `computed` = the flight the mission
 * simulation computed (mission panel, step 4); used when it starts from this site and lands.
 */
export function flightPlan(rocket: Rocket, site: LaunchSite, launchMs: number, computed?: MissionResult | null): FlightPlan {
  const fromHere =
    computed?.trajectory &&
    Math.abs(computed.launch.lat - site.lat) < 1e-3 &&
    Math.abs(computed.launch.lon - site.lon) < 1e-3
  const landS = computed && fromHere ? touchdownS(computed) : null
  if (computed?.trajectory && landS !== null) {
    const liftoff = computed.trajectory.launch_ms
    return {
      launchMs: liftoff,
      arrivalMs: liftoff + landS * 1000,
      transitH: landS / 3600,
      illustrative: false,
      method: `${rocket.name} from ${site.name}: computed by the mission simulation (${MODE_NAMES[computed.mode] ?? computed.mode} mode), liftoff in the first launch window from the planned time`,
    }
  }
  const transitH = APOLLO_11_LAUNCH_TO_LANDING_H
  return {
    launchMs,
    arrivalMs: launchMs + transitH * 3_600_000,
    transitH,
    illustrative: true,
    method: `${rocket.name} from ${site.name}: Apollo 11 timeline (compute the flight in the mission panel, step 4, for the real one)`,
  }
}

/** Speed of Earth's surface at the equator from its rotation, m/s. */
const EQUATOR_SPEED_MS = 465.1

/**
 * What a launch site's latitude means for the rocket, without any rocket model:
 *  - rotationBoostMs: the free speed a due-east launch gets from Earth's spin (more near the equator)
 *  - minInclinationDeg: the lowest orbit inclination reachable without a costly plane change
 */
export function siteFactors(site: LaunchSite) {
  return {
    rotationBoostMs: EQUATOR_SPEED_MS * Math.cos((site.lat * Math.PI) / 180),
    minInclinationDeg: Math.abs(site.lat),
  }
}
