/** Towers, pads, tanks, buildings and other ground structures. */
import { useMemo, useRef, type ComponentRef, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import { CanvasTexture, Color, DoubleSide, Group, LatheGeometry, SRGBColorSpace, Vector2 } from 'three'
import { Box, Boxes, Building, Cylinder, Instanced, Pipe, type Item } from './basics'
import { COLORS } from './colors'
import { MOUNT_H, type V3 } from './lib'
import { nightMaterials, sky } from '../sky/skyState'

export type Arm = { y: number; length: number; kind?: 'crew' | 'umbilical' }

/**
 * Open steel lattice tower: four legs, a beam frame every `level` units, X bracing on every face,
 * grated floors, an elevator shaft, swing arms reaching toward -x, a hammerhead crane and an
 * optional lightning mast. `position` is the middle of its base.
 */
export function LatticeTower({
  position = [0, 0, 0],
  height = 9,
  width = 1.4,
  color = COLORS.tower,
  level = 1.1,
  arms = [],
  rotationY = 0,
  crane = true,
  mast = 0,
  floorsEvery = 3,
  elevator = true,
}: {
  position?: V3
  height?: number
  width?: number
  color?: string
  level?: number
  arms?: Arm[]
  rotationY?: number
  crane?: boolean
  mast?: number // lightning mast height on the roof, 0 = none
  floorsEvery?: number
  elevator?: boolean
}) {
  const { beams, floors } = useMemo(() => {
    const t = Math.max(0.05, width * 0.07)
    const tb = t * 0.55
    const h = width / 2
    const n = Math.max(1, Math.round(height / level))
    const dy = height / n
    const L = Math.hypot(width, dy)
    const a = Math.atan2(dy, width)
    const beams: Item[] = []
    const floors: Item[] = []
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) beams.push({ p: [sx * h, height / 2, sz * h], s: [t, height, t] })
    for (let i = 0; i < n; i++) {
      const y1 = (i + 1) * dy
      const ym = y1 - dy / 2
      beams.push(
        { p: [0, y1, h], s: [width, tb, tb] },
        { p: [0, y1, -h], s: [width, tb, tb] },
        { p: [h, y1, 0], s: [tb, tb, width] },
        { p: [-h, y1, 0], s: [tb, tb, width] },
      )
      for (const side of [-1, 1]) {
        beams.push({ p: [0, ym, side * h], s: [L, tb * 0.8, tb * 0.8], r: [0, 0, a] })
        beams.push({ p: [0, ym, side * h], s: [L, tb * 0.8, tb * 0.8], r: [0, 0, -a] })
        beams.push({ p: [side * h, ym, 0], s: [tb * 0.8, tb * 0.8, L], r: [a, 0, 0] })
        beams.push({ p: [side * h, ym, 0], s: [tb * 0.8, tb * 0.8, L], r: [-a, 0, 0] })
      }
      if ((i + 1) % floorsEvery === 0) floors.push({ p: [0, y1, 0], s: [width * 1.12, 0.05, width * 1.12] })
    }
    return { beams, floors }
  }, [height, width, level, floorsEvery])

  const h = width / 2
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Boxes items={beams} color={color} roughness={0.6} metalness={0.2} />
      <Boxes items={floors} color="#55595f" roughness={0.9} />
      {elevator && <Building size={[width * 0.3, height, width * 0.3]} position={[h * 0.45, 0, h * 0.45]} color="#c9c6bd" />}
      <Box size={[width + 0.2, 0.22, width + 0.2]} position={[0, height + 0.11, 0]} color={color} />
      {crane && (
        <group position={[0, height + 0.22, 0]}>
          <Box size={[0.25, 0.7, 0.25]} position={[0, 0.35, 0]} color="#e3b23c" />
          <Box size={[width * 1.9, 0.16, 0.2]} position={[width * 0.35, 0.75, 0]} color="#e3b23c" />
          <Box size={[0.05, 0.6, 0.05]} position={[width * 1.2, 0.4, 0]} color={COLORS.dark} />
        </group>
      )}
      {mast > 0 && <LightningTower position={[0, height + 0.22, 0]} height={mast} />}
      {arms.map((arm, i) =>
        arm.kind === 'crew' ? (
          <group key={i} position={[-h - arm.length / 2, arm.y, 0]}>
            <Box size={[arm.length, 0.42, 0.38]} color="#d4d2cb" />
            <Box size={[arm.length, 0.08, 0.385]} position={[0, 0.06, 0]} color={COLORS.glass} />
            <Box size={[0.55, 0.62, 0.6]} position={[-arm.length / 2 + 0.1, 0, 0]} color={COLORS.white} />
          </group>
        ) : (
          <group key={i} position={[-h - arm.length / 2, arm.y, 0]}>
            <Box size={[arm.length, 0.14, 0.32]} color={COLORS.steel} />
            <Box size={[arm.length, 0.06, 0.06]} position={[0, -0.14, 0.1]} color="#d9d9d9" />
            <Box size={[arm.length, 0.06, 0.06]} position={[0, -0.14, -0.1]} color="#e0c36a" />
          </group>
        ),
      )}
    </group>
  )
}

