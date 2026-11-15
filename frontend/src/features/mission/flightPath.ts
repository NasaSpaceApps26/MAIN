import { Vector3 } from 'three'
import type { MissionTrajectory } from './types'

/** Colour of each part of the flight, by the phase name from misja.py. */
export function phaseColor(name: string): string {
  if (name.startsWith('Ascent')) return '#ff9a3c'
  if (name.startsWith('Parking orbit')) return '#ffd84d'
  if (name.startsWith('TLI')) return '#ff5c5c'
  if (name.startsWith('Coast to the Moon')) return '#5cc8ff'
  if (name.startsWith('LOI')) return '#ff5c5c'
  if (name.startsWith('Lunar orbit')) return '#c8a2ff'
  if (name.startsWith('DOI') || name.startsWith('Descent orbit')) return '#ff7ad9'
  if (name.startsWith('Landing') || name.startsWith('On the surface')) return '#7dff8a'
  return '#ffffff'
}

/**
 * How many simulated seconds pass per real second in each phase, so the whole flight plays in a
 * couple of minutes but the launch and the landing are still slow enough to watch.
 */
export function phaseSpeed(name: string, moonDistKm: number): number {
  if (name.startsWith('Ascent')) return 20
  if (name.startsWith('Parking orbit')) return 600
  if (name.startsWith('TLI')) return 60
  if (name.startsWith('Coast to the Moon')) return moonDistKm < 40_000 ? 900 : 7200
  if (name.startsWith('LOI')) return 120
  if (name.endsWith('orbit')) return 600 // lunar orbit, descent orbit
  if (name.startsWith('DOI')) return 60
  if (name.startsWith('Landing')) return 20
  return 10
}

type Columns = [number[], number[], number[]]

/**
 * A computed trajectory, ready for looking up the spacecraft at any time.
 * Positions come out in km, in scene axes (x = X, y = Z, z = −Y of the ecliptic frame, like
 * eclipticKmToScene) but NOT shrunk to scene units: drawnFlight.ts decides where they are drawn.
 */
export class FlightPath {
  readonly n: number
  readonly t: Float64Array // seconds from liftoff
  readonly launchMs: number // liftoff, UTC ms
  readonly endS: number
  readonly touchdownS: number | null // first sample on the surface, null if it never landed
  readonly moonDist: Float64Array // km from the Moon's centre
  readonly tr: MissionTrajectory

  constructor(tr: MissionTrajectory) {
    this.tr = tr
    this.n = tr.t_s.length
    this.t = Float64Array.from(tr.t_s)
    this.launchMs = tr.launch_ms
    this.endS = this.t[this.n - 1]

    this.moonDist = new Float64Array(this.n)
    for (let i = 0; i < this.n; i++)
      this.moonDist[i] = Math.hypot(tr.r[0][i] - tr.moon[0][i], tr.r[1][i] - tr.moon[1][i], tr.r[2][i] - tr.moon[2][i])

    const surface = tr.phases.findIndex((p) => p.startsWith('On the surface'))
    const first = surface < 0 ? -1 : tr.phase.indexOf(surface)
    this.touchdownS = first < 0 ? null : this.t[first]
  }

  /** Index i with t[i] <= tS < t[i+1] (clamped), and the fraction between them. */
  locate(tS: number): [number, number] {
    const t = this.t
    if (tS <= t[0]) return [0, 0]
    if (tS >= t[this.n - 1]) return [this.n - 2, 1]
    let lo = 0
    let hi = this.n - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (t[mid] <= tS) lo = mid
      else hi = mid
    }
    return [lo, (tS - t[lo]) / (t[lo + 1] - t[lo])]
  }

  /** One column of numbers at sample i + fraction f. */
  value(col: number[], i: number, f: number) {
    return col[i] + (col[i + 1] - col[i]) * f
  }

  /** Ecliptic km columns at sample i + fraction f → scene axes, km. */
  private vec(cols: Columns, i: number, f: number, out: Vector3) {
    const x = this.value(cols[0], i, f)
    const y = this.value(cols[1], i, f)
    const z = this.value(cols[2], i, f)
    return out.set(x, z, -y)
  }

  /** Spacecraft relative to Earth's centre at `tS` (scene axes, km). */
  geo(tS: number, out: Vector3) {
    const [i, f] = this.locate(tS)
    return this.vec(this.tr.r, i, f, out)
  }

  /** Moon's centre relative to Earth's centre at `tS`, as the simulation had it (scene axes, km). */
  moonGeo(tS: number, out: Vector3) {
    const [i, f] = this.locate(tS)
    return this.vec(this.tr.moon, i, f, out)
  }

  /** Sample i exactly: spacecraft and Moon relative to Earth's centre (scene axes, km). */
  sample(i: number, geo: Vector3, moonGeo: Vector3) {
    this.vec(this.tr.r, i, 0, geo)
    this.vec(this.tr.moon, i, 0, moonGeo)
  }

  /** Phase name, distances, speed and mass at `tS`. */
  state(tS: number) {
    const [i, f] = this.locate(tS)
    const k = f < 0.5 ? i : i + 1
    return {
      phase: this.tr.phases[this.tr.phase[k]],
      moonDistKm: this.moonDist[i] + (this.moonDist[i + 1] - this.moonDist[i]) * f,
      altEarthKm: this.value(this.tr.alt_earth_km, i, f),
      altMoonKm: this.value(this.tr.alt_moon_km, i, f),
      speedKmS: this.tr.speed_km_s[k],
      massKg: this.tr.mass_kg[k],
    }
  }
}

/** Number of samples of `times` at or before `tS` (how much of a line is already flown). */
export function countUpTo(times: ArrayLike<number>, tS: number) {
  let lo = 0
  let hi = times.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (times[mid] <= tS) lo = mid + 1
    else hi = mid
  }
  return lo
}

const cache = new WeakMap<MissionTrajectory, FlightPath>()

/** One FlightPath per trajectory, shared by the scene and the panels. */
export function flightPathOf(tr: MissionTrajectory) {
  let p = cache.get(tr)
  if (!p) cache.set(tr, (p = new FlightPath(tr)))
  return p
}
