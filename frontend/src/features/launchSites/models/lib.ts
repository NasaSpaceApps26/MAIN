/** Small helpers shared by the launch site models (no components here). */

export type V3 = [number, number, number]
/** Axis-aligned area on the ground: [x0, z0, x1, z1]. */
export type Rect = [number, number, number, number]

/** Height of a pad's launch mount above the pad surface: rockets stand at this height. */
export const MOUNT_H = 0.55

/** Seeded random numbers (mulberry32), so the trees stay in the same place every time. */
export function rng(seed: number) {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const inRect = (x: number, z: number, [x0, z0, x1, z1]: Rect) => x >= x0 && x <= x1 && z >= z0 && z <= z1

/** Random points inside `area`, avoiding every rect in `exclude`. */
export function scatter(count: number, area: Rect, seed: number, exclude: Rect[] = []): [number, number][] {
  const rand = rng(seed)
  const out: [number, number][] = []
  for (let tries = 0; out.length < count && tries < count * 20; tries++) {
    const x = area[0] + rand() * (area[2] - area[0])
    const z = area[1] + rand() * (area[3] - area[1])
    if (!exclude.some((r) => inRect(x, z, r))) out.push([x, z])
  }
  return out
}

/** Square of side 2·r around (x, z), for exclude lists. */
export const around = (x: number, z: number, r: number): Rect => [x - r, z - r, x + r, z + r]

export const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export const pick = <T,>(rand: () => number, list: readonly T[]) => list[Math.floor(rand() * list.length)]

/** Points along a line from a to b (x, z), with a little random jitter. */
export function along(a: [number, number], b: [number, number], count: number, jitter = 0.5, seed = 5): [number, number][] {
  const rand = rng(seed)
  return Array.from({ length: count }, (_, i) => {
    const u = count === 1 ? 0.5 : i / (count - 1)
    return [a[0] + (b[0] - a[0]) * u + (rand() - 0.5) * jitter, a[1] + (b[1] - a[1]) * u + (rand() - 0.5) * jitter]
  })
}
