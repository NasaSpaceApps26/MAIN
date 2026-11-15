import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import type { Body, EphemerisYear } from '../../api/types'
import { rocketTracker } from '../../features/mission/missionStore'
import { useSimStore } from '../../store/simStore'
import { drawnPositionAt, parentSamplesOf } from './orbitMath'
import { moonOrbitScale, radiusToUnits } from './scale'

type Props = { bodies: Body[]; year: EphemerisYear }

/** Selecting this id follows the spacecraft of the computed flight (see MissionScene). */
export const ROCKET_ID = 'rocket'

/**
 * Keeps the camera with the selected body while it moves along its orbit.
 * On a new selection (or when the planet size changes) the camera jumps to ~8 radii from the
 * body, looking at it. After that it travels along with the body, so W/A/S/D and the mouse work
 * as if the body stood still. Click empty space to deselect: the camera then stays where it is.
 *
 * The spacecraft of a computed flight can be followed the same way (selected id 'rocket'). It is
 * too small to measure in radii: the camera jumps to a spot above and a little behind it, the
 * distance MissionScene picks for where it is (close over Earth, further out on the way).
 */
export function CameraFollow({ bodies, year }: Props) {
  const camera = useThree((s) => s.camera)
  const jumpedTo = useRef<string | null>(null) // e.g. "earth:25": body + size we last jumped to
  const bodyPos = useRef(new Vector3())
  const lastBodyPos = useRef(new Vector3())
  const step = useRef(new Vector3())

  useFrame(() => {
    const { selectedBodyId, simTimeMs, planetSize } = useSimStore.getState()
    const following = selectedBodyId === ROCKET_ID && rocketTracker.active
    const body = following ? null : bodies.find((b) => b.id === selectedBodyId)
    if (!body && !following) {
      jumpedTo.current = null
      return
    }

    if (following) {
      bodyPos.current.copy(rocketTracker.position)
    } else if (body) {
      const samples = year.bodies[body.id]?.samples
      if (samples) {
        const parent = parentSamplesOf(year, body.id)
        drawnPositionAt(samples, parent, simTimeMs, moonOrbitScale(planetSize), bodyPos.current)
      } else {
        bodyPos.current.set(0, 0, 0) // the Sun
      }
    }

    const key = `${selectedBodyId}:${planetSize}`
    if (jumpedTo.current !== key) {
      jumpedTo.current = key
      if (following) {
        // Jump: above and behind the spacecraft, looking at it
        step.current.copy(rocketTracker.viewDir)
        camera.position.copy(bodyPos.current).addScaledVector(step.current, rocketTracker.viewDistance)
      } else if (body) {
        // Jump: stay on the side of the body we're already on, ~8 radii away, and look at it
        step.current.subVectors(camera.position, bodyPos.current).normalize()
        if (step.current.lengthSq() === 0) step.current.set(0, 0.5, 1).normalize()
        const distance = radiusToUnits(body.radius_km, body.id, planetSize) * 8
        camera.position.copy(bodyPos.current).addScaledVector(step.current, distance)
      }
      camera.lookAt(bodyPos.current)
    } else {
      // Travel with the body: move the camera exactly as far as the body moved since last frame
      camera.position.add(step.current.subVectors(bodyPos.current, lastBodyPos.current))
    }
    lastBodyPos.current.copy(bodyPos.current)
  })

  return null
}
