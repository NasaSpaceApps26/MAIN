import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import type { Body, EphemerisYear } from '../../api/types'
import { useSimStore } from '../../store/simStore'
import { positionAt } from './orbitMath'
import { radiusToUnits } from './scale'

// The only parts of drei's OrbitControls we need
type Controls = { target: Vector3 }

type Props = { bodies: Body[]; year: EphemerisYear }

/**
 * Keeps the camera on the selected body while it moves along its orbit.
 * On a new selection the camera jumps close to the body; after that you can rotate and zoom
 * as usual. Click empty space to deselect and fly freely again.
 */
export function CameraFollow({ bodies, year }: Props) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as Controls | null
  const lastSelected = useRef<string | null>(null)
  const bodyPos = useRef(new Vector3())
  const offset = useRef(new Vector3())

  useFrame(() => {
    const { selectedBodyId, simTimeMs } = useSimStore.getState()
    const body = bodies.find((b) => b.id === selectedBodyId)
    if (!controls || !body) {
      lastSelected.current = null
      return
    }

    const samples = year.bodies[body.id]?.samples
    if (samples) positionAt(samples, simTimeMs, bodyPos.current)
    else bodyPos.current.set(0, 0, 0) // the Sun

    // Where the camera is relative to what it looks at (what the user rotated/zoomed to)
    offset.current.subVectors(camera.position, controls.target)
    if (lastSelected.current !== body.id) {
      lastSelected.current = body.id
      offset.current.setLength(radiusToUnits(body.radius_km, body.id) * 8) // ~8 radii away
    }

    // Move the target and the camera together, so the view travels with the body
    controls.target.copy(bodyPos.current)
    camera.position.copy(bodyPos.current).add(offset.current)
  })

  return null
}
