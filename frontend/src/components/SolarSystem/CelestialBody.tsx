import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Mesh } from 'three'
import type { Body } from '../../api/types'
import { useSimStore } from '../../store/simStore'

const displayRadius = (km: number) => Math.max(0.3, Math.log10(km) - 2.5)

type Props = { body: Body; position: [number, number, number] }

export function CelestialBody({ body, position }: Props) {
  const ref = useRef<Mesh>(null)
  const selectBody = useSimStore((s) => s.selectBody)

  useFrame(() => {
    if (!ref.current) return
    const hours = useSimStore.getState().simTimeMs / 3_600_000
    ref.current.rotation.y = (hours / body.rotation_period_h) * Math.PI * 2
  })

  return (
    <mesh
      ref={ref}
      position={position}
      onClick={(e) => {
        e.stopPropagation()
        selectBody(body.id)
      }}
    >
      <sphereGeometry args={[displayRadius(body.radius_km), 48, 48]} />
      {body.id === 'sun' ? (
        <meshBasicMaterial color={body.color} />
      ) : (
        <meshStandardMaterial color={body.color} />
      )}
    </mesh>
  )
}