/**
 * Concrete pad with a flame trench (toward +z), a flame deflector and a launch mount over the trench.
 * Children are placed on the pad surface; put the rocket at y = MOUNT_H so it stands on the mount.
 */
export function Pad({ position = [0, 0, 0], radius = 3.2, height = 0.15, rotationY = 0, children }: { position?: V3; radius?: number; height?: number; rotationY?: number; children?: ReactNode }) {
  const trench = radius + 1.8
  return (
    <group position={position}>
      <group rotation={[0, rotationY, 0]}>
        <mesh position={[0, height / 2, 0]} receiveShadow castShadow>
          <cylinderGeometry args={[radius * 0.94, radius, height, 8]} />
          <meshStandardMaterial color={COLORS.concrete} roughness={0.95} />
        </mesh>
        {/* trench walls and floor, deflector at the far end */}
        <Box size={[1.1, 0.04, trench]} position={[0, height + 0.005, trench / 2]} color="#3a3835" />
        <Box size={[0.18, 0.25, trench]} position={[0.64, height + 0.1, trench / 2]} color={COLORS.concreteDark} />
        <Box size={[0.18, 0.25, trench]} position={[-0.64, height + 0.1, trench / 2]} color={COLORS.concreteDark} />
        <Box size={[1.1, 0.6, 0.5]} position={[0, height + 0.1, trench - 0.1]} rotation={[0.9, 0, 0]} color="#58534c" />
        {/* launch mount: four legs and a frame around the rocket base */}
        {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => <Box key={`${sx}${sz}`} size={[0.18, MOUNT_H, 0.18]} position={[sx * 0.62, height + MOUNT_H / 2, sz * 0.62]} color={COLORS.concreteDark} />))}
        <Box size={[1.45, 0.14, 0.22]} position={[0, height + MOUNT_H - 0.07, 0.62]} color={COLORS.steelDark} />
        <Box size={[1.45, 0.14, 0.22]} position={[0, height + MOUNT_H - 0.07, -0.62]} color={COLORS.steelDark} />
        <Box size={[0.22, 0.14, 1.45]} position={[0.62, height + MOUNT_H - 0.07, 0]} color={COLORS.steelDark} />
        <Box size={[0.22, 0.14, 1.45]} position={[-0.62, height + MOUNT_H - 0.07, 0]} color={COLORS.steelDark} />
        {/* water deluge ring */}
        <mesh position={[0, height + 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[radius * 0.55, 0.04, 6, 32]} />
          <meshStandardMaterial color="#cfc8b8" metalness={0.3} />
        </mesh>
      </group>
      <group position={[0, height, 0]}>{children}</group>
    </group>
  )
}

