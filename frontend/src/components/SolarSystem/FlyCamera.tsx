import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Euler, Vector3 } from 'three'
import type { Body, EphemerisYear } from '../../api/types'
import { useSimStore } from '../../store/simStore'
import { drawnPositionAt, parentSamplesOf } from './orbitMath'
import { moonOrbitScale, radiusToUnits } from './scale'

// ---- Feel of the camera: play with these ----
const LOOK_SPEED = 0.002 // radians per pixel dragged (the old controls were ~3× faster). Negative = reversed
const MOVE_SPEED = 1 // each second you fly this share of the distance to the nearest body's surface
const BOOST = 4 // holding Shift multiplies the speed by this
const MIN_DISTANCE = 1e-4 // 100 km: the speed never drops below this, so you can't get stuck
const MAX_SPEED = 2000 // units per second (before Shift), so you don't rocket into the wall far out
const MAX_DISTANCE = 12_000 // invisible wall: how far from the Sun you may fly (Neptune's orbit ≈ 4540)

type Props = { bodies?: Body[]; year?: EphemerisYear }

/**
 * First-person "fly" camera:
 *  - W / S: forward / back, A / D: left / right, in the direction the camera looks. Shift: faster.
 *  - Drag with the left mouse button: turn the view.
 *  - Scroll wheel and right mouse button do nothing.
 *
 * Distances go from a few thousand km (planet to camera) to billions of km (Sun to Neptune),
 * so one fixed speed can't work. Instead the speed depends on the nearest body:
 * fast in empty space, slowing down as you get close to something.
 * You can't fly further than MAX_DISTANCE from the Sun.
 */
export function FlyCamera({ bodies, year }: Props) {
  const camera = useThree((s) => s.camera)
  const canvas = useThree((s) => s.gl.domElement)
  const keys = useRef(new Set<string>()) // keys held down right now, like "KeyW" or "ShiftLeft"
  const move = useRef(new Vector3())
  const bodyPos = useRef(new Vector3())

  // ---- Mouse and keyboard ----
  useEffect(() => {
    const held = keys.current
    camera.lookAt(0, 0, 0) // start out looking at the Sun

    const look = new Euler(0, 0, 0, 'YXZ') // turn left/right (y) first, then up/down (x)
    let dragging = false
    let lastX = 0
    let lastY = 0

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return // left button only
      dragging = true
      lastX = e.clientX
      lastY = e.clientY
      look.setFromQuaternion(camera.quaternion) // carry on from wherever the camera points now
    }
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return
      if ((e.buttons & 1) === 0) {
        dragging = false // the button was let go outside the window
        return
      }
      look.y -= (e.clientX - lastX) * LOOK_SPEED // drag right → look right
      look.x -= (e.clientY - lastY) * LOOK_SPEED // drag up → look up
      look.x = Math.max(-1.55, Math.min(1.55, look.x)) // stop just short of straight up/down
      look.z = 0 // never tilt sideways
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
    const releaseAll = () => {
      held.clear() // e.g. alt-tab while holding W: otherwise you'd keep flying
      dragging = false
    }
    const noMenu = (e: MouseEvent) => e.preventDefault() // right click: no browser menu

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('contextmenu', noMenu)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', releaseAll)
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('contextmenu', noMenu)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', releaseAll)
    }
  }, [camera, canvas])

  // ---- Flying, every frame ----
  useFrame((_, delta) => {
    const held = keys.current
    // In the camera's own frame: x = right, z = backwards (a camera looks along -z)
    move.current.set(
      (held.has('KeyD') ? 1 : 0) - (held.has('KeyA') ? 1 : 0),
      0,
      (held.has('KeyS') ? 1 : 0) - (held.has('KeyW') ? 1 : 0),
    )
    if (move.current.lengthSq() === 0) return

    // Distance to the nearest surface, where things are DRAWN (bigger planets, stretched Moon orbit).
    // The Sun sits at the origin, so it counts even before data loads.
    const { simTimeMs, planetSize } = useSimStore.getState()
    const moonOrbit = moonOrbitScale(planetSize)
    let nearest = camera.position.length()
    for (const b of bodies ?? []) {
      const samples = year?.bodies[b.id]?.samples
      if (samples) {
        drawnPositionAt(samples, parentSamplesOf(year, b.id), simTimeMs, moonOrbit, bodyPos.current)
      } else if (b.id === 'sun') {
        bodyPos.current.set(0, 0, 0)
      } else {
        continue // this body's positions aren't loaded yet
      }
      const surface =
        camera.position.distanceTo(bodyPos.current) - radiusToUnits(b.radius_km, b.id, planetSize)
      nearest = Math.min(nearest, surface)
    }

    // Speed depends on the nearest surface, but never above MAX_SPEED
    let speed = Math.min(Math.max(nearest, MIN_DISTANCE) * MOVE_SPEED, MAX_SPEED)
    if (held.has('ShiftLeft') || held.has('ShiftRight')) speed *= BOOST

    // Turn "forward / right" into the direction the camera faces, then take this frame's step.
    // delta is capped so a slow frame (or coming back to the tab) doesn't throw you across space.
    move.current.normalize().applyQuaternion(camera.quaternion)
    camera.position.addScaledVector(move.current, speed * Math.min(delta, 0.1))

    // Invisible wall: if this step took us past MAX_DISTANCE from the Sun (at 0,0,0),
    // pull the camera straight back onto the wall. Only the outward part of the move is undone,
    // so flying at an angle slides you along the wall instead of stopping you dead.
    if (camera.position.length() > MAX_DISTANCE) camera.position.setLength(MAX_DISTANCE)
  })

  return null
}

/** True while the user types in a text field: then W/A/S/D are letters, not flying. */
function isTyping(e: KeyboardEvent) {
  const el = e.target as HTMLElement
  if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true
  if (el.tagName !== 'INPUT') return false
  const type = (el as HTMLInputElement).type
  return !['checkbox', 'radio', 'button', 'range'].includes(type) // a ticked checkbox is fine
}
