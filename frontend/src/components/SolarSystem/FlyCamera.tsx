import { moonUnitRadius } from './EarthMoon/moonTerrain'
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Euler, Quaternion, Vector3 } from 'three'
import type { Body, EphemerisYear } from '../../api/types'
import { useSimStore } from '../../store/simStore'
import { bodyOrientation } from './bodyFrame'
import { followControl } from './followControl'
import { FRAME_ORDER } from './frameOrder'
import { drawnPositionAt, parentSamplesOf } from './orbitMath'
import {
  moonOrbitScale,
  radiusToUnits,
  spheroidRadii,
} from './scale'

const LOOK_SPEED = 0.002
const MOVE_SPEED = 1
const BOOST = 4
const PRECISION = 0.1

const MAX_SPEED = 2000
const MAX_DISTANCE = 12_000

// One scene unit represents one billion metres.
const SCENE_METRE = 1 / 1_000_000_000
const MIN_ALTITUDE_M = 2

// --- safeguards against camera jumps ---
/** A longer frame (the browser stalled: tiles loading, garbage collection) moves no further than this. */
const MAX_STEP_S = 0.05
/** A wheel turn is spread over a few frames (~0.15 s): the same zoom, without a jump. */
const WHEEL_RATE = 20
/** A tilt left by another camera move fades by this much per mouse move while dragging, instead of snapping level. */
const ROLL_FADE = 0.85
/**
 * While nothing is followed, a body the camera is within this many of its radii above carries the
 * camera along: it would otherwise sweep into the camera while the clock runs (and the collision
 * would shove the camera to another spot every frame).
 */
const CARRY_RADII = 1.5

type Props = {
  bodies?: Body[]
  year?: EphemerisYear
}

type Surface = {
  id: string
  lunar: boolean
  toBody: Quaternion // scene → the body's own turning frame (see bodyFrame.ts)
  center: Vector3
  equatorial: number
  polar: number
  metre: number
}

