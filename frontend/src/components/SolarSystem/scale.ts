import type { Vector3 } from 'three'

/** 1 scene unit = 1 million km. Earth sits ~150 units from the Sun, Neptune ~4500. */
export const KM_PER_UNIT = 1_000_000

/**
 * Multiplies the radius of planets and the Moon (never the Sun).
 * 1 = true size: correct, but planets are tiny next to their orbits, so use the labels to find them.
 * Try 100–500 to see them from far away (the Moon will then end up inside Earth).
 */
export const SIZE_SCALE = 1

export const radiusToUnits = (radiusKm: number, bodyId: string) =>
  (radiusKm / KM_PER_UNIT) * (bodyId === 'sun' ? 1 : SIZE_SCALE)

/**
 * Horizons uses the ecliptic frame: X/Y lie in the plane of Earth's orbit, Z points to ecliptic north.
 * three.js uses Y as "up", so: scene.x = X, scene.y = Z, scene.z = -Y.
 */
export function eclipticKmToScene(x: number, y: number, z: number, out: Vector3): Vector3 {
  return out.set(x / KM_PER_UNIT, z / KM_PER_UNIT, -y / KM_PER_UNIT)
}
