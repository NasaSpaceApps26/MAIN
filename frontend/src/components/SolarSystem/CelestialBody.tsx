import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import type { Group, Mesh } from 'three'
import type { Body, StateSample } from '../../api/types'
import { useSimStore } from '../../store/simStore'
import { LaunchSites } from './LaunchSites'
import { positionAt } from './orbitMath'
import { radiusToUnits } from './scale'

const OBLIQUITY = (23.439291111 * Math.PI) / 180

/** Earth rotation angle (IAU 2000) at Unix time `ms`: Greenwich meridian's angle from the equinox. */
function earthRotationAngle(ms: number) {
  const d = ms / 86_400_000 + 2440587.5 - 2451545.0 // days from J2000
  const turns = 0.779057273264 + 0.00273781191135448 * d + (d % 1)
  return 2 * Math.PI * (turns % 1)
}

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
}

export function CelestialBody({ body, samples }: Props) {
  const group = useRef<Group>(null)
  const mesh = useRef<Mesh>(null)
  const selectBody = useSimStore((s) => s.selectBody)
  const radius = radiusToUnits(body.radius_km, body.id)

  useFrame(() => {
    const t = useSimStore.getState().simTimeMs
    if (group.current && samples) positionAt(samples, t, group.current.position)
    if (mesh.current) {
      if (body.id === 'earth') {
        // real orientation: axis tilted toward the ecliptic, turned by the Earth rotation angle,
        // so the launch-site dots sit where the mission simulation launches from
        mesh.current.rotation.set(-OBLIQUITY, earthRotationAngle(t), 0)
      } else {
        const hours = t / 3_600_000
        mesh.current.rotation.y = (hours / body.rotation_period_h) * Math.PI * 2
      }
    }
  })

  return (
    <group ref={group}>
      <mesh
        ref={mesh}
        onClick={(e) => {
          e.stopPropagation()
          selectBody(body.id)
        }}
      >
        <sphereGeometry args={[radius, 48, 48]} />
        {body.id === 'sun' ? (
          <meshBasicMaterial color={body.color} />
        ) : (
          <meshStandardMaterial color={body.color} />
        )}
        {body.id === 'earth' && <LaunchSites radius={radius} />}
      </mesh>
      {/* At true scale planets are smaller than a pixel, so a clickable label marks each one */}
      <Html zIndexRange={[0, 0]}>
        <button style={labelStyle} onClick={() => selectBody(body.id)}>
          {body.name}
        </button>
      </Html>
    </group>
  )
}
