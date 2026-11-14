import type { Vector3 } from 'three'

/** 1 scene unit = 1 million km. Earth sits ~150 units from the Sun, Neptune ~4500. */
export const KM_PER_UNIT = 1_000_000

/**
 * The size choices in the top bar.
 *  - size: how many times bigger the PLANETS are drawn. Planet orbits always stay the same.
 *  - sunSize: how many times bigger the Sun is drawn. Keep it below ~60, or it reaches Mercury's orbit.
 *  - moonSize: how many times bigger the Moon is drawn. Grows a little (+20%) per step.
 *  - moonOrbit: how many times further the Moon is drawn from Earth than in reality.
 *    Big planets would swallow the Moon's real orbit (at ×250 Earth's radius is already 4× the
 *    Earth–Moon distance), so the orbit grows with the size. Not to scale, but always clearly visible.
 * "Off" shows everything at its true size and distance.
 */
export const SIZE_OPTIONS: {
  size: number
  sunSize: number
  moonSize: number
  moonOrbit: number
  label: string
}[] = [
  { size: 1, sunSize: 1, moonSize: 1, moonOrbit: 1, label: 'Off' },
  { size: 250, sunSize: 25, moonSize: 500, moonOrbit: 15, label: '×250' },
  { size: 500, sunSize: 25, moonSize: 600, moonOrbit: 25, label: '×500' },
  { size: 1000, sunSize: 25, moonSize: 720, moonOrbit: 50, label: '×1000' },
]

const optionFor = (size: number) => SIZE_OPTIONS.find((o) => o.size === size) ?? SIZE_OPTIONS[0]

/** How much the Moon's distance from Earth is stretched at this planet size */
export const moonOrbitScale = (size: number) => optionFor(size).moonOrbit

/** Drawn radius in scene units. `size` is the planet size picked in the top bar. */
export function radiusToUnits(radiusKm: number, bodyId: string, size = 1) {
  const units = radiusKm / KM_PER_UNIT
  const option = optionFor(size)
  if (bodyId === 'sun') return units * option.sunSize
  if (bodyId === 'moon') return units * option.moonSize
  return units * option.size
}

/** Radius along x, y (pole to pole) and z. A flattened planet has a smaller y. */
export type Shape = [number, number, number]

/**
 * Equatorial and polar radius of a body flattened by its spin (Saturn, Jupiter...).
 * The volumetric mean radius stays the same: equatorial² × polar = mean³.
 * `flattening` = (equatorial - polar) / equatorial, from the NASA fact sheets (via the backend).
 */
export function spheroidRadii(meanRadius: number, flattening: number) {
  const equatorial = meanRadius / Math.cbrt(1 - flattening)
  return { equatorial, polar: equatorial * (1 - flattening) }
}


/**
 * Horizons uses the ecliptic frame: X/Y lie in the plane of Earth's orbit, Z points to ecliptic north.
 * three.js uses Y as "up", so: scene.x = X, scene.y = Z, scene.z = -Y.
 */
export function eclipticKmToScene(x: number, y: number, z: number, out: Vector3): Vector3 {
  return out.set(x / KM_PER_UNIT, z / KM_PER_UNIT, -y / KM_PER_UNIT)
}
