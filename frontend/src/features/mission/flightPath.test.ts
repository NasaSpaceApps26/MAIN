import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { Quaternion } from 'three'
import { bodyOrientation } from '../../components/SolarSystem/bodyFrame'
import { FlightPath, countUpTo, turnWithMoon } from './flightPath'
import type { MissionTrajectory } from './types'

/** Straight line from Earth to a Moon parked 384 000 km away on +x, ending on its surface. */
function straightFlight(): MissionTrajectory {
  const n = 101
  const moonX = 384_000
  const t = [...Array(n).keys()].map((i) => i * 3600)
  const x = t.map((_, i) => 6_600 + ((moonX - 1_737 - 6_600) * i) / (n - 1))
  const zeros = t.map(() => 0)
  return {
    launch_ms: 1_000_000,
    phases: ['Coast to the Moon'],
    t_s: t,
    phase: zeros,
    alt_earth_km: zeros,
    alt_moon_km: zeros,
    speed_km_s: zeros,
    mass_kg: zeros,
    r: [x, zeros, zeros],
    moon: [t.map(() => moonX), zeros, zeros],
    site: [t.map(() => -1_737), zeros, zeros],
  }
}

describe('FlightPath', () => {
  const path = new FlightPath(straightFlight())

  it('starts next to the Earth drawn in the scene', () => {
    const earth = new Vector3(150, 0, 0)
    const moon = new Vector3(150.4, 0, 0) // where the scene draws the Moon, not exactly the sim's
    const p = path.spacecraft(0, earth, moon, new Vector3())
    expect(p.x).toBeCloseTo(150 + 0.0066, 6)
  })

  it('ends exactly on the landing site of the Moon drawn in the scene', () => {
    const earth = new Vector3(150, 0, 0)
    const moon = new Vector3(150.39, 0.001, 0)
    const p = path.spacecraft(path.endS, earth, moon, new Vector3())
    const site = moon.clone().add(path.site(path.endS, new Vector3()))
    expect(p.distanceTo(site)).toBeLessThan(1e-9)
  })

  it('splits the drawing into an Earth part and a Moon part that overlap', () => {
    expect(path.earthLine.times.length).toBeGreaterThan(0)
    expect(path.moonLine.start).toBeLessThan(path.earthLine.times.length)
  })

  it('counts flown samples', () => {
    expect(countUpTo(path.t, -1)).toBe(0)
    expect(countUpTo(path.t, 3600)).toBe(2)
    expect(countUpTo(path.t, 1e9)).toBe(path.n)
  })
})

describe('after the flight data ends', () => {
  it('fromMoon is the spacecraft relative to the Moon', () => {
    const path = new FlightPath(straightFlight())
    const v = path.fromMoon(path.endS, new Vector3())
    expect(v.x * 1e6).toBeCloseTo(-1_737, 3) // scene units -> km
    expect(v.y).toBeCloseTo(0, 9)
    expect(v.z).toBeCloseTo(0, 9)
  })

  it('a landed point turns with the Moon and keeps its place on the surface', () => {
    const endMs = Date.UTC(2026, 0, 1)
    const site = new Vector3(0.3, 0.8, -0.5).normalize()
    // where the point is in the Moon's own frame at the end of the data...
    const moon = { id: 'moon', rotation_period_h: 655.72 }
    const ownAtEnd = site.clone().applyQuaternion(bodyOrientation(moon, endMs, new Quaternion()).invert())
    for (const hours of [1, 24, 24 * 14]) {
      const nowMs = endMs + hours * 3_600_000
      const turned = turnWithMoon(site.clone(), endMs, nowMs)
      // ...and where it is in that frame later: the same spot
      const ownNow = turned.clone().applyQuaternion(bodyOrientation(moon, nowMs, new Quaternion()).invert())
      expect(ownNow.distanceTo(ownAtEnd)).toBeLessThan(1e-9)
      if (hours === 24 * 14) expect(turned.angleTo(site)).toBeGreaterThan(1) // half a turn: it really moved
    }
  })
})

describe('touchdownS', () => {
  it('is the first sample on the surface', () => {
    const tr = straightFlight()
    tr.phases = ['Coast to the Moon', 'On the surface']
    tr.phase = tr.t_s.map((_, i) => (i >= 90 ? 1 : 0))
    expect(new FlightPath(tr).touchdownS).toBe(90 * 3600)
  })
  it('is null when the flight never reaches the ground', () => {
    const tr = straightFlight()
    tr.alt_moon_km = tr.t_s.map(() => 100)
    expect(new FlightPath(tr).touchdownS).toBeNull()
  })
})
