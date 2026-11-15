import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { FlightPath, countUpTo } from './flightPath'
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
