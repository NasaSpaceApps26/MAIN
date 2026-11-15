import { useRef, type ReactNode } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { PerspectiveCamera, Vector3 } from 'three'
import type { Body, EphemerisYear } from '../../api/types'
import { useSimStore, type CameraView } from '../../store/simStore'
import { drawnPositionAt } from './orbitMath'
import { moonOrbitScale, radiusToUnits } from './scale'
import styles from './CameraViews.module.css'

/** Straight above the Sun, high enough to see Neptune's whole orbit (1 unit = 1 million km) */
const TOP_POSITION = new Vector3(0, 11_000, 230) // the small z keeps "up" from pointing straight at the Sun
/** Above and to the side of the ecliptic: all orbits seen as tilted ellipses */
const ANGLED_POSITION = new Vector3(0, 2_800, 7_400)

const UP = new Vector3(0, 1, 0)

type Props = { bodies: Body[]; year: EphemerisYear }

/**
 * Inside the <Canvas>: when a view button was pressed, moves the camera there.
 *  - Top and Angled: deselect any body, place the camera, look at the Sun.
 *  - Earth & Moon: select Earth (so the camera travels with it, see CameraFollow), then place the
 *    camera beside the Earth–Moon line, on the Sun side so both are lit, far enough to see both.
 */
export function CameraViewDriver({ bodies, year }: Props) {
  const camera = useThree((s) => s.camera)
  const done = useRef(0) // number of the last request carried out
  const waitFrames = useRef(0)
  const earth = useRef(new Vector3())
  const moon = useRef(new Vector3())
  const mid = useRef(new Vector3())
  const side = useRef(new Vector3())

  useFrame(() => {
    const { cameraRequest, selectedBodyId, selectBody, simTimeMs, planetSize } = useSimStore.getState()
    if (!cameraRequest || cameraRequest.n === done.current) return

    if (cameraRequest.view !== 'earthMoon') {
      if (selectedBodyId !== null) selectBody(null) // stop following a body
      camera.position.copy(cameraRequest.view === 'top' ? TOP_POSITION : ANGLED_POSITION)
      camera.lookAt(0, 0, 0)
      done.current = cameraRequest.n
      return
    }

    // Select Earth first. CameraFollow then jumps to it on the next frame; we wait one frame
    // longer so our position comes after that jump instead of being replaced by it.
    if (selectedBodyId !== 'earth') {
      selectBody('earth')
      waitFrames.current = 1
      return
    }
    if (waitFrames.current > 0) {
      waitFrames.current--
      return
    }
    done.current = cameraRequest.n

    const earthBody = bodies.find((b) => b.id === 'earth')
    const moonBody = bodies.find((b) => b.id === 'moon')
    const earthSamples = year.bodies.earth?.samples
    const moonSamples = year.bodies.moon?.samples
    if (!earthBody || !moonBody || !earthSamples || !moonSamples) return

    drawnPositionAt(earthSamples, undefined, simTimeMs, 1, earth.current)
    drawnPositionAt(moonSamples, earthSamples, simTimeMs, moonOrbitScale(planetSize), moon.current)
    const earthRadius = radiusToUnits(earthBody.radius_km, 'earth', planetSize)
    const moonRadius = radiusToUnits(moonBody.radius_km, 'moon', planetSize)

    mid.current.addVectors(earth.current, moon.current).multiplyScalar(0.5)
    const separation = earth.current.distanceTo(moon.current)

    // Sideways from the Earth–Moon line, on the side facing the Sun, and a bit from above
    side.current.subVectors(moon.current, earth.current).cross(UP).normalize()
    if (side.current.dot(earth.current) > 0) side.current.negate() // the Sun is at (0, 0, 0)
    side.current.addScaledVector(UP, 0.35).normalize()

    // Far enough that both bodies fit across the screen, and Earth fits top to bottom
    const halfHeight = ((camera as PerspectiveCamera).fov ?? 50) / 2 * (Math.PI / 180)
    const aspect = (camera as PerspectiveCamera).aspect ?? 16 / 9
    const halfWidth = Math.atan(Math.tan(halfHeight) * aspect)
    const across = separation / 2 + Math.max(earthRadius, moonRadius)
    const distance = Math.max(
      (across * 1.5) / Math.tan(halfWidth),
      (earthRadius * 1.5) / Math.tan(halfHeight),
    )

    camera.position.copy(mid.current).addScaledVector(side.current, distance)
    camera.lookAt(mid.current)
  })

  return null
}

const VIEWS: { view: CameraView; title: string; icon: ReactNode }[] = [
  {
    view: 'top',
    title: 'Solar System from above',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="12" r="9.5" />
        <circle cx="12" cy="12" r="5.5" />
        <circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    view: 'angled',
    title: 'Solar System from the side',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5">
        <ellipse cx="12" cy="12" rx="10" ry="4" />
        <ellipse cx="12" cy="12" rx="5.5" ry="2" />
        <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    view: 'earthMoon',
    title: 'Earth and Moon',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="8" cy="14" r="5.5" />
        <circle cx="18.5" cy="7" r="2.5" />
      </svg>
    ),
  },
]

/** Outside the <Canvas>: the small square buttons in the top-right corner of the space view */
export function CameraViewButtons() {
  const requestCameraView = useSimStore((s) => s.requestCameraView)
  return (
    <div className={styles.views}>
      {VIEWS.map(({ view, title, icon }) => (
        <button
          key={view}
          type="button"
          className={styles.view}
          title={title}
          aria-label={title}
          onClick={(e) => {
            requestCameraView(view)
            e.currentTarget.blur() // so W/A/S/D and Space go back to flying, not to this button
          }}
        >
          {icon}
        </button>
      ))}
    </div>
  )
}
