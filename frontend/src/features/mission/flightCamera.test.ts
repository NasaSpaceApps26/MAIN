import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import { KM_PER_UNIT, SIZE_OPTIONS } from '../../components/SolarSystem/scale'
import { type FramePoint, type OverviewFrame, OverviewPan, overviewFrame } from './flightCamera'

const EARTH_WORLD = new Vector3(110, 0, -100) // about 1 AU from the Sun at the origin

/** Earth, the Moon now and the Moon three days later (40° further along), relative to Earth. */
function points(size: number): FramePoint[] {
  const o = SIZE_OPTIONS.find((x) => x.size === size)!
  const d = (384_400 * o.moonOrbit) / KM_PER_UNIT
  const a = (40 * Math.PI) / 180
  return [
    { p: new Vector3(), r: ((6_378 * o.size) / KM_PER_UNIT) * 1.2 },
    { p: new Vector3(d, 0.02 * d, 0), r: ((1_737 * o.moonSize) / KM_PER_UNIT) * 1.5 },
    { p: new Vector3(d * Math.cos(a), 0, -d * Math.sin(a)), r: ((1_737 * o.moonSize) / KM_PER_UNIT) * 1.5 },
  ]
}

function cameraAt(view: OverviewFrame) {
  const camera = new PerspectiveCamera(50, 16 / 9, 1e-5, 1e7)
  const look = view.center.clone().add(EARTH_WORLD)
  camera.position.copy(look).addScaledVector(view.dir, view.dist)
  camera.lookAt(look)
  camera.updateMatrixWorld()
  return camera
}

describe('flight overview', () => {
  for (const { size, label } of SIZE_OPTIONS) {
    it(`fits Earth and both Moons on screen (${label})`, () => {
      const camera = new PerspectiveCamera(50, 16 / 9, 1e-5, 1e7)
      const pts = points(size)
      const view = overviewFrame(EARTH_WORLD, pts, camera, { center: new Vector3(), dir: new Vector3(), dist: 1 })
      const placed = cameraAt(view)
      for (const { p } of pts) {
        const ndc = p.clone().add(EARTH_WORLD).project(placed)
        expect(Math.abs(ndc.x)).toBeLessThan(1)
        expect(Math.abs(ndc.y)).toBeLessThan(1)
      }
      // seen from above the orbit, not edge-on
      expect(view.dir.y).toBeGreaterThan(0.6)
    })
  }

  it('starts where the camera is and ends at the overview', () => {
    const camera = new PerspectiveCamera(50, 16 / 9, 1e-5, 1e7)
    const rocket = new Vector3(1.6, 0, 0)
    const view: OverviewFrame = { center: new Vector3(3, 0, 0), dir: new Vector3(0, 1, 0), dist: 15 }
    const pan = new OverviewPan()
    pan.start(new Vector3(0.1, 0, 0), 0) // camera 0.1 units beside the rocket
    pan.update(1e-6, camera, EARTH_WORLD, rocket, view)
    expect(camera.position.distanceTo(rocket.clone().add(EARTH_WORLD).add(new Vector3(0.1, 0, 0)))).toBeLessThan(1e-4)
    let done = false
    for (let i = 0; i < 400 && !done; i++) done = pan.update(1 / 60, camera, EARTH_WORLD, rocket, view)
    expect(done).toBe(true)
    expect(camera.position.distanceTo(new Vector3(3, 15, 0).add(EARTH_WORLD))).toBeLessThan(1e-6)
  })
})
