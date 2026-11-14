/** Sky, clouds, ocean, terrain, trees and rocks. */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BackSide, Color, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, PlaneGeometry, SphereGeometry } from 'three'
import { Instanced, type Item } from './basics'
import { COLORS, LEAF_GREENS, SCRUB_GREENS } from './colors'
import { pick, rng, smoothstep, type V3 } from './lib'

/** Sky dome: haze colour at the horizon (same as the fog, so the far ground melts into it), blue overhead. */
function SkyDome({ zenith, horizon }: { zenith: string; horizon: string }) {
  const geometry = useMemo(() => {
    const g = new SphereGeometry(1000, 32, 16)
    const pos = g.attributes.position
    const colors = new Float32Array(pos.count * 3)
    const top = new Color(zenith)
    const bottom = new Color(horizon)
    const c = new Color()
    for (let i = 0; i < pos.count; i++) {
      const up = Math.max(0, pos.getY(i) / 1000)
      c.copy(bottom).lerp(top, Math.pow(up, 0.45))
      colors.set([c.r, c.g, c.b], i * 3)
    }
    g.setAttribute('color', new Float32BufferAttribute(colors, 3))
    return g
  }, [zenith, horizon])
  return (
    <mesh geometry={geometry} renderOrder={-1}>
      <meshBasicMaterial vertexColors side={BackSide} fog={false} depthWrite={false} toneMapped={false} />
    </mesh>
  )
}

/** Sky and matching haze so the far ground fades out. */
export function Atmosphere({ haze = '#c9d9e6', zenith = '#5b95cf', fogNear = 60, fogFar = 190 }: { haze?: string; zenith?: string; fogNear?: number; fogFar?: number }) {
  return (
    <>
      <color attach="background" args={[haze]} />
      <fog attach="fog" args={[haze, fogNear, fogFar]} />
      <SkyDome zenith={zenith} horizon={haze} />
    </>
  )
}

/** Puffy low-poly clouds drifting slowly across the sky. */
export function Clouds({ count = 8, area = 160, height = 85, seed = 7 }: { count?: number; area?: number; height?: number; seed?: number }) {
  const group = useRef<Group>(null)
  const puffs = useMemo(() => {
    const rand = rng(seed)
    const items: Item[] = []
    for (let c = 0; c < count; c++) {
      const cx = (rand() - 0.5) * area
      const cz = (rand() - 0.5) * area
      const cy = height + rand() * 8
      const n = 5 + Math.floor(rand() * 6)
      for (let i = 0; i < n; i++) {
        const s = 2 + rand() * 3
        items.push({ p: [cx + (rand() - 0.5) * 10, cy + (rand() - 0.3) * 2, cz + (rand() - 0.5) * 5], s: [s * 1.3, s * 0.75, s] })
      }
    }
    return items
  }, [count, area, height, seed])
  useFrame((_, dt) => {
    const g = group.current
    if (!g) return
    g.position.x += dt * 0.6
    if (g.position.x > area / 2) g.position.x -= area
  })
  return (
    <group ref={group}>
      <Instanced items={puffs} color="#ffffff" roughness={1} flatShading shadows={false} emissive="#ffffff" emissiveIntensity={0.25}>
        <icosahedronGeometry args={[1, 1]} />
      </Instanced>
    </group>
  )
}

/**
 * Ocean surface with gentle animated swell. Waves die down toward the shore edge (`shore`) over
 * `calmWidth`, so the water line on the beach stays still instead of sliding through the sand.
 */
