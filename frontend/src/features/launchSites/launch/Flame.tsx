import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { AdditiveBlending, ConeGeometry, Group, SphereGeometry } from 'three'
import type { V3 } from '../models/lib'
import { FLAME_LOOK, type Burn, type FlameKind } from './flameLook'

/** Unit cone hanging down: base (the nozzle exit) at y = 0, tip at y = -1. */
const coneGeometry = new ConeGeometry(1, 1, 18, 1, true)
coneGeometry.rotateX(Math.PI)
coneGeometry.translate(0, -0.5, 0)
const glowGeometry = new SphereGeometry(1, 16, 10)

/**
 * Rocket exhaust: three nested glowing cones and a glow at the nozzle, flickering.
 * `radius` is the plume width at the nozzle; it widens and lengthens as `burn.expand` grows (thinner air).
 */
export function Flame({
  position = [0, 0, 0],
  radius,
  kind,
  burn,
}: {
  position?: V3
  radius: number
  kind: FlameKind
  burn: Burn
}) {
  const group = useRef<Group>(null)
  const core = useRef<Group>(null)
  const look = FLAME_LOOK[kind]
  useFrame(({ clock }) => {
    const g = group.current
    if (!g) return
    const k = burn.throttle
    g.visible = k > 0.01
    if (!g.visible) return
    const t = clock.elapsedTime
    const flicker =
      1 + 0.08 * Math.sin(t * 61) + 0.06 * Math.sin(t * 37 + 1) + 0.05 * (Math.random() - 0.5)
    const w = radius * (1 + burn.expand * 1.6) * (0.4 + 0.6 * k)
    const len = radius * look.length * (1 + burn.expand * 0.9) * k * flicker
    g.scale.set(w, len, w)
    core.current?.scale.set(0.45, 0.42 + 0.05 * Math.sin(t * 83), 0.45)
  })
  return (
    <group position={position}>
      <group ref={group} visible={false}>
        {[0, 1].map((i) => (
          <mesh
            key={i}
            geometry={coneGeometry}
            scale={i === 0 ? [1, 1, 1] : [0.72, 0.78, 0.72]}
            renderOrder={2}
          >
            <meshBasicMaterial
              color={look.colors[i]}
              transparent
              opacity={look.opacity[i]}
              blending={AdditiveBlending}
              depthWrite={false}
              fog={false}
              toneMapped={false}
            />
          </mesh>
        ))}
        <group ref={core}>
          <mesh geometry={coneGeometry} renderOrder={2}>
            <meshBasicMaterial
              color={look.colors[2]}
              transparent
              opacity={look.opacity[2]}
              blending={AdditiveBlending}
              depthWrite={false}
              fog={false}
              toneMapped={false}
            />
          </mesh>
        </group>
        <mesh
          geometry={glowGeometry}
          scale={[1.25, 0.12, 1.25]}
          position={[0, -0.04, 0]}
          renderOrder={2}
          visible={kind !== 'vacuum'}
        >
          <meshBasicMaterial
            color={look.colors[1]}
            transparent
            opacity={0.55}
            blending={AdditiveBlending}
            depthWrite={false}
            fog={false}
            toneMapped={false}
          />
        </mesh>
      </group>
    </group>
  )
}
