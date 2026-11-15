import { Color, Vector3 } from 'three'
import { KM_PER_UNIT } from '../../components/SolarSystem/scale'
import type { MissionTrajectory } from './types'

/** Close to the Moon the path is drawn and flown relative to the Moon, far away relative to Earth. */
const MOON_NEAR_KM = 20_000
const MOON_FAR_KM = 60_000

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

const smooth = (a: number, b: number, x: number) => {
  const u = Math.min(Math.max((x - a) / (b - a), 0), 1)
  return u * u * (3 - 2 * u)
}

/** Ecliptic km -> scene units (same axes as eclipticKmToScene). */
const put = (arr: Float32Array, k: number, x: number, y: number, z: number) => {
  arr[k] = x / KM_PER_UNIT
  arr[k + 1] = z / KM_PER_UNIT
  arr[k + 2] = -y / KM_PER_UNIT
}

/** A trajectory prepared for drawing and for looking up the spacecraft at any time. */
export class FlightPath {
  readonly n: number
  readonly t: Float64Array // seconds from liftoff
  readonly launchMs: number
  readonly endS: number
  readonly arrivalS: number // when the path is first drawn relative to the Moon
  readonly earthLine: { positions: Float32Array; colors: Float32Array; times: Float64Array }
  readonly moonLine: { positions: Float32Array; colors: Float32Array; times: Float64Array; start: number }
  private readonly tr: MissionTrajectory
  private readonly moonDist: Float64Array

  constructor(tr: MissionTrajectory) {
    this.tr = tr
    this.n = tr.t_s.length
    this.t = Float64Array.from(tr.t_s)
    this.launchMs = tr.launch_ms
    this.endS = this.t[this.n - 1]

    this.moonDist = new Float64Array(this.n)
    for (let i = 0; i < this.n; i++)
      this.moonDist[i] = Math.hypot(tr.r[0][i] - tr.moon[0][i], tr.r[1][i] - tr.moon[1][i], tr.r[2][i] - tr.moon[2][i])

    // Earth part: every sample until the spacecraft is close to the Moon, geocentric
    let iNear = this.moonDist.findIndex((d) => d < MOON_NEAR_KM)
    if (iNear < 0) iNear = this.n
    // Moon part: from where the blend starts, relative to the Moon's centre at that moment
    let iFar = iNear
    while (iFar > 0 && this.moonDist[iFar - 1] < MOON_FAR_KM) iFar--
    this.arrivalS = this.t[Math.min(iFar, this.n - 1)]

    const color = new Color()
    const colors = tr.phases.map((p) => color.set(phaseColor(p)).toArray() as number[])

    const earthN = iNear
    const ep = new Float32Array(earthN * 3)
    const ec = new Float32Array(earthN * 3)
    for (let i = 0; i < earthN; i++) {
      put(ep, i * 3, tr.r[0][i], tr.r[1][i], tr.r[2][i])
      ec.set(colors[tr.phase[i]], i * 3)
    }
    this.earthLine = { positions: ep, colors: ec, times: this.t.slice(0, earthN) }

    const moonN = this.n - iFar
    const mp = new Float32Array(moonN * 3)
    const mc = new Float32Array(moonN * 3)
    for (let j = 0; j < moonN; j++) {
      const i = iFar + j
      put(mp, j * 3, tr.r[0][i] - tr.moon[0][i], tr.r[1][i] - tr.moon[1][i], tr.r[2][i] - tr.moon[2][i])
      mc.set(colors[tr.phase[i]], j * 3)
    }
    this.moonLine = { positions: mp, colors: mc, times: this.t.slice(iFar), start: iFar }
  }

  /** Index i with t[i] <= tS < t[i+1] (clamped), and the fraction between them. */
  private locate(tS: number): [number, number] {
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

  private lerp(cols: [number[], number[], number[]], i: number, f: number, out: Vector3) {
    const x = cols[0][i] + (cols[0][i + 1] - cols[0][i]) * f
    const y = cols[1][i] + (cols[1][i + 1] - cols[1][i]) * f
    const z = cols[2][i] + (cols[2][i + 1] - cols[2][i]) * f
    return out.set(x / KM_PER_UNIT, z / KM_PER_UNIT, -y / KM_PER_UNIT)
  }

  private readonly a = new Vector3()
  private readonly b = new Vector3()

  /**
   * Spacecraft position in the scene at `tS` seconds from liftoff, given where the scene draws
   * Earth and the Moon right now. Far from the Moon it follows Earth, close to it the Moon, with a
   * smooth blend between, so it lands exactly on the marker drawn on the Moon.
   */
  spacecraft(tS: number, earth: Vector3, moon: Vector3, out: Vector3): Vector3 {
    const [i, f] = this.locate(tS)
    const geo = this.lerp(this.tr.r, i, f, this.a)
    const moonGeo = this.lerp(this.tr.moon, i, f, this.b)
    const d = this.moonDist[i] + (this.moonDist[i + 1] - this.moonDist[i]) * f
    const w = 1 - smooth(MOON_NEAR_KM, MOON_FAR_KM, d)
    // relative to Earth: earth + geo; relative to the Moon: moon + (geo - moonGeo)
    out.copy(earth).add(geo)
    const viaMoon = moonGeo.negate().add(geo).add(moon)
    return out.lerp(viaMoon, w)
  }

  /** Landing site relative to the Moon's centre at `tS`, in scene units. */
  site(tS: number, out: Vector3): Vector3 {
    const [i, f] = this.locate(tS)
    return this.lerp(this.tr.site, i, f, out)
  }

  /** Moon's centre relative to Earth at `tS` (as the simulation had it), in scene units. */
  moonGeo(tS: number, out: Vector3): Vector3 {
    const [i, f] = this.locate(tS)
    return this.lerp(this.tr.moon, i, f, out)
  }

  /** Phase name and distance to the Moon at `tS`. */
  state(tS: number) {
    const [i, f] = this.locate(tS)
    const k = f < 0.5 ? i : i + 1
    return {
      phase: this.tr.phases[this.tr.phase[k]],
      moonDistKm: this.moonDist[k],
      altEarthKm: this.tr.alt_earth_km[k],
      altMoonKm: this.tr.alt_moon_km[k],
      speedKmS: this.tr.speed_km_s[k],
      massKg: this.tr.mass_kg[k],
    }
  }
}

/** Number of samples of `times` at or before `tS` (how much of a line is already flown). */
export function countUpTo(times: Float64Array, tS: number) {
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

/** One FlightPath per trajectory, shared by the scene and the panel. */
export function flightPathOf(tr: MissionTrajectory) {
  let p = cache.get(tr)
  if (!p) cache.set(tr, (p = new FlightPath(tr)))
  return p
}