export function Ocean({
  size = [200, 200],
  position = [0, -0.12, 0],
  color = COLORS.ocean,
  segments = 90,
  amplitude = 0.07,
  shore,
  calmWidth = 12,
}: {
  size?: [number, number]
  position?: V3
  color?: string
  segments?: number
  amplitude?: number
  shore?: 'west' | 'east' // edge of the plane that touches the land
  calmWidth?: number
}) {
  const mesh = useRef<Mesh>(null)
  const { geometry, calm } = useMemo(() => {
    const g = new PlaneGeometry(size[0], size[1], segments, Math.round((segments * size[1]) / size[0]))
    const pos = g.attributes.position
    const calm = new Float32Array(pos.count)
    for (let i = 0; i < pos.count; i++) {
      const fromWest = pos.getX(i) + size[0] / 2
      const fromShore = shore === 'west' ? fromWest : shore === 'east' ? size[0] - fromWest : Infinity
      calm[i] = smoothstep(0, calmWidth, fromShore)
    }
    return { geometry: g, calm }
  }, [size, segments, shore, calmWidth])
  useFrame(({ clock }) => {
    const g = mesh.current?.geometry
    if (!g) return
    const t = clock.elapsedTime
    const pos = g.attributes.position
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const y = pos.getY(i)
      pos.setZ(i, calm[i] * amplitude * (Math.sin(x * 0.35 + t * 0.9) + 0.6 * Math.sin(y * 0.27 - t * 1.2) + 0.3 * Math.sin((x + y) * 0.8 + t * 1.7)))
    }
    pos.needsUpdate = true
    g.computeVertexNormals()
  })
  return (
    <mesh ref={mesh} geometry={geometry} position={position} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <meshStandardMaterial color={color} roughness={0.12} metalness={0.25} flatShading />
    </mesh>
  )
}

/** Line of white surf along a straight north-south beach at x, pulsing slowly. */
export function Surf({ x, z0, z1, y = 0 }: { x: number; z0: number; z1: number; y?: number }) {
  const mat = useRef<MeshStandardMaterial>(null)
  useFrame(({ clock }) => {
    if (mat.current) mat.current.opacity = 0.45 + 0.3 * Math.sin(clock.elapsedTime * 1.3)
  })
  return (
    <mesh position={[x, y, (z0 + z1) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[0.9, z1 - z0]} />
      <meshStandardMaterial ref={mat} color="#f4f8fa" transparent opacity={0.6} roughness={0.6} depthWrite={false} />
    </mesh>
  )
}

/**
 * Low-poly terrain from a height function h(x, z) in world units.
 * `colorAt` picks a colour per vertex (sand by the water, grass on the hills...).
 */
export function Terrain({
  size,
  segments = 100,
  height,
  colorAt,
  color = COLORS.grass,
}: {
  size: [number, number]
  segments?: number
  height: (x: number, z: number) => number
  colorAt?: (x: number, z: number, h: number) => string
  color?: string
}) {
  const geometry = useMemo(() => {
    const g = new PlaneGeometry(size[0], size[1], segments, Math.round((segments * size[1]) / size[0]))
    const pos = g.attributes.position
    const colors = new Float32Array(pos.count * 3)
    const c = new Color()
    for (let i = 0; i < pos.count; i++) {
      // The plane lies in XY and is turned to lie flat, so local (x, y) becomes world (x, -y)
      const x = pos.getX(i)
      const z = -pos.getY(i)
      const h = height(x, z)
      pos.setZ(i, h)
      c.set(colorAt ? colorAt(x, z, h) : color)
      colors.set([c.r, c.g, c.b], i * 3)
    }
    g.setAttribute('color', new Float32BufferAttribute(colors, 3))
    g.computeVertexNormals()
    return g
  }, [size, segments, height, colorAt, color])
  return (
    <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} receiveShadow castShadow>
      <meshStandardMaterial vertexColors roughness={1} flatShading />
    </mesh>
  )
}

export type TreeKind = 'palm' | 'oak' | 'pine' | 'shrub'

/**
 * Trees at the given (x, z) points. `ground` gives the ground height there (flat ground by default).
 * Palms get drooping fronds, oaks round canopies, pines stacked cones, shrubs low bushes.
 */