/** Raised hardstand mound, like the pads at Launch Complex 39. Children sit on its top. */
export function Mound({ position = [0, 0, 0], radius = 6, height = 0.7, children }: { position?: V3; radius?: number; height?: number; children?: ReactNode }) {
  return (
    <group position={position}>
      <mesh position={[0, height / 2, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[radius * 0.72, radius, height, 12]} />
        <meshStandardMaterial color="#8b9a62" roughness={1} />
      </mesh>
      <mesh position={[0, height + 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[radius * 0.72, 12]} />
        <meshStandardMaterial color={COLORS.concrete} roughness={1} />
      </mesh>
      <group position={[0, height, 0]}>{children}</group>
    </group>
  )
}

/** Tapered lightning mast with a red warning light. */
export function LightningTower({ position = [0, 0, 0], height = 10 }: { position?: V3; height?: number }) {
  return (
    <group position={position}>
      <Cylinder radius={0.16} radiusTop={0.06} height={height} position={[0, height / 2, 0]} color={COLORS.steel} segments={8} metalness={0.3} />
      {[0.33, 0.66].map((f) => (
        <Cylinder key={f} radius={0.18 - f * 0.1} height={0.08} position={[0, height * f, 0]} color={COLORS.steelDark} segments={8} />
      ))}
      <Cylinder radius={0.02} height={0.9} position={[0, height + 0.45, 0]} color={COLORS.dark} segments={4} />
      {/* red aircraft warning light: blinks at night */}
      <mesh position={[0, height + 0.05, 0]} material={nightMaterials().warning}>
        <sphereGeometry args={[0.07, 8, 8]} />
      </mesh>
    </group>
  )
}

/** Wires hung between tower tops, sagging in the middle (closed loop). */
export function Catenary({ tops, sag = 0.8 }: { tops: V3[]; sag?: number }) {
  const segments = useMemo(
    () =>
      tops.map((a, i) => {
        const b = tops[(i + 1) % tops.length]
        const pts: V3[] = []
        for (let k = 0; k <= 16; k++) {
          const u = k / 16
          pts.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u - sag * 4 * u * (1 - u), a[2] + (b[2] - a[2]) * u])
        }
        return pts
      }),
    [tops, sag],
  )
  return (
    <>
      {segments.map((pts, i) => (
        <Line key={i} points={pts} color="#2b2f35" lineWidth={1.2} />
      ))}
    </>
  )
}

/** Lightning towers on the corners of a square (or triangle) around a pad, wired together. */
export function LightningRing({ center, radius, height, count = 4, angle = Math.PI / 4 }: { center: V3; radius: number; height: number; count?: number; angle?: number }) {
  const towers = useMemo<V3[]>(
    () =>
      Array.from({ length: count }, (_, i) => {
        const a = angle + (i / count) * Math.PI * 2
        return [center[0] + Math.cos(a) * radius, center[1], center[2] + Math.sin(a) * radius]
      }),
    [center, radius, count, angle],
  )
  const tops = useMemo(() => towers.map(([x, y, z]) => [x, y + height + 0.85, z] as V3), [towers, height])
  return (
    <>
      {towers.map((p) => (
        <LightningTower key={p.join()} position={p} height={height} />
      ))}
      <Catenary tops={tops} sag={radius * 0.12} />
    </>
  )
}

/** Water tank on braced legs, e.g. the sound suppression tank next to a pad. */
export function WaterTower({ position = [0, 0, 0], height = 4, radius = 0.9, stripe = false }: { position?: V3; height?: number; radius?: number; stripe?: boolean }) {
  const legs = useMemo(() => {
    const items: Item[] = []
    const r = radius * 0.75
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4
      items.push({ p: [Math.cos(a) * r, height / 2, Math.sin(a) * r], s: [0.1, height, 0.1] })
    }
    for (const y of [height * 0.35, height * 0.7]) {
      const s = r * Math.SQRT2
      items.push({ p: [0, y, r * Math.SQRT1_2], s: [s, 0.06, 0.06] }, { p: [0, y, -r * Math.SQRT1_2], s: [s, 0.06, 0.06] })
      items.push({ p: [r * Math.SQRT1_2, y, 0], s: [0.06, 0.06, s] }, { p: [-r * Math.SQRT1_2, y, 0], s: [0.06, 0.06, s] })
    }
    return items
  }, [height, radius])
  return (
    <group position={position}>
      <Boxes items={legs} color={COLORS.steel} metalness={0.3} />
      <Cylinder radius={0.12} height={height} position={[0, height / 2, 0]} color={COLORS.steelDark} segments={8} />
      <Cylinder radius={radius} height={1.4} position={[0, height + 0.7, 0]} color={COLORS.white} segments={24} roughness={0.5} />
      {stripe && <Cylinder radius={radius * 1.005} height={0.3} position={[0, height + 0.9, 0]} color={COLORS.stripe} segments={24} />}
      <mesh position={[0, height + 1.65, 0]} castShadow>
        <coneGeometry args={[radius, 0.5, 24]} />
        <meshStandardMaterial color={COLORS.white} roughness={0.5} />
      </mesh>
      <Box size={[0.04, height + 1.4, 0.2]} position={[radius + 0.02, (height + 1.4) / 2, 0]} color={COLORS.dark} />
    </group>
  )
}

