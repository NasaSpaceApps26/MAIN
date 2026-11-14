import { Suspense, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import type { Group } from 'three'
import type { Body, StateSample } from '../../api/types'
import { useSimStore } from '../../store/simStore'
import { TEXTURE_IDS } from './bodyTextures'
import { drawnPositionAt } from './orbitMath'
import { PlainSurface, TexturedSurface } from './PlanetSurface'
import { moonOrbitScale, radiusToUnits, spheroidRadii, type Shape } from './scale'
import { SiteMarkers } from './SiteMarkers'

const labelStyle = {
  transform: 'translate(8px, -50%)',
  padding: '1px 6px',
  border: '1px solid var(--line)',
  borderRadius: 4,
  background: 'var(--panel)',
  color: 'var(--text)',
  fontSize: 12,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
} as const

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
  const selectBody = useSimStore((s) => s.selectBody)
  const planetSize = useSimStore((s) => s.planetSize)

  // Real shape: wider at the equator than pole to pole (Saturn ~10%, Jupiter ~6.5%)
  const radius = radiusToUnits(body.radius_km, body.id, planetSize)
  const { equatorial, polar } = spheroidRadii(radius, body.flattening)
  const shape: Shape = [equatorial, polar, equatorial]
  const glows = body.id === 'sun' // the Sun makes its own light

  useFrame(() => {
    const t = useSimStore.getState().simTimeMs
    if (group.current && samples) {
      drawnPositionAt(samples, parentSamples, t, moonOrbitScale(planetSize), group.current.position)
    }
    if (spin.current) {
      const hours = t / 3_600_000
      spin.current.rotation.y = (hours / body.rotation_period_h) * Math.PI * 2
    }
  })

  // One flat color: used for Earth and the Moon, and while a texture is still loading
  const plainSurface = <PlainSurface shape={shape} color={body.color} glows={glows} />

  return (
    <group ref={group}>
      <group
        ref={spin}
        onClick={(e) => {
          e.stopPropagation()
          selectBody(body.id)
        }}
      >
        {TEXTURE_IDS.has(body.id) ? (
          <Suspense fallback={plainSurface}>
            <TexturedSurface id={body.id} shape={shape} glows={glows} />
          </Suspense>
        ) : (
          plainSurface
        )}
        {/* Launch sites on Earth, landing sites on the Moon. Inside `spin`, so they turn with the surface. */}
        {(body.id === 'earth' || body.id === 'moon') && (
          <SiteMarkers bodyId={body.id} equatorialRadius={equatorial} flattening={body.flattening} />
        )}
      </group>
      {/* At true scale planets are smaller than a pixel, so a clickable label marks each one */}
      <Html zIndexRange={[0, 0]}>
        <button style={labelStyle} onClick={() => selectBody(body.id)}>
          {body.name}
        </button>
      </Html>
    </group>
  )
}
