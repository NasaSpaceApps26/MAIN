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

type Props = { bodies: Body[]; year: EphemerisYear }

const FLIGHT_S = 2.2 // length of the fly-in, seconds
const VIEW_RADII = 6 // the camera stops this many radii from the body's centre

/** Slow start, fast middle, gentle stop. */
const easeInOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2)

type Flight = {
  startS: number // clock time when the flight began
  fromTarget: Vector3 // what the camera looked at when the flight began
  fromDist: number // camera distance from that point
  fromDir: Vector3 // direction from target to camera when the flight began
  toDir: Vector3 // direction the camera ends up in: on the body's sunlit side
  toDist: number
}

const UP = new Vector3(0, 1, 0)

/**
 * Flies the camera to the selected body, then keeps it there while the body moves along its orbit.
 * During the flight the look-at point glides to the body, the distance shrinks smoothly
 * (on a log scale, because it goes from millions of km to a few planet radii) and the camera
 * swings round to the body's day side, so you arrive looking at the lit half.
 * After that you can rotate and zoom as usual. Click empty space to deselect and fly freely again.
 */
export function CameraFollow({ bodies, year }: Props) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as Controls | null
  const lastSelected = useRef<string | null>(null)
  const flight = useRef<Flight | null>(null)
  const bodyPos = useRef(new Vector3())
  const offset = useRef(new Vector3())
  const dir = useRef(new Vector3())

  useFrame(({ clock }) => {
    const { selectedBodyId, simTimeMs } = useSimStore.getState()
    const body =
      selectedBodyId === 'rocket' && rocketTracker.active ? ROCKET : bodies.find((b) => b.id === selectedBodyId)
    if (!controls || !body) {
      lastSelected.current = null
      flight.current = null
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
    }

    const f = flight.current
    if (f) {
      const u = Math.min((clock.elapsedTime - f.startS) / FLIGHT_S, 1)
      const k = easeInOut(u)
      // look-at point slides to the (moving) body; distance shrinks geometrically
      controls.target.lerpVectors(f.fromTarget, bodyPos.current, k)
      const dist = Math.exp(Math.log(f.fromDist) + (Math.log(f.toDist) - Math.log(f.fromDist)) * k)
      dir.current.lerpVectors(f.fromDir, f.toDir, k).normalize()
      camera.position.copy(controls.target).addScaledVector(dir.current, dist)
      if (u >= 1) flight.current = null
      return
    }

    // Following: move the target and the camera together, keeping the offset the user rotated/zoomed to
    offset.current.subVectors(camera.position, controls.target)
    controls.target.copy(bodyPos.current)
    camera.position.copy(bodyPos.current).add(offset.current)
  })

  return null
}