export function Trees({ points, kind, seed = 1, scale = 1, ground = () => 0 }: { points: [number, number][]; kind: TreeKind; seed?: number; scale?: number; ground?: (x: number, z: number) => number }) {
  const { trunks, crowns, fronds } = useMemo(() => {
    const rand = rng(seed)
    const trunks: Item[] = []
    const crowns: Item[] = []
    const fronds: Item[] = []
    for (const [x, z] of points) {
      const g = ground(x, z)
      const s = scale * (0.75 + rand() * 0.5)
      if (kind === 'palm') {
        const h = 2.2 * s
        const lean = (rand() - 0.5) * 0.15
        trunks.push({ p: [x, g + h / 2, z], s: [0.07 * s, h, 0.07 * s], r: [lean, 0, lean] })
        // trunk tilted by Rz then Rx (Euler XYZ): its top moves to -x and +z
        const top: V3 = [x - (Math.sin(lean) * h) / 2, g + h / 2 + (Math.cos(lean) ** 2 * h) / 2, z + (Math.cos(lean) * Math.sin(lean) * h) / 2]
        const n = 7
        const L = 0.9 * s
        for (let k = 0; k < n; k++) {
          const yaw = (k / n) * Math.PI * 2 + rand() * 0.4
          const droop = 0.35 + rand() * 0.35
          const dx = Math.cos(droop) * Math.cos(yaw)
          const dy = -Math.sin(droop)
          const dz = -Math.cos(droop) * Math.sin(yaw)
          fronds.push({ p: [top[0] + (dx * L) / 2, top[1] + (dy * L) / 2, top[2] + (dz * L) / 2], s: [L, 0.03, 0.22 * s], r: [0, yaw, -droop], c: pick(rand, LEAF_GREENS) })
        }
      } else if (kind === 'oak') {
        const h = 0.9 * s
        trunks.push({ p: [x, g + h / 2, z], s: [0.09 * s, h, 0.09 * s] })
        const blobs = 2 + Math.floor(rand() * 2)
        for (let k = 0; k < blobs; k++) {
          const r = (0.55 + rand() * 0.35) * s
          crowns.push({ p: [x + (rand() - 0.5) * 0.6 * s, g + h + r * 0.6, z + (rand() - 0.5) * 0.6 * s], s: [r * 1.2, r * 0.85, r * 1.2], c: pick(rand, LEAF_GREENS) })
        }
      } else if (kind === 'pine') {
        const h = 0.6 * s
        trunks.push({ p: [x, g + h / 2, z], s: [0.07 * s, h, 0.07 * s] })
        const c = pick(rand, ['#2f5a34', '#35633a', '#2c5230'])
        crowns.push({ p: [x, g + h + 0.8 * s, z], s: [0.6 * s, 1.6 * s, 0.6 * s], c })
        crowns.push({ p: [x, g + h + 1.6 * s, z], s: [0.42 * s, 1.1 * s, 0.42 * s], c })
      } else {
        const r = (0.3 + rand() * 0.3) * s
        crowns.push({ p: [x, g + r * 0.4, z], s: [r * 1.3, r * 0.8, r * 1.3], c: pick(rand, SCRUB_GREENS) })
      }
    }
    return { trunks, crowns, fronds }
  }, [points, kind, seed, scale, ground])

  return (
    <>
      <Instanced items={trunks} color={COLORS.trunk} roughness={1}>
        <cylinderGeometry args={[0.7, 1, 1, 6]} />
      </Instanced>
      {kind === 'pine' ? (
        <Instanced items={crowns} roughness={1} flatShading>
          <coneGeometry args={[1, 1, 7]} />
        </Instanced>
      ) : (
        <Instanced items={crowns} roughness={1} flatShading>
          <icosahedronGeometry args={[1, 0]} />
        </Instanced>
      )}
      <Instanced items={fronds} roughness={0.9}>
        <boxGeometry />
      </Instanced>
    </>
  )
}

/** Boulders at the given points (e.g. along a sea wall or at the foot of a cliff). */
export function Rocks({ points, seed = 3, scale = 1, y = 0, color = '#8a8478' }: { points: [number, number][]; seed?: number; scale?: number; y?: number; color?: string }) {
  const items = useMemo(() => {
    const rand = rng(seed)
    return points.map(([x, z]): Item => {
      const s = scale * (0.4 + rand() * 0.7)
      return { p: [x, y + s * 0.2, z], s: [s, s * 0.7, s * (0.8 + rand() * 0.4)], r: [rand() * 3, rand() * 3, rand() * 3], c: rand() > 0.5 ? color : '#9a9488' }
    })
  }, [points, seed, scale, y, color])
  return (
    <Instanced items={items} roughness={1} flatShading>
      <dodecahedronGeometry args={[1, 0]} />
    </Instanced>
  )
}
