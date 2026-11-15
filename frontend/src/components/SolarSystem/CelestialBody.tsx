import { moonHeight, terrainDataset, terrainReady } from './EarthMoon/moonTerrain'
import { Suspense, useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { Vector3, type Group } from 'three'
import type { Body, StateSample } from '../../api/types'
import { useSimStore } from '../../store/simStore'
import { TEXTURE_IDS } from './bodyTextures'
import { TiledSurface } from './EarthMoon/TiledSurface'
import { LaunchSites } from './LaunchSites' // <-- kropki
import { drawnPositionAt } from './orbitMath'
import { PlainSurface, TexturedSurface } from './PlanetSurface'
import { moonOrbitScale, radiusToUnits, spheroidRadii, type Shape } from './scale'
import { SiteMarkers } from './SiteMarkers'

const OBLIQUITY = (23.439291111 * Math.PI) / 180

/** Earth rotation angle (IAU 2000) at Unix time `ms`: Greenwich meridian's angle from the equinox. */
function earthRotationAngle(ms: number) {
  const d = ms / 86_400_000 + 2440587.5 - 2451545.0 // days from J2000
  const turns = 0.779057273264 + 0.00273781191135448 * d + (d % 1)
  return 2 * Math.PI * (turns % 1)
}

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
  const planetSize = useSimStore((s) => s.planetSize)

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
      if (body.id === 'earth') {
        // real orientation: axis tilted toward the ecliptic, turned by the Earth rotation angle,
        // so the launch-site dots sit where the mission simulation launches from
        spin.current.rotation.set(-OBLIQUITY, earthRotationAngle(t), 0)
      } else {
        const hours = t / 3_600_000
        spin.current.rotation.y = (hours / body.rotation_period_h) * Math.PI * 2
      }
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
          const sim = useSimStore.getState()
          // "Pick on Moon" mode (MissionPanel): a click on the Moon sets the landing point and does
          // nothing else, so the camera stays put. Drags (e.delta) are camera moves, not picks.
          if (body.id === 'moon' && sim.pickingLanding) {
            if (e.delta >= 5 || !terrainReady() || !spin.current) return
            const object = e.object as typeof e.object & { geometry?: { userData: { surfaceTriangles?: number } } }
            const surfaceTriangles = object.geometry?.userData.surfaceTriangles
            if (surfaceTriangles !== undefined && (e.faceIndex ?? 0) >= surfaceTriangles) return
            const local = spin.current.worldToLocal(e.point.clone())
            const latDeg = Math.atan2(local.y, Math.hypot(local.x, local.z)) * 180 / Math.PI
            const lonDeg = Math.atan2(-local.z, local.x) * 180 / Math.PI
            // into the active landing slot; siteId null = a point of your own, not one of the named sites
            sim.setLandingPoint({
              latDeg, lonDeg, elevationM: moonHeight(latDeg, lonDeg), datasetId: terrainDataset(), siteId: null,
            })
            sim.setPickingLanding(false) // one click, one point
            return
          }
          selectBody(body.id)
        }}
      >
        {body.id === 'earth' || body.id === 'moon' ? (
          // NASA imagery that gets sharper as the camera gets closer
          <TiledSurface
            bodyId={body.id}
            shape={shape}
            flattening={flattening}
            color={body.color}
          />
        ) : TEXTURE_IDS.has(body.id) ? (
          <Suspense fallback={plainSurface}>
            <TexturedSurface id={body.id} shape={shape} glows={glows} />
          </Suspense>
        ) : (
          plainSurface
        )}
        {/* Landing sites on the Moon. Inside `spin`, so they turn with the surface. */}
        {body.id === 'moon' && (
          <SiteMarkers bodyId="moon" equatorialRadius={equatorial} flattening={flattening} />
        )}
        {/* Launch sites on Earth: only the ones with a 3D model. Click a dot to choose it for the mission. */}
        {body.id === 'earth' && <LaunchSites radius={equatorial} />}
      </group>
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