/** Spherical cryogenic tank (liquid oxygen / hydrogen) on short legs. */
export function SphereTank({ position = [0, 0, 0], radius = 1.2, color = COLORS.white }: { position?: V3; radius?: number; color?: string }) {
  const legs = useMemo<Item[]>(
    () =>
      Array.from({ length: 6 }, (_, i) => {
        const a = (i / 6) * Math.PI * 2
        return { p: [Math.cos(a) * radius * 0.85, radius * 0.6, Math.sin(a) * radius * 0.85], s: [0.09, radius * 1.2, 0.09] }
      }),
    [radius],
  )
  return (
    <group position={position}>
      <Boxes items={legs} color={COLORS.steel} />
      <mesh position={[0, radius * 1.45, 0]} castShadow receiveShadow>
        <sphereGeometry args={[radius, 32, 20]} />
        <meshStandardMaterial color={color} roughness={0.35} metalness={0.15} />
      </mesh>
      <mesh position={[0, radius * 1.45, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[radius * 1.01, 0.04, 6, 40]} />
        <meshStandardMaterial color={COLORS.steelDark} />
      </mesh>
    </group>
  )
}

/** Horizontal fuel tank on saddles (e.g. kerosene). */
export function HorizontalTank({ position = [0, 0, 0], length = 3, radius = 0.45, rotationY = 0, color = COLORS.offWhite }: { position?: V3; length?: number; radius?: number; rotationY?: number; color?: string }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Cylinder radius={radius} height={length} position={[0, radius + 0.2, 0]} rotation={[0, 0, Math.PI / 2]} color={color} segments={20} roughness={0.4} />
      {[-1, 1].map((s) => (
        <Box key={s} size={[0.2, radius + 0.2, radius * 1.6]} position={[s * length * 0.32, (radius + 0.2) / 2, 0]} color={COLORS.concreteDark} />
      ))}
    </group>
  )
}

/** Light pole with a lamp head pointing toward `face` (radians around Y). */
export function FloodLight({ position = [0, 0, 0], height = 3.5, face = 0, reach = 5 }: { position?: V3; height?: number; face?: number; reach?: number }) {
  const night = nightMaterials()
  // the lamp shines along -x (toward the pad), down onto a spot `reach` away
  const lamp: V3 = [-0.25, height - 0.05, 0]
  const dx = reach - 0.25
  const len = Math.hypot(dx, height)
  return (
    <group position={position} rotation={[0, face, 0]}>
      <Cylinder radius={0.05} height={height} position={[0, height / 2, 0]} color={COLORS.steel} segments={6} />
      <Box size={[0.25, 0.35, 0.6]} position={[-0.1, height, 0]} rotation={[0, 0, 0.4]} color={COLORS.dark} />
      <mesh position={lamp} rotation={[0, 0, 0.4]} material={night.lamp}>
        <boxGeometry args={[0.02, 0.28, 0.5]} />
      </mesh>
      {/* at night: a faint beam and a bright patch on the ground (invisible by day) */}
      <mesh position={[lamp[0] - dx / 2, height / 2, 0]} rotation={[0, 0, Math.atan2(-dx, height)]} material={night.beam}>
        <coneGeometry args={[len * 0.32, len, 20, 1, true]} />
      </mesh>
      <mesh position={[-reach, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.4, 1, 1]} material={night.pool}>
        <circleGeometry args={[len * 0.42, 32]} />
      </mesh>
    </group>
  )
}

/** Chain-link fence around a rectangle: posts and two wires. */
const WIRE = new Color('#8a8c8e')

/** Fence wire. Lines are not lit by the scene's lights, so it is darkened by hand at night. */
function FenceWire({ points }: { points: V3[] }) {
  const line = useRef<ComponentRef<typeof Line>>(null)
  useFrame(() => line.current?.material.color.copy(WIRE).multiplyScalar(0.12 + 0.88 * sky.day))
  return <Line ref={line} points={points} color="#8a8c8e" lineWidth={1} />
}

