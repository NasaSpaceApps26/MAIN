import { moonHeight, terrainDataset, terrainReady } from './EarthMoon/moonTerrain'
import { Suspense, useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { Vector3, type Group } from 'three'
import type { Body, StateSample } from '../../api/types'
import { useSimStore } from '../../store/simStore'
import { LaunchSites } from './LaunchSites'
import { positionAt } from './orbitMath'
import { radiusToUnits } from './scale'

const labelStyle = {
  transform: 'translate(-50%, 4px)', // centred, just under the point it's attached to
  padding: '1px 6px',
  border: '1px solid var(--line)',
  borderRadius: 4,
  background: 'var(--bar-bottom)', // solid: nothing shows through the label
  color: 'var(--text)',
  fontSize: 12,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
} as const

// Where every body is drawn right now, so a label can tell when another body is in front of it
const drawnBodies = new Map<string, { center: Vector3; radius: number }>()
const UP = new Vector3(0, 1, 0)
const toTarget = new Vector3()
const toOther = new Vector3()

/** True when another body covers `target` as seen from the camera */
function isBehindAnotherBody(id: string, target: Vector3, cameraPosition: Vector3) {
  toTarget.subVectors(target, cameraPosition)
  const distance = toTarget.length()
  toTarget.divideScalar(distance) // the line of sight, as a direction
  for (const [otherId, other] of drawnBodies) {
    if (otherId === id) continue
    toOther.subVectors(other.center, cameraPosition)
    const along = toOther.dot(toTarget) // how far along the line of sight the other body is
    if (along <= 0 || along >= distance) continue // behind the camera, or beyond the target
    // Closest the line of sight gets to the other body's centre: inside its radius = covered
    if (toOther.lengthSq() - along * along < other.radius ** 2) return true
  }
  return false
}

type Props = {
  body: Body
  // Daily positions from Horizons. The Sun has none: it stays at the origin.
  samples?: StateSample[]
  // Positions of the planet this body goes around (Earth for the Moon), else nothing
  parentSamples?: StateSample[]
}

export function CelestialBody({ body, samples, parentSamples }: Props) {
  const group = useRef<Group>(null)
  const spin = useRef<Group>(null) // turns around the body's axis
  const labelAnchor = useRef<Group>(null) // where the name label hangs
  const label = useRef<HTMLButtonElement>(null)
  const selectBody = useSimStore((s) => s.selectBody)
  const radius = radiusToUnits(body.radius_km, body.id)

  // Real shape: wider at the equator than pole to pole (Saturn ~10%, Jupiter ~6.5%)
  const radius = radiusToUnits(body.radius_km, body.id, planetSize)
  const flattening = body.id === 'moon' ? 0 : body.flattening
  const { equatorial, polar } = spheroidRadii(radius, flattening)
  const shape: Shape = [equatorial, polar, equatorial]
  const glows = body.id === 'sun' // the Sun makes its own light

  // Forget this body's place when it goes away
  useEffect(() => () => void drawnBodies.delete(body.id), [body.id])

  useFrame(({ camera }) => {
    const t = useSimStore.getState().simTimeMs
    if (group.current && samples) {
      drawnPositionAt(samples, parentSamples, t, moonOrbitScale(planetSize), group.current.position)
    }
    if (spin.current) {
      const hours = t / 3_600_000
      spin.current.rotation.y = (hours / body.rotation_period_h) * Math.PI * 2
    }

    // Tell the other labels where this body is
    let drawn = drawnBodies.get(body.id)
    if (!drawn) {
      drawn = { center: new Vector3(), radius: 0 }
      drawnBodies.set(body.id, drawn)
    }
    if (group.current) drawn.center.copy(group.current.position)
    drawn.radius = equatorial

    // The label hangs just under the body as you see it: one radius in the camera's "down"
    // direction from the centre, so it stays under the body however the camera is turned
    const down = -equatorial
    labelAnchor.current?.position.copy(UP).applyQuaternion(camera.quaternion).multiplyScalar(down)
    // ...and disappears while another body is in front of this one
    if (label.current) {
      const hidden = isBehindAnotherBody(body.id, drawn.center, camera.position)
      label.current.style.visibility = hidden ? 'hidden' : 'visible'
    }
  })

  // One flat color: used while a texture is still loading
  const plainSurface = <PlainSurface shape={shape} color={body.color} glows={glows} />

  return (
    <group ref={group}>
      <group
        ref={spin}
        onClick={(e) => {
          e.stopPropagation()
          selectBody(body.id)
          if (body.id === 'moon' && e.shiftKey && e.delta < 5 && terrainReady() && spin.current) {
            const object = e.object as typeof e.object & { geometry?: { userData: { surfaceTriangles?: number } } }
            const surfaceTriangles = object.geometry?.userData.surfaceTriangles
            if (surfaceTriangles !== undefined && (e.faceIndex ?? 0) >= surfaceTriangles) return
            const local = spin.current.worldToLocal(e.point.clone())
            const latDeg = Math.atan2(local.y, Math.hypot(local.x, local.z)) * 180 / Math.PI
            const lonDeg = Math.atan2(-local.z, local.x) * 180 / Math.PI
            useSimStore.getState().setMoonPoint({
              latDeg, lonDeg, elevationM: moonHeight(latDeg, lonDeg), datasetId: terrainDataset(),
            })
          }
        }}
      >
        <sphereGeometry args={[radius, 48, 48]} />
        {body.id === 'sun' ? (
          <meshBasicMaterial color={body.color} />
        ) : (
          plainSurface
        )}
        {/* Launch sites on Earth, landing sites on the Moon. Inside `spin`, so they turn with the surface. */}
        {(body.id === 'earth' || body.id === 'moon') && (
          <SiteMarkers bodyId={body.id} equatorialRadius={equatorial} flattening={flattening} />
        )}
        {body.id === 'earth' && <LaunchSites radius={radius} />}
      </mesh>
      {/* At true scale planets are smaller than a pixel, so a clickable label marks each one */}
      <group ref={labelAnchor}>
        <Html zIndexRange={[0, 0]}>
          <button ref={label} style={labelStyle} onClick={() => selectBody(body.id)}>
            {body.name}
          </button>
        </Html>
      </group>
    </group>
  )
}
