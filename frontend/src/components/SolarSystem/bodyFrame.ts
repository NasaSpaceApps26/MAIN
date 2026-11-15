import { Quaternion, Vector3 } from 'three'

/**
 * How each body is turned at a moment in time: the rotation from the body's own frame to the scene.
 * The body's own frame is the one latLonToLocal (sitePosition.ts) uses: +Y = north pole,
 * longitude 0 on +X, 90°E on -Z. The scene is the ecliptic frame (see eclipticKmToScene).
 *
 *  - Earth: its real orientation (axis tilted 23.4° from the ecliptic, turned by the Earth
 *    rotation angle), so the launch-site dots are where the mission simulation launches from.
 *  - Moon: the IAU model with its wobbles, the same one the mission simulation (misja.py) uses,
 *    so the near side faces Earth and the landing points are where the simulated lander touches down.
 *  - Saturn: its IAU pole (tilted ~27° to its orbit), so its rings lean the way they really do.
 *  - everything else: a spin around the scene's "up" axis, one turn per rotation period.
 *
 * Everything that needs to know where a point of the surface is (the planet mesh, the altitude
 * readout, the fly camera, the mission scene) goes through bodyOrientation, so they always agree.
 */

const DEG = Math.PI / 180
export const OBLIQUITY = 23.439291111 * DEG // tilt of Earth's equator to the ecliptic (J2000)

const X = new Vector3(1, 0, 0)
const Y = new Vector3(0, 1, 0)
const q = new Quaternion()
const poleQ = new Quaternion()

/** Days since J2000.0 (1 Jan 2000, 12:00) for Unix time `ms`. */
const daysFromJ2000 = (ms: number) => ms / 86_400_000 + 2440587.5 - 2451545.0

/** Earth rotation angle (IAU 2000): how far Greenwich has turned from the equinox, radians. */
export function earthRotationAngle(ms: number) {
  const d = daysFromJ2000(ms)
  const turns = 0.779057273264 + 0.00273781191135448 * d + (d % 1)
  return 2 * Math.PI * (((turns % 1) + 1) % 1)
}

/**
 * The Moon's north pole (right ascension, declination) and prime meridian angle W, degrees.
 * IAU/WGCCRE model (Archinal et al.), as in misja.py's _moon_angles.
 */
function moonAngles(ms: number) {
  const d = daysFromJ2000(ms)
  const T = d / 36525
  const E = [
    125.045 - 0.0529921 * d, 250.089 - 0.1059842 * d, 260.008 + 13.0120009 * d,
    176.625 + 13.3407154 * d, 357.529 + 0.9856003 * d, 311.589 + 26.4057084 * d,
    134.963 + 13.064993 * d, 276.617 + 0.3287146 * d, 34.226 + 1.7484877 * d,
    15.134 - 0.1589763 * d, 119.743 + 0.0036096 * d, 239.961 + 0.1643573 * d,
    25.053 + 12.9590088 * d,
  ].map((e) => e * DEG)
  const s = E.map(Math.sin)
  const c = E.map(Math.cos)
  const ra =
    269.9949 + 0.0031 * T - 3.8787 * s[0] - 0.1204 * s[1] + 0.07 * s[2] - 0.0172 * s[3] +
    0.0072 * s[5] - 0.0052 * s[9] + 0.0043 * s[12]
  const dec =
    66.5392 + 0.013 * T + 1.5419 * c[0] + 0.0239 * c[1] - 0.0278 * c[2] + 0.0068 * c[3] -
    0.0029 * c[5] + 0.0009 * c[6] + 0.0008 * c[9] - 0.0009 * c[12]
  const W =
    38.3213 + 13.17635815 * d - 1.4e-12 * d * d + 3.561 * s[0] + 0.1208 * s[1] - 0.0642 * s[2] +
    0.0158 * s[3] + 0.0252 * s[4] - 0.0066 * s[5] - 0.0047 * s[6] - 0.0046 * s[7] +
    0.0028 * s[8] + 0.0052 * s[9] + 0.004 * s[10] + 0.0019 * s[11] - 0.0044 * s[12]
  return { ra, dec, W }
}

type Spinning = { id: string; rotation_period_h: number }

/**
 * Writes into `out` the rotation from the body's own frame to the scene at Unix time `tMs`.
 *
 * In the equator frame (ICRF) a body is turned by Rz(ra + 90°)·Rx(90° − dec)·Rz(W), then the
 * equator frame is tilted into the ecliptic by Rx(−obliquity). In scene axes (y = ecliptic north)
 * a turn around z becomes a turn around y, so the whole thing is
 * Rx(−ε)·Ry(ra + 90°)·Rx(90° − dec)·Ry(W).
 */
export function bodyOrientation(body: Spinning, tMs: number, out: Quaternion): Quaternion {
  if (body.id === 'earth') {
    // Earth's pole is the equator frame's z axis (precession is left out: < 0.5° over 30 years)
    out.setFromAxisAngle(X, -OBLIQUITY)
    return out.multiply(q.setFromAxisAngle(Y, earthRotationAngle(tMs)))
  }
  if (body.id === 'moon') {
    const { ra, dec, W } = moonAngles(tMs)
    out.setFromAxisAngle(X, -OBLIQUITY)
    out.multiply(q.setFromAxisAngle(Y, (ra + 90) * DEG))
    out.multiply(q.setFromAxisAngle(X, (90 - dec) * DEG))
    return out.multiply(q.setFromAxisAngle(Y, W * DEG))
  }
  if (body.id === 'saturn') {
    // IAU/WGCCRE (Archinal et al. 2018): pole α = 40.589 − 0.036T, δ = 83.537 − 0.004T, W = 38.90 + 810.7939024d
    const d = daysFromJ2000(tMs)
    const T = d / 36525
    out.setFromAxisAngle(X, -OBLIQUITY)
    out.multiply(q.setFromAxisAngle(Y, (40.589 - 0.036 * T + 90) * DEG))
    out.multiply(q.setFromAxisAngle(X, (90 - (83.537 - 0.004 * T)) * DEG))
    return out.multiply(q.setFromAxisAngle(Y, ((38.9 + 810.7939024 * d) % 360) * DEG))
  }
  const hours = tMs / 3_600_000
  return out.setFromAxisAngle(Y, (hours / body.rotation_period_h) * Math.PI * 2)
}

/** The body's north pole as a direction in the scene. */
export function bodyPole(body: Spinning, tMs: number, out: Vector3): Vector3 {
  return out.copy(Y).applyQuaternion(bodyOrientation(body, tMs, poleQ))
}