export function Fence({ rect, y = 0, height = 0.35, spacing = 0.9 }: { rect: [number, number, number, number]; y?: number; height?: number; spacing?: number }) {
  const [x0, z0, x1, z1] = rect
  const posts = useMemo(() => {
    const items: Item[] = []
    const edge = (ax: number, az: number, bx: number, bz: number) => {
      const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / spacing))
      for (let i = 0; i < n; i++) items.push({ p: [ax + ((bx - ax) * i) / n, y + height / 2, az + ((bz - az) * i) / n], s: [0.04, height, 0.04] })
    }
    edge(x0, z0, x1, z0)
    edge(x1, z0, x1, z1)
    edge(x1, z1, x0, z1)
    edge(x0, z1, x0, z0)
    return items
  }, [x0, z0, x1, z1, y, height, spacing])
  const loop = (h: number): V3[] => [
    [x0, y + h, z0],
    [x1, y + h, z0],
    [x1, y + h, z1],
    [x0, y + h, z1],
    [x0, y + h, z0],
  ]
  return (
    <>
      <Boxes items={posts} color="#9a9c9e" shadows={false} />
      <FenceWire points={loop(height * 0.95)} />
      <FenceWire points={loop(height * 0.5)} />
    </>
  )
}

/** Geodesic radar dome on a building. */
export function RadarDome({ position = [0, 0, 0], radius = 1 }: { position?: V3; radius?: number }) {
  return (
    <group position={position}>
      <Building size={[radius * 1.9, radius * 0.9, radius * 1.9]} color={COLORS.offWhite} />
      <mesh position={[0, radius * 0.9 + radius * 0.55, 0]} castShadow>
        <icosahedronGeometry args={[radius, 2]} />
        <meshStandardMaterial color={COLORS.white} roughness={0.55} flatShading />
      </mesh>
    </group>
  )
}

/** Tracking dish antenna that slowly sweeps around. */
export function Dish({ position = [0, 0, 0], size = 1.4, speed = 0.15, tilt = 0.7 }: { position?: V3; size?: number; speed?: number; tilt?: number }) {
  const head = useRef<Group>(null)
  const geometry = useMemo(() => {
    const f = size * 0.6
    const pts = Array.from({ length: 12 }, (_, i) => {
      const r = (size * i) / 11
      return new Vector2(r, (r * r) / (4 * f))
    })
    return new LatheGeometry(pts, 32)
  }, [size])
  useFrame((_, dt) => {
    if (head.current) head.current.rotation.y += dt * speed
  })
  const depth = size / 2.4
  return (
    <group position={position}>
      <Cylinder radius={size * 0.25} radiusTop={size * 0.18} height={size * 1.2} position={[0, size * 0.6, 0]} color={COLORS.offWhite} segments={12} />
      <group ref={head} position={[0, size * 1.25, 0]}>
        <Box size={[size * 0.5, size * 0.25, size * 0.4]} color={COLORS.offWhite} />
        <group rotation={[0, 0, tilt]}>
          <mesh geometry={geometry} position={[0, size * 0.15, 0]} castShadow>
            <meshStandardMaterial color={COLORS.white} roughness={0.5} side={DoubleSide} />
          </mesh>
          {[0, 1, 2].map((i) => {
            const a = (i / 3) * Math.PI * 2
            return <Pipe key={i} a={[Math.cos(a) * size * 0.95, size * 0.15 + depth, Math.sin(a) * size * 0.95]} b={[0, size * 0.15 + size * 0.6, 0]} radius={0.02} color={COLORS.steel} />
          })}
          <Cylinder radius={0.07} height={0.2} position={[0, size * 0.15 + size * 0.6, 0]} color={COLORS.dark} segments={8} />
        </group>
      </group>
    </group>
  )
}

