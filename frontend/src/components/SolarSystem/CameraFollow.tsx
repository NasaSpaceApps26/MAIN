import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Quaternion, Vector3 } from 'three'
import type { Body, EphemerisYear } from '../../api/types'
import { useSimStore } from '../../store/simStore'
import { rocketTracker } from '../../features/mission/missionStore'
import { followControl } from './followControl'
import { drawnPositionAt, parentSamplesOf, positionAt } from './orbitMath'
import { moonOrbitScale, radiusToUnits } from './scale'

/** The camera's distance from the rocket, in drawn radii of the body it is near. */
const ROCKET_VIEW_RADII = 0.55
/** Within this many drawn Moon radii the rocket is framed against the Moon instead of Earth. */
const MOON_ZONE_RADII = 2.5
/** Seconds the camera takes to swing into a new rocket view. */
const SWING_S = 1.6

const ECLIPTIC_NORTH = new Vector3(0, 1, 0)

type Props = { bodies: Body[]; year: EphemerisYear }

/**
 * Keeps the camera with the selected body while it moves along its orbit.
 * On a new selection (or when the planet size changes) the camera jumps to ~8 radii from the
 * body, looking at it. After that it travels along with the body, so W/A/S/D and the mouse work
 * as if the body stood still. Click empty space to deselect: the camera then stays where it is.
 *
 * The rocket ('rocket') gets its own view: the camera swings in close, from above and to the side,
 * so the rocket sits in the middle with the horizon of the body below it (Earth at liftoff, the
 * Moon once it gets there), then travels with it.
 */
export function CameraFollow({ bodies, year }: Props) {
  const camera = useThree((s) => s.camera)
  const jumpedTo = useRef<string | null>(null) // e.g. "earth:25": body + size we last jumped to
  const bodyPos = useRef(new Vector3())
  const lastBodyPos = useRef(new Vector3())
  const step = useRef(new Vector3())
  // rocket view: the camera's offset from the rocket swings from `from` to `to` over SWING_S
  const swing = useRef<{ from: Vector3; to: Vector3; t: number } | null>(null)
  const v = useRef({
    earth: new Vector3(),
    moon: new Vector3(),
    out: new Vector3(),
    side: new Vector3(),
    up: new Vector3(), // from the centre of the body the rocket is near, through the rocket
    lastUp: new Vector3(),
    turn: new Quaternion(),
  })
  const earthKm = bodies.find((b) => b.id === 'earth')?.radius_km ?? 6371
  const moonKm = bodies.find((b) => b.id === 'moon')?.radius_km ?? 1737.4

  useFrame((_, dt) => {
    const { selectedBodyId, simTimeMs, planetSize } = useSimStore.getState()

    // Rocket view: frame it against the body it is near; swing in on a new view, then travel along
    const earthSamples = year.bodies.earth?.samples
    if (selectedBodyId === 'rocket' && rocketTracker.active && earthSamples) {
      const { earth, moon, out, side, up, lastUp, turn } = v.current
      const rocket = rocketTracker.position
      const moonSamples = year.bodies.moon?.samples
      positionAt(earthSamples, simTimeMs, earth)
      const earthR = radiusToUnits(earthKm, 'earth', planetSize)
      const moonR = radiusToUnits(moonKm, 'moon', planetSize)
      let nearMoon = false
      if (moonSamples) {
        drawnPositionAt(moonSamples, parentSamplesOf(year, 'moon'), simTimeMs, moonOrbitScale(planetSize), moon)
        nearMoon = rocket.distanceTo(moon) < moonR * MOON_ZONE_RADII
      }

      up.subVectors(rocket, nearMoon ? moon : earth).normalize()
      const key = `rocket:${planetSize}:${nearMoon ? 'moon' : 'earth'}`
      if (jumpedTo.current !== key) {
        jumpedTo.current = key
        // Up from the body's centre through the rocket, plus sideways: the rocket in the middle of the
        // picture with the body's horizon below it, never the body between the camera and the rocket
        out.copy(up)
        side.crossVectors(out, ECLIPTIC_NORTH)
        if (side.lengthSq() < 1e-6) side.set(1, 0, 0)
        side.normalize()
        const to = new Vector3()
          .addScaledVector(out, 0.55)
          .addScaledVector(side, 0.8)
          .addScaledVector(ECLIPTIC_NORTH, 0.25)
          .normalize()
          .multiplyScalar((nearMoon ? moonR : earthR) * ROCKET_VIEW_RADII)
        swing.current = { from: camera.position.clone().sub(rocket), to, t: 0 }
      }

      const s = swing.current
      if (s) {
        // ease in and out; the length and the direction of the offset change separately, so a
        // swing from far away does not cut through the planet
        s.t = Math.min(s.t + dt / SWING_S, 1)
        const k = s.t * s.t * (3 - 2 * s.t)
        const length = Math.exp(Math.log(s.from.length() || 1e-9) * (1 - k) + Math.log(s.to.length()) * k)
        side.copy(s.to).normalize()
        out.copy(s.from).normalize().lerp(side, k)
        if (out.lengthSq() < 1e-6) out.copy(side) // straight across: go to the new side directly
        out.normalize()
        camera.position.copy(rocket).addScaledVector(out, length)
        camera.lookAt(rocket)
        if (s.t >= 1) swing.current = null
      } else {
        // Travel with the rocket, so the mouse and W/A/S/D work as if it stood still. As it goes round
        // the body (parking orbit, lunar orbit) the view turns with it, so the body stays below.
        turn.setFromUnitVectors(lastUp, up)
        step.current.subVectors(camera.position, lastBodyPos.current).applyQuaternion(turn)
        camera.position.copy(rocket).add(step.current)
        camera.quaternion.premultiply(turn)
      }
      lastBodyPos.current.copy(rocket)
      lastUp.copy(up)
      return
    }
    swing.current = null

    const body = bodies.find((b) => b.id === selectedBodyId)
    if (!body) {
      jumpedTo.current = null
      return
    }

    const samples = year.bodies[body.id]?.samples
    if (samples) {
      const parent = parentSamplesOf(year, body.id)
      drawnPositionAt(samples, parent, simTimeMs, moonOrbitScale(planetSize), bodyPos.current)
    } else {
      bodyPos.current.set(0, 0, 0) // the Sun
    }

    const key = `${body.id}:${planetSize}`
    if (jumpedTo.current !== key) {
      jumpedTo.current = key
      if (followControl.keepPositionFor === body.id) {
        // handed over by another camera move (the flight overview, see followControl): no jump,
        // the camera stays where it is and travels with the body from here
        followControl.keepPositionFor = null
      } else {
        // Jump: stay on the side of the body we're already on, ~8 radii away, and look at it
        step.current.subVectors(camera.position, bodyPos.current).normalize()
        if (step.current.lengthSq() === 0) step.current.set(0, 0.5, 1).normalize()
        const distance = radiusToUnits(body.radius_km, body.id, planetSize) * 8
        camera.position.copy(bodyPos.current).addScaledVector(step.current, distance)
        camera.lookAt(bodyPos.current)
      }
    } else {
      // Travel with the body: move the camera exactly as far as the body moved since last frame
      camera.position.add(step.current.subVectors(bodyPos.current, lastBodyPos.current))
    }
    lastBodyPos.current.copy(bodyPos.current)
  })

  return null
}
