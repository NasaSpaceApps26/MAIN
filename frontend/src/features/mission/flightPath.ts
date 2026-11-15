import { Color, Quaternion, Vector3 } from 'three'
import { bodyOrientation } from '../../components/SolarSystem/bodyFrame'
import { KM_PER_UNIT, moonOrbitScale, moonReliefScale, radiusToUnits } from '../../components/SolarSystem/scale'
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

// --- drawing the flight at the planet sizes of the top bar ---
const R_EARTH_KM = 6371 // as the bodies are drawn (backend services/bodies.py)
const R_MOON_KM = 1737.4
const MOON_DIST_KM = 384_400 // mean Earth–Moon distance
// Altitudes up to about this are stretched like the drawn body itself; above it, like the gap
// between the bodies. Low enough that the coast stays in proportion, high enough that the parking
// orbit leaves Earth's surface and the lunar orbit clears the Moon's (exaggerated) mountains.
const LIFT_EARTH_KM = 300
const LIFT_MOON_KM = 50

/**
 * The planet sizes in the top bar draw Earth and the Moon far bigger than they are (and the Moon
 * further out), while the flight is computed in real km: drawn as is, it would stay inside the
 * enlarged Earth. A DrawScale stretches it instead, so it lifts off from the drawn Earth's surface,
 * crosses the drawn gap and lands on the drawn Moon's surface. At "Off" every factor is 1 and
 * nothing changes.
 */
export type DrawScale = {
  earth: number // drawn Earth radius / real
  moon: number // drawn Moon radius / real
  moonSurface: number // drawn lunar heights / real (the Moon's size times its terrain exaggeration)
  orbit: number // drawn Earth–Moon distance / real
  gap: number // drawn gap between the two surfaces / real
}

export const TRUE_SCALE: DrawScale = { earth: 1, moon: 1, moonSurface: 1, orbit: 1, gap: 1 }

/** The DrawScale for a planet size picked in the top bar. */
export function drawScaleFor(planetSize: number): DrawScale {
  const earth = radiusToUnits(KM_PER_UNIT, 'earth', planetSize)
  const moon = radiusToUnits(KM_PER_UNIT, 'moon', planetSize)
  const orbit = moonOrbitScale(planetSize)
  const gap = (MOON_DIST_KM * orbit - R_EARTH_KM * earth - R_MOON_KM * moon) / (MOON_DIST_KM - R_EARTH_KM - R_MOON_KM)
  return { earth, moon, moonSurface: moon * moonReliefScale(planetSize), orbit, gap: Math.max(gap, 1) }
}

/** Real altitude → drawn altitude (km): `surface`× close to the ground, `gap`× far out, smoothly. */
const stretch = (h: number, surface: number, gap: number, lift: number) =>
  h * gap + (surface - gap) * lift * (1 - Math.exp(-h / lift))

/** Scales a point's distance from a body's centre (scene units, in place); its direction stays. */
function warpRadial(v: Vector3, radiusKm: number, body: number, surface: number, gap: number, lift: number) {
  const rKm = v.length() * KM_PER_UNIT
  if (rKm === 0) return v
  return v.multiplyScalar((radiusKm * body + stretch(rKm - radiusKm, surface, gap, lift)) / rKm)
}

/** A point relative to Earth's centre → where it is drawn relative to the drawn Earth (in place). */
export const warpFromEarth = (v: Vector3, s: DrawScale) => warpRadial(v, R_EARTH_KM, s.earth, s.earth, s.gap, LIFT_EARTH_KM)

/** A point relative to the Moon's centre → where it is drawn relative to the drawn Moon (in place). */
export const warpFromMoon = (v: Vector3, s: DrawScale) => warpRadial(v, R_MOON_KM, s.moon, s.moonSurface, s.gap, LIFT_MOON_KM)

/** A copy of a line's points, each warped. */
function warpLine(points: Float32Array, warp: (v: Vector3, s: DrawScale) => Vector3, s: DrawScale) {
  const out = new Float32Array(points.length)
  const v = new Vector3()
  for (let k = 0; k < points.length; k += 3) warp(v.fromArray(points, k), s).toArray(out, k)
  return out
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
  private readonly c = new Vector3()

  /** The two lines' points as drawn at this scale: Earth part relative to Earth, Moon part to the Moon. */
  drawnLines(s: DrawScale) {
    return {
      earth: warpLine(this.earthLine.positions, warpFromEarth, s),
      moon: warpLine(this.moonLine.positions, warpFromMoon, s),
    }
  }

  /**
   * Spacecraft position in the scene at `tS` seconds from liftoff, given where the scene draws
   * Earth and the Moon right now, stretched to the drawn sizes (`scale`). Far from the Moon it
   * follows Earth, close to it the Moon, with a smooth blend between, so it lands exactly on the
   * marker drawn on the Moon.
   */
  spacecraft(tS: number, earth: Vector3, moon: Vector3, out: Vector3, scale: DrawScale = TRUE_SCALE): Vector3 {
    const [i, f] = this.locate(tS)
    const geo = this.lerp(this.tr.r, i, f, this.a)
    const moonGeo = this.lerp(this.tr.moon, i, f, this.b)
    const d = this.moonDist[i] + (this.moonDist[i + 1] - this.moonDist[i]) * f
    const w = 1 - smooth(MOON_NEAR_KM, MOON_FAR_KM, d)
    // relative to the Moon: moon + (geo - moonGeo); relative to Earth: earth + geo
    const viaMoon = warpFromMoon(this.c.subVectors(geo, moonGeo), scale).add(moon)
    out.copy(earth).add(warpFromEarth(geo, scale))
    return out.lerp(viaMoon, w)
  }

  /** Spacecraft relative to the Moon's centre at `tS` (real km, not stretched), in scene units. */
  fromMoon(tS: number, out: Vector3): Vector3 {
    const [i, f] = this.locate(tS)
    this.lerp(this.tr.r, i, f, out)
    return out.sub(this.lerp(this.tr.moon, i, f, this.b))
  }

  /**
   * Seconds from liftoff of the touchdown: the first sample "On the surface", or the end of the data
   * when the flight ends on the ground. null when it never lands.
   */
  get touchdownS(): number | null {
    if (this.touchdown === undefined) {
      const k = this.tr.phase.findIndex((p) => this.tr.phases[p].startsWith('On the surface'))
      this.touchdown = k >= 0 ? this.t[k] : this.endsOnSurface ? this.endS : null
    }
    return this.touchdown
  }
  private touchdown: number | null | undefined

  /** True when the flight ends standing on the Moon (the last sample is on the ground). */
  get endsOnSurface() {
    return this.tr.alt_moon_km[this.n - 1] < 1
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

/** Only the id matters: bodyOrientation turns the Moon by its IAU model, as CelestialBody draws it. */
const MOON_BODY = { id: 'moon', rotation_period_h: 655.72 }
const turnAtEnd = new Quaternion()
const turnNow = new Quaternion()

/**
 * The trajectory stops at its last sample (just after touchdown), but the clock and the Moon keep
 * turning. A point given relative to the Moon's centre at the END of the trajectory is turned
 * with the Moon to `nowMs` (in place), so it stays on the same spot of the surface.
 */
export function turnWithMoon(v: Vector3, endMs: number, nowMs: number) {
  bodyOrientation(MOON_BODY, endMs, turnAtEnd).invert() // scene -> Moon's own frame at the end
  bodyOrientation(MOON_BODY, nowMs, turnNow) // Moon's own frame -> scene now
  return v.applyQuaternion(turnAtEnd).applyQuaternion(turnNow)
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