/** Hangar with an arched roof and a big sliding door on the +x face. */
export function Hangar({ position = [0, 0, 0], size = [6, 2.5, 4], rotationY = 0, color = COLORS.offWhite }: { position?: V3; size?: V3; rotationY?: number; color?: string }) {
  const [w, h, d] = size
  const doorLines = useMemo<Item[]>(() => Array.from({ length: 5 }, (_, i) => ({ p: [w / 2 + 0.03, h * 0.45, -d * 0.36 + (i * d * 0.72) / 4], s: [0.02, h * 0.88, 0.04] })), [w, h, d])
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Building size={[w, h, d]} color={color} />
      <mesh position={[0, h, 0]} rotation={[0, 0, Math.PI / 2]} scale={[0.45, 1, 1]} castShadow receiveShadow>
        <cylinderGeometry args={[d / 2, d / 2, w, 24, 1, false, 0, Math.PI]} />
        <meshStandardMaterial color="#c2c4c6" roughness={0.6} metalness={0.3} side={DoubleSide} />
      </mesh>
      <Box size={[0.04, h * 0.9, d * 0.8]} position={[w / 2 + 0.01, h * 0.45, 0]} color="#8f959b" metalness={0.3} />
      <Boxes items={doorLines} color="#6c7278" shadows={false} />
    </group>
  )
}

/** Office block with bands of windows on every floor and roof units. */
export function Office({ position = [0, 0, 0], size = [4, 2, 3], floors = 3, color = COLORS.offWhite, rotationY = 0 }: { position?: V3; size?: V3; floors?: number; color?: string; rotationY?: number }) {
  const [w, h, d] = size
  // window bands, one per floor and face; about two in three light up at night
  const windows = useMemo(() => {
    const lit: Item[] = []
    const dark: Item[] = []
    for (let f = 0; f < floors; f++) {
      const y = ((f + 0.55) * h) / floors
      const bh = (h / floors) * 0.42
      const bands: Item[] = [
        { p: [0, y, d / 2 + 0.01], s: [w * 0.92, bh, 0.03] },
        { p: [0, y, -d / 2 - 0.01], s: [w * 0.92, bh, 0.03] },
        { p: [w / 2 + 0.01, y, 0], s: [0.03, bh, d * 0.9] },
        { p: [-w / 2 - 0.01, y, 0], s: [0.03, bh, d * 0.9] },
      ]
      bands.forEach((b, i) => ((f * 4 + i) % 3 === 2 ? dark : lit).push(b))
    }
    return { lit, dark }
  }, [w, h, d, floors])
  const roof = useMemo<Item[]>(
    () => [
      { p: [w * 0.2, h + 0.15, d * 0.1], s: [w * 0.18, 0.3, d * 0.25] },
      { p: [-w * 0.25, h + 0.12, -d * 0.15], s: [w * 0.12, 0.24, d * 0.2] },
    ],
    [w, h, d],
  )
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Building size={size} color={color} />
      <Boxes items={windows.lit} color="#ffffff" shadows={false} material={nightMaterials().window} />
      <Boxes items={windows.dark} color={COLORS.glass} roughness={0.2} metalness={0.4} shadows={false} />
      <Boxes items={roof} color="#a9aaa6" />
    </group>
  )
}

/** Vertical ribs on the walls of a big box building, for the panelled look. */
export function Ribs({ size, position = [0, 0, 0], spacing = 0.9, color = '#c8c8c3', faces = 'xz' }: { size: V3; position?: V3; spacing?: number; color?: string; faces?: 'x' | 'z' | 'xz' }) {
  const [w, h, d] = size
  const items = useMemo(() => {
    const out: Item[] = []
    if (faces.includes('z'))
      for (let x = -w / 2 + spacing / 2; x < w / 2; x += spacing) out.push({ p: [x, h / 2, d / 2 + 0.03], s: [0.08, h, 0.06] }, { p: [x, h / 2, -d / 2 - 0.03], s: [0.08, h, 0.06] })
    if (faces.includes('x'))
      for (let z = -d / 2 + spacing / 2; z < d / 2; z += spacing) out.push({ p: [w / 2 + 0.03, h / 2, z], s: [0.06, h, 0.08] }, { p: [-w / 2 - 0.03, h / 2, z], s: [0.06, h, 0.08] })
    return out
  }, [w, h, d, spacing, faces])
  return (
    <group position={position}>
      <Boxes items={items} color={color} shadows={false} />
    </group>
  )
}

