import { MOON_RADIUS_M, moonHeight } from '../../components/SolarSystem/EarthMoon/moonTerrain'

/** Metres per degree of latitude on the Moon (~30.3 km). */
export const M_PER_DEG = (MOON_RADIUS_M * Math.PI) / 180

/** One cell of the LOLA height grid the app loads: 1/16° (~1.9 km at the equator). */
export const GRID_DEG = 1 / 16

const DEG = Math.PI / 180

/** Cosine of the latitude, kept away from 0 so the poles don't divide by zero. */
const cosLat = (latDeg: number) => Math.max(0.02, Math.cos(latDeg * DEG))

/** Moves `northKm` north and `eastKm` east from a point (fine for a few hundred km). */
export function offsetLatLon(latDeg: number, lonDeg: number, northKm: number, eastKm: number) {
  const lat = latDeg + (northKm * 1000) / M_PER_DEG
  const lon = lonDeg + (eastKm * 1000) / (M_PER_DEG * cosLat(lat))
  return { lat: Math.max(-90, Math.min(90, lat)), lon: ((lon + 540) % 360) - 180 }
}

/**
 * Slope of the ground at a point, from the heights one grid cell to each side (a ~4 km baseline,
 * so this is the regional slope: boulders and small craters are far smaller than the grid).
 * aspectDeg = the direction the ground falls away to, clockwise from north.
 */
export function slopeAt(latDeg: number, lonDeg: number) {
  const dEast = M_PER_DEG * GRID_DEG * cosLat(latDeg)
  const dNorth = M_PER_DEG * GRID_DEG
  const east = (moonHeight(latDeg, lonDeg + GRID_DEG) - moonHeight(latDeg, lonDeg - GRID_DEG)) / (2 * dEast)
  const north = (moonHeight(latDeg + GRID_DEG, lonDeg) - moonHeight(latDeg - GRID_DEG, lonDeg)) / (2 * dNorth)
  return {
    slopeDeg: Math.atan(Math.hypot(east, north)) / DEG,
    aspectDeg: ((Math.atan2(-east, -north) / DEG) + 360) % 360,
  }
}

/** Steepest and average slope within `radiusKm` of a point, sampled once per grid cell. */
export function slopeAround(latDeg: number, lonDeg: number, radiusKm: number) {
  const stepKm = (M_PER_DEG * GRID_DEG) / 1000
  const n = Math.max(1, Math.round(radiusKm / stepKm))
  let max = 0
  let sum = 0
  let count = 0
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      if (i * i + j * j > n * n) continue
      const p = offsetLatLon(latDeg, lonDeg, i * stepKm, j * stepKm)
      const s = slopeAt(p.lat, p.lon).slopeDeg
      max = Math.max(max, s)
      sum += s
      count++
    }
  }
  return { maxDeg: max, meanDeg: sum / count }
}

/** Compass name for a direction in degrees. */
export function compass(deg: number) {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8]
}
