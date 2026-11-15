import type { LaunchSite } from '../launchSites/sites'

/**
 * Rockets the mission panel can choose from, and how long each one takes to reach the Moon.
 *
 * THIS IS THE PLACE FOR THE ROCKET CALCULATIONS. Until they are plugged in, `flightPlan` uses the
 * flown Apollo 11 timeline for every rocket and site and marks the result `illustrative: true`.
 * To integrate the real code: add the rocket to ROCKETS and make `flightPlan` return its computed
 * transit time (and set `illustrative: false`, `method: '<what it computes>'`). Everything else
 * (mission panel, results window, power/comms at arrival) already reads from here.
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

/** Liftoff → touchdown for one rocket from one launch site. */
export function flightPlan(rocket: Rocket, site: LaunchSite, launchMs: number): FlightPlan {
  const transitH = APOLLO_11_LAUNCH_TO_LANDING_H
  return {
    launchMs,
    arrivalMs: launchMs + transitH * 3_600_000,
    transitH,
    illustrative: true,
    method: `${rocket.name} from ${site.name}: Apollo 11 timeline (the same for every site until the rocket calculations are added)`,
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