/** Canvas-drawn US flag texture (stripes, canton, stars). */
function useFlagTexture() {
  return useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 494
    c.height = 260
    const g = c.getContext('2d')!
    const sh = c.height / 13
    for (let i = 0; i < 13; i++) {
      g.fillStyle = i % 2 ? '#ffffff' : '#b22234'
      g.fillRect(0, i * sh, c.width, sh + 1)
    }
    const cw = c.width * 0.4
    const ch = sh * 7
    g.fillStyle = '#3c3b6e'
    g.fillRect(0, 0, cw, ch)
    g.fillStyle = '#ffffff'
    for (let row = 0; row < 9; row++) {
      const n = row % 2 ? 5 : 6
      for (let k = 0; k < n; k++) {
        const x = (cw / 12) * (row % 2 ? 2 + k * 2 : 1 + k * 2)
        const y = (ch / 10) * (row + 1)
        g.beginPath()
        g.arc(x, y, sh * 0.28, 0, Math.PI * 2)
        g.fill()
      }
    }
    const tex = new CanvasTexture(c)
    tex.colorSpace = SRGBColorSpace
    return tex
  }, [])
}

/** Flag painted on a wall (flat) or flying on a pole. */
export function Flag({ position = [0, 0, 0], width = 2, rotationY = 0, pole = false }: { position?: V3; width?: number; rotationY?: number; pole?: boolean }) {
  const map = useFlagTexture()
  const h = width * (10 / 19)
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {pole && <Cylinder radius={0.04} height={4} position={[-width / 2 - 0.05, -2 + h / 2, 0]} color={COLORS.white} segments={6} />}
      <mesh>
        <planeGeometry args={[width, h]} />
        <meshStandardMaterial map={map} roughness={0.8} side={DoubleSide} />
      </mesh>
    </group>
  )
}

/** Black and white striped lighthouse with a rotating beam. */
export function Lighthouse({ position = [0, 0, 0] }: { position?: V3 }) {
  const beam = useRef<Group>(null)
  useFrame((_, dt) => {
    if (beam.current) beam.current.rotation.y += dt * 0.8
  })
  const bands = 7
  const h = 0.75
  const top = bands * h
  return (
    <group position={position}>
      {Array.from({ length: bands }, (_, i) => (
        <Cylinder key={i} radius={0.6 - i * 0.04} radiusTop={0.56 - i * 0.04} height={h} position={[0, h / 2 + i * h, 0]} color={i % 2 ? COLORS.dark : COLORS.white} segments={16} />
      ))}
      <Cylinder radius={0.48} height={0.08} position={[0, top + 0.04, 0]} color={COLORS.dark} segments={16} />
      <Cylinder radius={0.27} height={0.5} position={[0, top + 0.33, 0]} color="#ffe9a0" emissive="#ffcf4a" emissiveIntensity={2} segments={12} />
      <mesh position={[0, top + 0.75, 0]}>
        <coneGeometry args={[0.34, 0.35, 12]} />
        <meshStandardMaterial color={COLORS.dark} />
      </mesh>
      <group ref={beam} position={[0, top + 0.33, 0]}>
        <mesh position={[3, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={nightMaterials().lighthouseBeam}>
          <coneGeometry args={[0.5, 6, 16, 1, true]} />
        </mesh>
      </group>
      {/* keeper's house */}
      <Building size={[1.6, 0.9, 1.2]} position={[1.8, 0, 0.6]} color={COLORS.white} />
      <Box size={[1.7, 0.08, 1.3]} position={[1.8, 0.94, 0.6]} color="#9e3b2e" />
    </group>
  )
}

/** Simple windowed blockhouse / support shed. */
export function Shed({ position = [0, 0, 0], size = [1.6, 0.9, 1.2], color = COLORS.offWhite, rotationY = 0 }: { position?: V3; size?: V3; color?: string; rotationY?: number }) {
  const [w, h, d] = size
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Building size={size} color={color} />
      <Box size={[w * 0.6, h * 0.3, 0.02]} position={[0, h * 0.6, d / 2 + 0.01]} color={COLORS.glass} shadows={false} />
      <Box size={[w + 0.1, 0.06, d + 0.1]} position={[0, h + 0.03, 0]} color="#8d8f8f" />
    </group>
  )
}

/** Unit-cylinder instances (posts, pillars). */
export function Pillars({ items, color = COLORS.concreteDark }: { items: Item[]; color?: string }) {
  return (
    <Instanced items={items} color={color}>
      <cylinderGeometry args={[1, 1, 1, 10]} />
    </Instanced>
  )
}
