import { Color, Quaternion, Vector3 } from 'three'
import { moonHeight, moonUnitRadius } from '../../components/SolarSystem/EarthMoon/moonTerrain'
import { KM_PER_UNIT, SIZE_OPTIONS } from '../../components/SolarSystem/scale'
import { type FlightPath, phaseColor } from './flightPath'

/**
 * Where the computed flight is DRAWN in the space view.
 *
 * The simulation works in real kilometres, but the space view is not to scale: with the size
 * buttons Earth is drawn up to 1000× bigger, the Moon up to 720× and the Moon's orbit up to 50×
 * further out. Real positions would put the rocket deep inside the big Earth. So distances from
 * Earth (and from the Moon, close to it) are redrawn in three bands:
 *
 *   1. near the surface (below NEAR km): the drawn surface + the altitude at the body's own
 *      size, so the climb, the parking orbit and the lunar orbit keep their shape around the body
 *   2. in between: a straight hand-over from band 1 to band 3
 *   3. far away (beyond FAR km): the real distance × the Moon orbit's stretch, exactly like the
 *      Moon itself is drawn, so the coast arrives at the drawn Moon
 *
 * Only distances change; directions stay real. With the size button on "Off" every band is the
 * real distance, so the flight is drawn at true scale.
 */

const EARTH_NEAR_KM = 2_000
const EARTH_FAR_KM = 190_000
const MOON_NEAR_KM = 1_500
const MOON_FAR_KM = 120_000
/** Over this many km (beyond MOON_FAR_KM) the spacecraft is handed over from Earth's frame to the Moon's. */
const BLEND_KM = 20_000

export type DrawScale = {
  earth: number // how many times bigger Earth is drawn
  moon: number // ... the Moon
  orbit: number // how many times further the Moon is drawn from Earth
}

export function drawScale(planetSize: number): DrawScale {
  const o = SIZE_OPTIONS.find((x) => x.size === planetSize) ?? SIZE_OPTIONS[0]
  return { earth: o.size, moon: o.moonSize, orbit: o.moonOrbit }
}

/**
 * Drawn distance from a body's centre (scene units) for a real point `distKm` from that centre and
 * `altKm` above the ground below it. `surface` = drawn radius of the ground there (scene units).
 */
export function drawnDistance(
  distKm: number,
  altKm: number,
  surface: number,
  nearScale: number,
  farScale: number,
  nearKm: number,
  farKm: number,
) {
  const alt = Math.max(altKm, 0)
  const nearEnd = surface + (nearScale * nearKm) / KM_PER_UNIT
  if (alt <= nearKm) return surface + (nearScale * alt) / KM_PER_UNIT
  if (distKm >= farKm) return (farScale * distKm) / KM_PER_UNIT
  const fromKm = distKm - alt + nearKm // where band 2 starts along this line
  const u = (distKm - fromKm) / (farKm - fromKm)
  return nearEnd + u * ((farScale * farKm) / KM_PER_UNIT - nearEnd)
}

/** How Earth is drawn right now. */
export type DrawnEarth = {
  center: Vector3 // scene units
  pole: Vector3 // north pole direction
  equatorial: number // drawn radii, scene units
  polar: number
}

/** How the Moon is drawn right now. */
export type DrawnMoon = {
  center: Vector3
  radius: number // drawn mean radius, scene units (without the relief)
  toBody: Quaternion // scene → the Moon's own frame (for its heights)
}

const dir = new Vector3()
const local = new Vector3()
const DEG = 180 / Math.PI

/** Offset from Earth's drawn centre for a point `geoKm` from its real centre (scene axes, km). */
export function earthOffset(geoKm: Vector3, altKm: number, earth: Omit<DrawnEarth, 'center'>, s: DrawScale, out: Vector3) {
  const d = geoKm.length()
  dir.copy(geoKm).divideScalar(d || 1)
  const sinLat = dir.dot(earth.pole)
  const cosLat = Math.sqrt(Math.max(0, 1 - sinLat * sinLat))
  // drawn ground below: Earth is a little flat
  const surface = (earth.equatorial * earth.polar) / Math.hypot(earth.polar * cosLat, earth.equatorial * sinLat)
  return out.copy(dir).multiplyScalar(drawnDistance(d, altKm, surface, s.earth, s.orbit, EARTH_NEAR_KM, EARTH_FAR_KM))
}

/** Lat/lon (degrees) on the Moon below the direction `d` (scene axes). */
function moonLatLon(d: Vector3, toBody: Quaternion) {
  local.copy(d).applyQuaternion(toBody)
  return { lat: Math.asin(Math.max(-1, Math.min(1, local.y))) * DEG, lon: Math.atan2(-local.z, local.x) * DEG }
}

/**
 * Offset from the Moon's drawn centre for a point `selKm` from its real centre (scene axes, km),
 * `altKm` above the Moon's mean radius. Measured from the drawn ground (with its stretched
 * mountains and craters), so the touchdown is exactly on the surface the view shows.
 */
