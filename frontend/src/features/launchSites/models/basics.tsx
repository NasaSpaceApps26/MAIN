/**
 * Basic shapes for the launch site models. Simple geometry only, no textures or images.
 * Scale: about 1 unit = 10 m for buildings and rockets. Distances between pads are shortened.
 */
import { useMemo, type ReactNode } from 'react'
import { Instance, Instances } from '@react-three/drei'
import { Quaternion, Vector3, type Material } from 'three'
import { COLORS } from './colors'
import type { V3 } from './lib'

type Mat = { color: string; roughness?: number; metalness?: number; emissive?: string; emissiveIntensity?: number }

type BoxProps = Mat & { size: V3; position?: V3; rotation?: V3; shadows?: boolean }

/** Box centered on `position`. */
export function Box({ size, position = [0, 0, 0], rotation, color, roughness = 0.85, metalness = 0, emissive, emissiveIntensity, shadows = true }: BoxProps) {
  return (
    <mesh position={position} rotation={rotation} castShadow={shadows} receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={roughness} metalness={metalness} emissive={emissive} emissiveIntensity={emissiveIntensity} />
    </mesh>
  )
}

/** Box standing on the ground: `position` is the middle of its base. */
export function Building({ size, position = [0, 0, 0], ...rest }: BoxProps) {
  const [x, y, z] = position
  return <Box size={size} position={[x, y + size[1] / 2, z]} {...rest} />
}

type CylProps = Mat & {
  radius: number
  radiusTop?: number
  height: number
  position?: V3 // centre
  rotation?: V3
  segments?: number
}

export function Cylinder({ radius, radiusTop = radius, height, position = [0, 0, 0], rotation, segments = 20, color, roughness = 0.7, metalness = 0, emissive, emissiveIntensity }: CylProps) {
  return (
    <mesh position={position} rotation={rotation} castShadow receiveShadow>
      <cylinderGeometry args={[radiusTop, radius, height, segments]} />
      <meshStandardMaterial color={color} roughness={roughness} metalness={metalness} emissive={emissive} emissiveIntensity={emissiveIntensity} />
    </mesh>
  )
}

/** Cylinder from point `a` to point `b` (pipes, struts, rails). */
export function Pipe({ a, b, radius = 0.06, color = COLORS.steel, segments = 8 }: { a: V3; b: V3; radius?: number; color?: string; segments?: number }) {
  const { mid, quat, length } = useMemo(() => {
    const va = new Vector3(...a)
    const vb = new Vector3(...b)
    const dir = vb.clone().sub(va)
    return {
      mid: va.clone().add(vb).multiplyScalar(0.5),
      quat: new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.clone().normalize()),
      length: dir.length(),
    }
  }, [a, b])
  return (
    <mesh position={mid} quaternion={quat} castShadow>
      <cylinderGeometry args={[radius, radius, length, segments]} />
      <meshStandardMaterial color={color} roughness={0.5} metalness={0.4} />
    </mesh>
  )
}

/** Flat rectangle lying on the ground (grass, water, sand...). */
export function Flat({ size, position = [0, 0, 0], color, roughness = 0.95, metalness = 0 }: { size: [number, number]; position?: V3; color: string; roughness?: number; metalness?: number }) {
  return (
    <mesh position={position} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={size} />
      <meshStandardMaterial color={color} roughness={roughness} metalness={metalness} />
    </mesh>
  )
}

export function Water({ size, position = [0, 0, 0], color = COLORS.water }: { size: [number, number]; position?: V3; color?: string }) {
  return <Flat size={size} position={position} color={color} roughness={0.2} metalness={0.2} />
}

/** One instance: position, scale (number = uniform), rotation, colour. */
export type Item = { p: V3; s?: V3 | number; r?: V3; c?: string }

/**
 * Many copies of one shape in a single draw call. The geometry is the child element,
 * built at unit size and stretched by each item's scale.
 */
export function Instanced({
  items,
  color = '#ffffff',
  children,
  roughness = 0.85,
  metalness = 0,
  flatShading = false,
  shadows = true,
  emissive,
  emissiveIntensity,
  material,
}: {
  items: Item[]
  color?: string
  children: ReactNode
  roughness?: number
  metalness?: number
  flatShading?: boolean
  shadows?: boolean
  emissive?: string
  emissiveIntensity?: number
  material?: Material // shared material instead of a new one (its colour is still tinted per item)
}) {
  if (items.length === 0) return null
  return (
    <Instances limit={items.length} castShadow={shadows} receiveShadow frustumCulled={false} material={material}>
      {children}
      {!material && <meshStandardMaterial roughness={roughness} metalness={metalness} flatShading={flatShading} emissive={emissive} emissiveIntensity={emissiveIntensity} />}
      {items.map((it, i) => (
        <Instance key={i} position={it.p} rotation={it.r} scale={it.s ?? 1} color={it.c ?? color} />
      ))}
    </Instances>
  )
}

/** Unit box instances (the most common case). */
export function Boxes({ items, color, roughness, metalness, shadows, material }: { items: Item[]; color?: string; roughness?: number; metalness?: number; shadows?: boolean; material?: Material }) {
  return (
    <Instanced items={items} color={color} roughness={roughness} metalness={metalness} shadows={shadows} material={material}>
      <boxGeometry />
    </Instanced>
  )
}

/**
 * Straight flat strip from `from` to `to` (x, z), lying just above the ground at height `y`.
 * `dashes` paints a dashed centre line, `edges` paints solid edge lines.
 */
export function Road({
  from,
  to,
  width = 1,
  y = 0.02,
  color = COLORS.asphalt,
  dashes = false,
  edges = false,
}: {
  from: [number, number]
  to: [number, number]
  width?: number
  y?: number
  color?: string
  dashes?: boolean
  edges?: boolean
}) {
  const dx = to[0] - from[0]
  const dz = to[1] - from[1]
  const length = Math.hypot(dx, dz)
  const angle = Math.atan2(dz, dx)
  const marks = useMemo(() => {
    const items: Item[] = []
    if (dashes) {
      for (let d = 0.6; d < length - 0.6; d += 1.4) items.push({ p: [d - length / 2, 0.012, 0], s: [0.7, 0.01, 0.07] })
    }
    if (edges) {
      for (const side of [-1, 1]) items.push({ p: [0, 0.012, side * (width / 2 - 0.08)], s: [length, 0.01, 0.05] })
    }
    return items
  }, [dashes, edges, length, width])
  return (
    <group position={[(from[0] + to[0]) / 2, y, (from[1] + to[1]) / 2]} rotation={[0, -angle, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[length, width]} />
        <meshStandardMaterial color={color} roughness={1} />
      </mesh>
      <Boxes items={marks} color={dashes ? '#e9e4c8' : COLORS.white} roughness={0.8} shadows={false} />
    </group>
  )
}

/** Road along several points. */
export function RoadPath({ points, ...rest }: { points: [number, number][]; width?: number; y?: number; color?: string; dashes?: boolean; edges?: boolean }) {
  return (
    <>
      {points.slice(1).map((p, i) => (
        <Road key={i} from={points[i]} to={p} {...rest} />
      ))}
    </>
  )
}
