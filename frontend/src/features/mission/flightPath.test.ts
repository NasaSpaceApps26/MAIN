import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { KM_PER_UNIT, SIZE_OPTIONS } from '../../components/SolarSystem/scale'
import { type DrawnEarth, type DrawnMoon, drawScale, drawnDistance, drawnSpacecraft } from './drawnFlight'
import { FlightPath, countUpTo } from './flightPath'
import type { MissionTrajectory } from './types'

const R_EARTH = 6_378
const R_MOON = 1_737.4
const MOON_X = 384_000

/** Straight line from Earth's surface to a Moon parked 384 000 km away on +X, ending on its surface. */
function straightFlight(): MissionTrajectory {
  const n = 201
  const t = [...Array(n).keys()].map((i) => i * 1800)
  const x = t.map((_, i) => R_EARTH + ((MOON_X - R_MOON - R_EARTH) * i) / (n - 1))
  const zeros = t.map(() => 0)
  return {
    launch_ms: 1_000_000,
    phases: ['Coast to the Moon', 'On the surface'],
    t_s: t,
    phase: t.map((_, i) => (i === n - 1 ? 1 : 0)),
    alt_earth_km: x.map((v) => v - R_EARTH),
    alt_moon_km: x.map((v) => MOON_X - v - R_MOON),
    speed_km_s: zeros,
    mass_kg: zeros,
    r: [x, zeros, zeros],
    moon: [t.map(() => MOON_X), zeros, zeros],
    site: [t.map(() => -R_MOON), zeros, zeros],
  }
}

/** Earth and the Moon as the space view draws them at one planet size. */
function sceneAt(size: number) {
  const s = drawScale(size)
  const earth: DrawnEarth = {
    center: new Vector3(150, 0, 0),
    pole: new Vector3(0, 1, 0),
    equatorial: (R_EARTH * s.earth) / KM_PER_UNIT,
    polar: (R_EARTH * s.earth) / KM_PER_UNIT,
  }
  const moon: DrawnMoon = {
    center: new Vector3(150 + (MOON_X * s.orbit) / KM_PER_UNIT, 0, 0),
    radius: (R_MOON * s.moon) / KM_PER_UNIT,
    toBody: new Quaternion(),
  }
  return { s, earth, moon }
}

describe('FlightPath', () => {
  const path = new FlightPath(straightFlight())

  it('finds the touchdown', () => {
    expect(path.touchdownS).toBe(path.endS)
  })

  it('counts flown samples', () => {
    expect(countUpTo(path.t, -1)).toBe(0)
    expect(countUpTo(path.t, 1800)).toBe(2)
    expect(countUpTo(path.t, 1e9)).toBe(path.n)
  })
})

describe('drawn flight', () => {
  const path = new FlightPath(straightFlight())

  for (const { size, label } of SIZE_OPTIONS) {
    describe(`planet size ${label}`, () => {
      const { s, earth, moon } = sceneAt(size)

      it('starts on the drawn Earth', () => {
        const p = drawnSpacecraft(path, 0, earth, moon, s, new Vector3())
        expect(p.distanceTo(earth.center)).toBeCloseTo(earth.equatorial, 9)
      })

      it('ends on the drawn Moon', () => {
        const p = drawnSpacecraft(path, path.endS, earth, moon, s, new Vector3())
        expect(p.distanceTo(moon.center)).toBeCloseTo(moon.radius, 9)
      })

      it('only moves forward, never back into Earth', () => {
        let last = -Infinity
        for (let tS = 0; tS <= path.endS; tS += 600) {
          const x = drawnSpacecraft(path, tS, earth, moon, s, new Vector3()).x
          expect(x).toBeGreaterThanOrEqual(last - 1e-12)
          last = x
        }
      })
    })
  }

  it('is drawn at true scale with the size buttons off', () => {
    for (const [dist, alt] of [[R_EARTH + 200, 200], [50_000, 50_000 - R_EARTH], [300_000, 300_000 - R_EARTH]])
      expect(drawnDistance(dist, alt, R_EARTH / KM_PER_UNIT, 1, 1, 2_000, 190_000)).toBeCloseTo(dist / KM_PER_UNIT, 12)
  })
})