export function FlyCamera({ bodies, year }: Props) {
  const camera = useThree((s) => s.camera)
  const canvas = useThree((s) => s.gl.domElement)

  const keys = useRef(new Set<string>())
  const wheel = useRef(0)

  const move = useRef(new Vector3())
  const bodyPos = useRef(new Vector3())
  const offset = useRef(new Vector3())
  const forward = useRef(new Vector3())
  // the carry safeguard: where each body was in the last frame, and the body carrying the camera
  const lastCenters = useRef(new Map<string, Vector3>())
  const carriedBy = useRef<string | null>(null)
  const carryStep = useRef(new Vector3())

  useEffect(() => {
    const held = keys.current
    camera.lookAt(0, 0, 0)

    const look = new Euler(0, 0, 0, 'YXZ')

    let dragging = false
    let lastX = 0
    let lastY = 0

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return

      dragging = true
      lastX = e.clientX
      lastY = e.clientY

      look.setFromQuaternion(camera.quaternion)
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return

      if ((e.buttons & 1) === 0) {
        dragging = false
        return
      }

      // Start from where the camera points now: following the rocket (or another camera move)
      // may have turned it since the drag began, and the old angles made the view jump back
      look.setFromQuaternion(camera.quaternion)
      look.y -= (e.clientX - lastX) * LOOK_SPEED
      look.x -= (e.clientY - lastY) * LOOK_SPEED
      look.x = Math.max(-1.55, Math.min(1.55, look.x))
      // a tilt (roll) left by such a move fades out over the drag instead of snapping to level
      look.z = Math.abs(look.z) < 1e-3 ? 0 : look.z * ROLL_FADE

      camera.quaternion.setFromEuler(look)

      lastX = e.clientX
      lastY = e.clientY
    }

    const onPointerUp = (e: PointerEvent) => {
      if (e.button === 0) dragging = false
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isTyping(e)) held.add(e.code)
    }

    const onKeyUp = (e: KeyboardEvent) => {
      held.delete(e.code)
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()

      const multiplier =
        e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 800 : 1

      wheel.current = Math.max(
        -600,
        Math.min(
          600,
          wheel.current + e.deltaY * multiplier,
        ),
      )
    }

    const releaseAll = () => {
      held.clear()
      wheel.current = 0
      dragging = false
    }

    const noMenu = (e: MouseEvent) => e.preventDefault()

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('wheel', onWheel, {
      passive: false,
    })
    canvas.addEventListener('contextmenu', noMenu)

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', releaseAll)

    return () => {
      canvas.removeEventListener(
        'pointerdown',
        onPointerDown,
      )
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('contextmenu', noMenu)

      window.removeEventListener(
        'pointermove',
        onPointerMove,
      )
      window.removeEventListener(
        'pointerup',
        onPointerUp,
      )
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', releaseAll)
    }
  }, [camera, canvas])

  // Last of the camera steps in every frame (after the clock, the spacecraft and CameraFollow, see
  // frameOrder.ts): the bodies and the camera are already where they are this frame, so the
  // collision below checks the real situation and has the last word before the frame is drawn.
  useFrame((_, delta) => {
    const { simTimeMs, planetSize, selectedBodyId } = useSimStore.getState()
    const orbitScale = moonOrbitScale(planetSize)
    const dt = Math.min(delta, MAX_STEP_S)

    const surfaces: Surface[] = []

    for (const body of bodies ?? []) {
      const samples = year?.bodies[body.id]?.samples

      if (samples) {
        drawnPositionAt(
          samples,
          parentSamplesOf(year, body.id),
          simTimeMs,
          orbitScale,
          bodyPos.current,
        )
      } else if (body.id === 'sun') {
        bodyPos.current.set(0, 0, 0)
      } else {
        continue
      }

      const radius = radiusToUnits(
        body.radius_km,
        body.id,
        planetSize,
      )

      const { equatorial, polar } = spheroidRadii(
        radius,
        body.id === 'moon' ? 0 : body.flattening,
      )

      const scale =
        radius / (body.radius_km / 1_000_000)

      const metre = SCENE_METRE * scale

      const surface: Surface = {
        id: body.id,
        lunar: body.id === 'moon',
        toBody: bodyOrientation(body, simTimeMs, new Quaternion()).invert(),
        center: bodyPos.current.clone(),
        equatorial,
        polar,
        metre,
      }

      surfaces.push(surface)
    }

    // Safeguard: carried along by the body the camera was close to in the last frame, while nothing
    // is followed (CameraFollow carries the camera then) and the flight overview is not placing it
    const carrier = carriedBy.current
    if (carrier && selectedBodyId === null && !followControl.panning) {
      const surface = surfaces.find((s) => s.id === carrier)
      const before = lastCenters.current.get(carrier)
      if (surface && before) camera.position.add(carryStep.current.subVectors(surface.center, before))
    }

    // the nearest surface sets the flying speed
    let nearest = camera.position.length()
    let nearestMetre = SCENE_METRE

    for (const surface of surfaces) {
      offset.current.subVectors(
        camera.position,
        surface.center,
      )

      const distance = offset.current.length()

      const surfaceRadius = terrainSurfaceRadius(offset.current, surface)

      const altitude = distance - surfaceRadius

      if (altitude < nearest) {
        nearest = altitude
        nearestMetre = surface.metre
      }
    }

    const held = keys.current

    let factor =
      held.has('ShiftLeft') || held.has('ShiftRight')
        ? BOOST
        : 1

    if (held.has('AltLeft') || held.has('AltRight')) {
      factor *= PRECISION
    }

    const clearance = Math.max(
      nearest,
      MIN_ALTITUDE_M * nearestMetre,
    )

    const speed =
      Math.min(clearance * MOVE_SPEED, MAX_SPEED) *
      factor

    move.current.set(
      Number(held.has('KeyD')) -
        Number(held.has('KeyA')),
      0,
      Number(held.has('KeyS')) -
        Number(held.has('KeyW')),
    )

    if (move.current.lengthSq() > 0) {
      move.current
        .normalize()
        .applyQuaternion(camera.quaternion)

      camera.position.addScaledVector(
        move.current,
        speed * dt,
      )
    }

    if (wheel.current !== 0) {
      // a share of the wheel turns still waiting, so one turn plays out over a few frames; the
      // shares multiply up to the same zoom as taking it all at once
      const share = Math.abs(wheel.current) < 2 ? 1 : 1 - Math.exp(-dt * WHEEL_RATE)
      const amount = wheel.current * share
      wheel.current -= amount

      camera.getWorldDirection(forward.current)

      const step =
        clearance *
        (1 - Math.exp(amount * 0.0015)) *
        factor

      camera.position.addScaledVector(
        forward.current,
        Math.max(
          -clearance * 0.75,
          Math.min(clearance * 0.75, step),
        ),
      )
    }

    let finalClearance = Infinity
    // for the carry next frame: the body the camera is close to now
    let carryNext: string | null = null
    let carryAltitude = Infinity

    for (const surface of surfaces) {
      offset.current.subVectors(
        camera.position,
        surface.center,
      )

      let distance = offset.current.length()

      if (distance < 1e-15) {
        offset.current.set(0, 1, 0)

        distance =
          surface.polar +
          MIN_ALTITUDE_M * surface.metre

        camera.position
          .copy(surface.center)
          .addScaledVector(offset.current, distance)
      }

      const radius = terrainSurfaceRadius(offset.current, surface)

      const minimum =
        radius + MIN_ALTITUDE_M * surface.metre

      if (distance < minimum) {
        camera.position
          .copy(surface.center)
          .addScaledVector(
            offset.current,
            minimum / distance,
          )

        distance = minimum
      }

      finalClearance = Math.min(
        finalClearance,
        distance - radius,
      )

      const altitude = distance - radius
      if (altitude < surface.equatorial * CARRY_RADII && altitude < carryAltitude) {
        carryAltitude = altitude
        carryNext = surface.id
      }
    }

    // remember this frame for the carry safeguard
    carriedBy.current = carryNext
    for (const surface of surfaces) {
      const last = lastCenters.current.get(surface.id)
      if (last) last.copy(surface.center)
      else lastCenters.current.set(surface.id, surface.center.clone())
    }

    if (camera.position.length() > MAX_DISTANCE) {
      camera.position.setLength(MAX_DISTANCE)
    }

    // Update even while stationary so close-up imagery
    // is not clipped by the original fixed near plane.
    const near = Math.max(
      1e-11,
      Math.min(
        1e-5,
        Math.max(finalClearance, 1e-10) * 0.02,
      ),
    )

    if (
      Math.abs(camera.near - near) >
      near * 0.05
    ) {
      camera.near = near
      camera.updateProjectionMatrix()
    }
  }, FRAME_ORDER.fly)

  return null
}

const inBody = new Vector3()

function terrainSurfaceRadius(p: Vector3, surface: Surface) {
  // the camera's direction in the body's own frame: +Y is its north pole
  const { x, y, z } = inBody.copy(p).applyQuaternion(surface.toBody)
  if (surface.lunar) {
    const lat = Math.atan2(y, Math.hypot(x, z)) * 180 / Math.PI
    const lon = Math.atan2(-z, x) * 180 / Math.PI
    return surface.equatorial * moonUnitRadius(lat, lon)
  }
  return radialRadius(inBody, surface.equatorial, surface.polar)
}

function radialRadius(
  p: Vector3,
  equatorial: number,
  polar: number,
) {
  const distance = p.length()

  if (distance < 1e-15) return polar

  const horizontal =
    Math.hypot(p.x, p.z) / distance

  const vertical = p.y / distance

  return (
    1 /
    Math.hypot(
      horizontal / equatorial,
      vertical / polar,
    )
  )
}

function isTyping(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null

  if (!el) return false

  if (
    el.isContentEditable ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT'
  ) {
    return true
  }

  if (el.tagName !== 'INPUT') return false

  return ![
    'checkbox',
    'radio',
    'button',
    'range',
  ].includes((el as HTMLInputElement).type)
}