export function moonOffset(selKm: Vector3, altKm: number, moon: Omit<DrawnMoon, 'center'>, s: DrawScale, out: Vector3) {
  const d = selKm.length()
  dir.copy(selKm).divideScalar(d || 1)
  const { lat, lon } = moonLatLon(dir, moon.toBody)
  const surface = moon.radius * moonUnitRadius(lat, lon)
  const aboveGround = altKm - moonHeight(lat, lon) / 1000
  // close to the Moon heights at half the Moon's upsize: a low lunar orbit stays clear of the
  // surface without the approach being squeezed into a few pixels
  const nearScale = s.orbit + 0.5 * (s.moon - s.orbit)
  return out.copy(dir).multiplyScalar(drawnDistance(d, aboveGround, surface, nearScale, s.orbit, MOON_NEAR_KM, MOON_FAR_KM))
}

/** 0 = drawn around Earth, 1 = drawn around the Moon. */
export function moonWeight(moonDistKm: number) {
  const u = Math.min(Math.max((MOON_FAR_KM + BLEND_KM - moonDistKm) / BLEND_KM, 0), 1)
  return u * u * (3 - 2 * u)
}

const geo = new Vector3()
const moonGeo = new Vector3()
const sel = new Vector3()
const viaMoon = new Vector3()

/** Where the spacecraft is drawn at `tS` seconds from liftoff (scene units). */
export function drawnSpacecraft(
  path: FlightPath,
  tS: number,
  earth: DrawnEarth,
  moon: DrawnMoon,
  s: DrawScale,
  out: Vector3,
) {
  const st = path.state(tS)
  path.geo(tS, geo)
  earthOffset(geo, st.altEarthKm, earth, s, out).add(earth.center)
  const w = moonWeight(st.moonDistKm)
  if (w > 0) {
    sel.subVectors(geo, path.moonGeo(tS, moonGeo))
    moonOffset(sel, st.altMoonKm, moon, s, viaMoon).add(moon.center)
    out.lerp(viaMoon, w)
  }
  return out
}

export type DrawnLine = {
  positions: Float32Array // x, y, z per sample, scene units, relative to the body's centre
  colors: Float32Array // r, g, b per sample: the colour of its phase
  times: Float64Array // seconds from liftoff of each sample
}

/**
 * Points of the drawn path, split in two lines like the flight: the Earth part (relative to
 * Earth's centre) until the spacecraft is handed over to the Moon, and the Moon part (relative to
 * the Moon's centre) from where the hand-over starts. `moonAt(tMs)` gives the Moon's orientation
 * at that moment (its mountains and craters turn with it).
 * `arrivalS`: when the Moon part starts. Before that it is drawn where the Moon will be then.
 */
export function drawnLines(
  path: FlightPath,
  earth: Omit<DrawnEarth, 'center'>,
  moonRadius: number,
  moonAt: (tMs: number) => Quaternion,
  s: DrawScale,
): { earth: DrawnLine; moon: DrawnLine; arrivalS: number } {
  const tr = path.tr
  let moonStart = path.n // first sample drawn around the Moon
  for (let i = 0; i < path.n; i++)
    if (path.moonDist[i] < MOON_FAR_KM + BLEND_KM) {
      moonStart = i
      break
    }
  let earthEnd = moonStart // first sample no longer drawn around Earth
  while (earthEnd < path.n && path.moonDist[earthEnd] >= MOON_FAR_KM) earthEnd++

  const color = new Color()
  const phaseRgb = tr.phases.map((name) => color.set(phaseColor(name)).toArray() as [number, number, number])
  const p = new Vector3()

  const earthLine: DrawnLine = {
    positions: new Float32Array(earthEnd * 3),
    colors: new Float32Array(earthEnd * 3),
    times: path.t.slice(0, earthEnd),
  }
  for (let i = 0; i < earthEnd; i++) {
    path.sample(i, geo, moonGeo)
    earthOffset(geo, tr.alt_earth_km[i], earth, s, p).toArray(earthLine.positions, i * 3)
    earthLine.colors.set(phaseRgb[tr.phase[i]], i * 3)
  }

  const moonN = path.n - moonStart
  const moonLine: DrawnLine = {
    positions: new Float32Array(moonN * 3),
    colors: new Float32Array(moonN * 3),
    times: path.t.slice(moonStart),
  }
  const moon = { radius: moonRadius, toBody: new Quaternion() }
  for (let j = 0; j < moonN; j++) {
    const i = moonStart + j
    path.sample(i, geo, moonGeo)
    moon.toBody.copy(moonAt(path.launchMs + path.t[i] * 1000)).invert()
    moonOffset(sel.subVectors(geo, moonGeo), tr.alt_moon_km[i], moon, s, p).toArray(moonLine.positions, j * 3)
    moonLine.colors.set(phaseRgb[tr.phase[i]], j * 3)
  }

  return { earth: earthLine, moon: moonLine, arrivalS: path.t[Math.min(moonStart, path.n - 1)] }
}
