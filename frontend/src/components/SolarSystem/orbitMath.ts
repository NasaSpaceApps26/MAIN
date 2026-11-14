import { Vector3 } from 'three'
import type { OrbitalElements, StateSample } from '../../api/types'
import { eclipticKmToScene } from './scale'

const DEG = Math.PI / 180

/**
 * Position of a body at time `tMs` (Unix ms), written into `out` in scene units.
 *
 * Horizons gives one sample per day. To move smoothly between two days we use a cubic Hermite
 * curve: it passes through both positions AND matches both velocities, so it bends the same way
 * the real orbit does. Outside the downloaded year the body stays at the first/last sample.
 */
export function positionAt(samples: StateSample[], tMs: number, out: Vector3): Vector3 {
  const first = samples[0]
  const last = samples[samples.length - 1]
  if (tMs <= first.t_ms) return eclipticKmToScene(first.x_km, first.y_km, first.z_km, out)
  if (tMs >= last.t_ms) return eclipticKmToScene(last.x_km, last.y_km, last.z_km, out)

  // Samples are evenly spaced, so we can jump straight to the right pair
  const stepMs = samples[1].t_ms - first.t_ms
  const i = Math.min(Math.floor((tMs - first.t_ms) / stepMs), samples.length - 2)
  const a = samples[i]
  const b = samples[i + 1]

  const dt = (b.t_ms - a.t_ms) / 1000 // seconds between the two samples (velocities are km/s)
  const u = (tMs - a.t_ms) / (b.t_ms - a.t_ms) // 0 at sample a, 1 at sample b
  const u2 = u * u
  const u3 = u2 * u
  const h00 = 2 * u3 - 3 * u2 + 1 // weight of position a
  const h10 = (u3 - 2 * u2 + u) * dt // weight of velocity a
  const h01 = -2 * u3 + 3 * u2 // weight of position b
  const h11 = (u3 - u2) * dt // weight of velocity b

  return eclipticKmToScene(
    h00 * a.x_km + h10 * a.vx_km_s + h01 * b.x_km + h11 * b.vx_km_s,
    h00 * a.y_km + h10 * a.vy_km_s + h01 * b.y_km + h11 * b.vy_km_s,
    h00 * a.z_km + h10 * a.vz_km_s + h01 * b.z_km + h11 * b.vz_km_s,
    out,
  )
}

/**
 * Which orbit of a day-by-day list belongs to time `tMs` (the nearest day).
 * A list with a single orbit (the planets) always gives 0.
 */
export function orbitIndexAt(orbits: OrbitalElements[], tMs: number): number {
  if (orbits.length < 2) return 0
  const stepMs = orbits[1].t_ms - orbits[0].t_ms
  const i = Math.round((tMs - orbits[0].t_ms) / stepMs)
  return Math.min(Math.max(i, 0), orbits.length - 1)
}

/**
 * Points along the whole orbit ellipse described by the orbital elements, in scene units,
 * relative to what the body orbits (the Sun, or Earth for the Moon).
 */
export function orbitEllipse(el: OrbitalElements, segments = 512): Vector3[] {
  const e = el.ec
  const a = el.a_km
  const b = a * Math.sqrt(1 - e * e) // semi-minor axis

  // Rotation from the orbit's own plane (x axis pointing at perihelion) into the ecliptic frame:
  // turn by ω inside the orbit plane, tilt by i, then turn by Ω around ecliptic north
  const cosO = Math.cos(el.om_deg * DEG)
  const sinO = Math.sin(el.om_deg * DEG)
  const cosW = Math.cos(el.w_deg * DEG)
  const sinW = Math.sin(el.w_deg * DEG)
  const cosI = Math.cos(el.in_deg * DEG)
  const sinI = Math.sin(el.in_deg * DEG)

  const xx = cosO * cosW - sinO * sinW * cosI
  const xy = -cosO * sinW - sinO * cosW * cosI
  const yx = sinO * cosW + cosO * sinW * cosI
  const yy = -sinO * sinW + cosO * cosW * cosI
  const zx = sinW * sinI
  const zy = cosW * sinI

  const points: Vector3[] = []
  for (let k = 0; k <= segments; k++) {
    const E = (k / segments) * 2 * Math.PI // eccentric anomaly, goes once around the ellipse
    const px = a * (Math.cos(E) - e) // position in the orbit plane, Sun at the focus
    const py = b * Math.sin(E)
    points.push(
      eclipticKmToScene(xx * px + xy * py, yx * px + yy * py, zx * px + zy * py, new Vector3()),
    )
  }
  return points
}
