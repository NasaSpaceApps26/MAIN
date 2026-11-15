import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import type { Body, EphemerisYear } from '../../api/types'
import { useSimStore } from '../../store/simStore'
import { positionAt } from './orbitMath'
import { radiusToUnits } from './scale'
import { rocketTracker } from '../../features/mission/missionStore'

/** Selecting 'rocket' follows the mission spacecraft; framed as if it were a body this big. */
const ROCKET: Body = { id: 'rocket', name: 'Spacecraft', horizons_id: '', radius_km: 4000, rotation_period_h: 1, color: '#fff', texture: null }

// The only parts of drei's OrbitControls we need
type Controls = { target: Vector3 }
import { drawnPositionAt, parentSamplesOf } from './orbitMath'
import { moonOrbitScale, radiusToUnits } from './scale'

type Props = { bodies: Body[]; year: EphemerisYear }

/**
 * Keeps the camera with the selected body while it moves along its orbit.
 * On a new selection (or when the planet size changes) the camera jumps to ~8 radii from the
 * body, looking at it. After that it travels along with the body, so W/A/S/D and the mouse work
 * as if the body stood still. Click empty space to deselect: the camera then stays where it is.
 */
export function CameraFollow({ bodies, year }: Props) {
  const camera = useThree((s) => s.camera)
  const jumpedTo = useRef<string | null>(null) // e.g. "earth:25": body + size we last jumped to
  const bodyPos = useRef(new Vector3())
  const lastBodyPos = useRef(new Vector3())
  const step = useRef(new Vector3())

  useFrame(({ clock }) => {
    const { selectedBodyId, simTimeMs } = useSimStore.getState()
    const body =
      selectedBodyId === 'rocket' && rocketTracker.active ? ROCKET : bodies.find((b) => b.id === selectedBodyId)
    if (!controls || !body) {
      lastSelected.current = null
      flight.current = null
  useFrame(() => {
    const { selectedBodyId, simTimeMs, planetSize } = useSimStore.getState()
    const body = bodies.find((b) => b.id === selectedBodyId)
    if (!body) {
      jumpedTo.current = null
      return
    }

    const samples = year.bodies[body.id]?.samples
    if (body === ROCKET) bodyPos.current.copy(rocketTracker.position)
    else if (samples) positionAt(samples, simTimeMs, bodyPos.current)
    else bodyPos.current.set(0, 0, 0) // the Sun

    // New selection: start a flight from wherever the camera is now
    if (lastSelected.current !== body.id) {
      lastSelected.current = body.id
      const from = new Vector3().subVectors(camera.position, controls.target)
      const fromDist = Math.max(from.length(), 1e-6)
      from.normalize()
      // Toward the Sun (at the origin), a little from above and from where we came; the Sun keeps `from`
      const toSun = bodyPos.current.clone().negate()
      const toDir =
        toSun.lengthSq() > 0 ? toSun.normalize().multiplyScalar(0.85).addScaledVector(from, 0.3).addScaledVector(UP, 0.3).normalize() : from.clone()
      flight.current = {
        startS: clock.elapsedTime,
        fromTarget: controls.target.clone(),
        fromDist,
        fromDir: from,
        toDir,
        toDist: radiusToUnits(body.radius_km, body.id) * VIEW_RADII,
      }
    if (samples) {
      const parent = parentSamplesOf(year, body.id)
      drawnPositionAt(samples, parent, simTimeMs, moonOrbitScale(planetSize), bodyPos.current)
    } else {
      bodyPos.current.set(0, 0, 0) // the Sun
    }

    const key = `${body.id}:${planetSize}`
    if (jumpedTo.current !== key) {
      jumpedTo.current = key
      // Jump: stay on the side of the body we're already on, ~8 radii away, and look at it
      step.current.subVectors(camera.position, bodyPos.current).normalize()
      if (step.current.lengthSq() === 0) step.current.set(0, 0.5, 1).normalize()
      const distance = radiusToUnits(body.radius_km, body.id, planetSize) * 8
      camera.position.copy(bodyPos.current).addScaledVector(step.current, distance)
      camera.lookAt(bodyPos.current)
    } else {
      // Travel with the body: move the camera exactly as far as the body moved since last frame
      camera.position.add(step.current.subVectors(bodyPos.current, lastBodyPos.current))
    }
    lastBodyPos.current.copy(bodyPos.current)
  })

  return null
}
