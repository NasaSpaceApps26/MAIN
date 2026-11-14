import { useMemo } from 'react'
import { BufferGeometry, DoubleSide, Float32BufferAttribute } from 'three'
import { Box, Building, Flat, Road } from './basics'
import { COLORS } from './colors'
import { MOUNT_H, rng, smoothstep, type V3 } from './lib'
import { Atmosphere, Clouds, Ocean, Rocks, Terrain, Trees } from './nature'
import { Dish, Fence, Flag, FloodLight, Hangar, HorizontalTank, LatticeTower, LightningRing, LightningTower, Office, Pad, RadarDome, Ribs, Shed, SphereTank, WaterTower } from './structures'
import { LandedBooster, ParkingLot } from './vehicles'
import { SaturnVOnPad } from '../launch/SaturnVOnPad'
import { PROFILES } from '../launch/profiles'

// x = east, -x = the Pacific, -z = north
const PAD_H = 1.5 // height of the flattened pad areas
// pads on the coast, the base headquarters far inland and uphill from them
const SLC4E: V3 = [-6, PAD_H, -26]
const LZ4: V3 = [-11, PAD_H, 6]
const SLC6: V3 = [8, PAD_H, 38]
const TRACKING: V3 = [30, 5.9, -30]
const BASE: V3 = [40, 5.7, 18]
/** Areas levelled for the pads: x, z, radius, height. */
const FLAT_AREAS: [number, number, number, number][] = [
  [SLC4E[0], SLC4E[2], 8.5, PAD_H],
  [LZ4[0], LZ4[2], 5, PAD_H],
  [SLC6[0], SLC6[2], 8.5, PAD_H],
  [TRACKING[0], TRACKING[2], 5, TRACKING[1]],
  [BASE[0], BASE[2], 9, BASE[1]],
]
const TERRAIN_SIZE: [number, number] = [150, 150]
const EDGE_H = 1.2 // terrain height at its edges, and of the flat land beyond

/** Where the cliffs meet the ocean, a wavy line running north-south. */
const coastX = (z: number) => -19 + 2.5 * Math.sin(z * 0.08) + Math.sin(z * 0.23 + 1)

/** Rolling coastal hills that end in a cliff above the ocean, levelled where the pads are. */
function height(x: number, z: number) {
  const raw = 1.8 + 1.6 * Math.sin(x * 0.12 + 1) * Math.cos(z * 0.09) + 0.7 * Math.sin(x * 0.33 + z * 0.21) + 0.3 * Math.sin(x * 0.9 - z * 0.7) + Math.max(0, x) * 0.1
  let h = Math.max(0.5, raw)
  for (const [px, pz, r, ph] of FLAT_AREAS) {
    const k = smoothstep(r, r + 5, Math.hypot(x - px, z - pz))
    h = ph + (h - ph) * k
  }
  // level out toward the edges of the terrain, to meet the flat far land
  h = h + (EDGE_H - h) * smoothstep(55, 74, Math.max(Math.abs(x), Math.abs(z)))
  const c = coastX(z)
  return -2 + (h + 2) * smoothstep(c - 1.2, c + 0.8, x)
}

/** Grass and chaparral on the hills, bare rock on the cliff face, sand at the foot. */
function colorAt(x: number, z: number, h: number) {
  const c = coastX(z)
  if (x < c + 0.9 && h > 0.1) return '#8c8170'
  if (h <= 0.1) return '#cdbd90'
  const n = Math.sin(x * 0.5 + Math.sin(z * 0.3) * 2) + Math.sin(z * 0.43 - x * 0.2)
  if (n > 1) return '#6f7d48'
  if (n > 0.2) return '#86894f'
  if (n > -0.7) return '#9c9762'
  return '#a8a06a'
}

/** Ribbon of asphalt laid over the terrain along the points. */
function DrapedRoad({ points, width = 0.9 }: { points: [number, number][]; width?: number }) {
  const geometry = useMemo(() => {
    const samples: [number, number][] = []
    for (let i = 0; i < points.length - 1; i++) {
      const [ax, az] = points[i]
      const [bx, bz] = points[i + 1]
      const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.4)
      for (let k = 0; k < n; k++) samples.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n])
    }
    samples.push(points[points.length - 1])
    const pos: number[] = []
    const idx: number[] = []
    samples.forEach(([x, z], i) => {
      const a = samples[Math.max(0, i - 1)]
      const b = samples[Math.min(samples.length - 1, i + 1)]
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
      const nx = ((b[1] - a[1]) / len) * (width / 2)
      const nz = (-(b[0] - a[0]) / len) * (width / 2)
      pos.push(x + nx, height(x + nx, z + nz) + 0.09, z + nz, x - nx, height(x - nx, z - nz) + 0.09, z - nz)
      if (i > 0) {
        const j = i * 2
        idx.push(j - 2, j - 1, j, j - 1, j + 1, j)
      }
    })
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(pos, 3))
    g.setIndex(idx)
    g.computeVertexNormals()
    return g
  }, [points, width])
  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial color="#4d4d50" roughness={1} side={DoubleSide} polygonOffset polygonOffsetFactor={-2} />
    </mesh>
  )
}

const ROADS: [number, number][][] = [
  // SLC-4E to the tracking station
  [
    [-1, -26],
    [10, -28],
    [25.5, -30],
  ],
  // SLC-4E to Landing Zone 4
  [
    [-7, -19],
    [-10, 2.5],
  ],
  // Landing Zone 4 to SLC-6
  [
    [-7.5, 8.5],
    [0, 24],
    [3, 30.5],
  ],
  // main road inland, north to south
  [
    [24, -75],
    [22, -45],
    [20, -28],
    [22, 0],
    [24, 18],
    [23, 45],
    [22, 75],
  ],
  // to the headquarters and to SLC-6
  [
    [24, 18],
    [31, 18],
  ],
  [
    [16.5, 36],
    [23.3, 36],
  ],
]

function distToSegment(px: number, pz: number, [ax, az]: [number, number], [bx, bz]: [number, number]) {
  const dx = bx - ax
  const dz = bz - az
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)))
  return Math.hypot(px - ax - t * dx, pz - az - t * dz)
}

/** Random points on the hills, away from the cliff edge, the pads and the roads. */
function hillPoints(count: number, seed: number, area: [number, number, number, number]) {
  const rand = rng(seed)
  const out: [number, number][] = []
  for (let tries = 0; out.length < count && tries < count * 20; tries++) {
    const x = area[0] + rand() * (area[2] - area[0])
    const z = area[1] + rand() * (area[3] - area[1])
    if (x < coastX(z) + 2.5) continue
    if (FLAT_AREAS.some(([px, pz, r]) => Math.hypot(x - px, z - pz) < r + 1.5)) continue
    if (ROADS.some((road) => road.slice(1).some((b, i) => distToSegment(x, z, road[i], b) < 1.1))) continue
    out.push([x, z])
  }
  return out
}

/** SLC-4E: rocket with its strongback, hangar on rails, four lightning masts and wires. */
function Slc4e() {
  return (
    <group position={SLC4E}>
      <Pad radius={3.4} rotationY={Math.PI}>
        <SaturnVOnPad pad="slc4e" profile={PROFILES.saturnVPolar} position={[0, MOUNT_H, 0]} />
        <LatticeTower position={[-0.9, 0.3, 0]} height={7.4} width={0.5} color="#3f4349" crane={false} floorsEvery={4} elevator={false} />
      </Pad>
      <LightningRing center={[0, 0, 0]} radius={5.4} height={11} />
      <Hangar position={[8.5, 0, 0]} size={[7, 3, 5]} rotationY={Math.PI} />
      {[-0.6, 0.6].map((o) => (
        <Road key={o} from={[2.5, o]} to={[5, o]} width={0.1} y={0.035} color="#4f4b45" />
      ))}
      <Box size={[10, 0.02, 8]} position={[6, 0.01, 0]} color={COLORS.concrete} roughness={1} />
      <WaterTower position={[5, 0, -6.5]} height={5} />
      <SphereTank position={[-5, 0, 6]} radius={1.05} />
      <HorizontalTank position={[3.5, 0, 6]} length={3} />
      <HorizontalTank position={[3.5, 0, 7.4]} length={3} />
      <FloodLight position={[-3.9, 0, -3.9]} face={Math.atan2(3.9, -3.9)} />
      <Fence rect={[-7.5, -7.5, 12.5, 8.5]} />
    </group>
  )
}

/** Landing Zone 4 with a first stage that has just come back. */
function Lz4() {
  return (
    <group position={LZ4}>
      <mesh position={[0, 0.05, 0]} receiveShadow>
        <cylinderGeometry args={[3.4, 3.5, 0.1, 48]} />
        <meshStandardMaterial color={COLORS.concrete} roughness={1} />
      </mesh>
      <mesh position={[0, 0.11, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.3, 2.6, 64]} />
        <meshStandardMaterial color={COLORS.white} />
      </mesh>
      <Box size={[2.6, 0.01, 0.3]} position={[0, 0.115, 0]} rotation={[0, Math.PI / 4, 0]} color={COLORS.white} shadows={false} />
      <Box size={[2.6, 0.01, 0.3]} position={[0, 0.115, 0]} rotation={[0, -Math.PI / 4, 0]} color={COLORS.white} shadows={false} />
      <LandedBooster position={[0.3, 0.1, -0.2]} height={5.2} />
      <FloodLight position={[3.6, 0, 3.6]} face={Math.atan2(-3.6, 3.6)} height={2.5} />
      <FloodLight position={[-3.6, 0, -3.6]} face={Math.atan2(3.6, -3.6)} height={2.5} />
    </group>
  )
}

/** SLC-6: rocket with four boosters between the mobile service tower and the access tower. */
function Slc6() {
  return (
    <group position={SLC6}>
      <Pad radius={3.8} rotationY={Math.PI}>
        <SaturnVOnPad pad="slc6" profile={PROFILES.saturnVPolar} position={[0, MOUNT_H, 0]} />
        <LatticeTower position={[-2.6, 0, 0]} height={8.5} width={1.3} color="#7d838a" rotationY={Math.PI} arms={[{ y: 6.8, length: 1.4 }, { y: 4, length: 1.4 }]} />
      </Pad>
      <group position={[3.4, 0.15, 0]}>
        <Building size={[3.4, 12, 4.2]} color="#c6c4bc" />
        <Ribs size={[3.4, 12, 4.2]} spacing={0.7} color="#b3b1a9" />
        <Box size={[0.05, 10, 1.6]} position={[-1.73, 5.5, 0]} color="#5e666f" />
      </group>
      <group position={[0, 0, -7]}>
        <Building size={[4.6, 6.5, 4.6]} color="#d1cfc7" />
        <Ribs size={[4.6, 6.5, 4.6]} spacing={0.8} color="#bfbdb5" />
      </group>
      <LightningTower position={[-6, 0, 5]} height={14} />
      <LightningTower position={[6, 0, -4]} height={14} />
      <SphereTank position={[-6, 0, -5]} radius={1.2} />
      <WaterTower position={[6, 0, 6]} height={5} />
      <Fence rect={[-8, -10, 8, 8]} />
    </group>
  )
}

/** Hilltop tracking station: a sweeping dish antenna and a radar dome. */
function TrackingStation() {
  return (
    <group position={TRACKING}>
      <Box size={[9, 0.02, 8]} position={[0, 0.01, 0]} color={COLORS.concrete} roughness={1} />
      <Dish position={[-1.5, 0, -1]} size={1.6} />
      <RadarDome position={[2.5, 0, 2]} radius={1.1} />
      <Shed position={[2.5, 0, -2]} size={[2, 1, 1.4]} />
      <Fence rect={[-4.3, -3.8, 4.3, 3.8]} />
    </group>
  )
}

/** Base headquarters: offices, parking, water tower and flag, well away from the pads. */
function Headquarters() {
  return (
    <group position={BASE}>
      <Box size={[17, 0.02, 15]} position={[0, 0.01, 0]} color={COLORS.concrete} roughness={1} />
      <Office position={[1, 0, -3.5]} size={[7, 2.6, 4]} floors={3} />
      <Office position={[-5.5, 0, 3]} size={[4, 1.8, 3]} floors={2} />
      <ParkingLot position={[2.5, 0, 3.8]} rows={2} cols={16} seed={12} />
      <WaterTower position={[6.5, 0, -5]} height={5.5} radius={1} stripe />
      <Flag position={[-3, 3.71, -6.5]} width={1.1} pole />
    </group>
  )
}

/** Vandenberg Space Force Base: pads on the cliffs above the Pacific. */
export function VandenbergModel() {
  const nature = useMemo(() => {
    const rand = rng(77)
    const rocks: [number, number][] = []
    for (let z = -70; z < 70; z += 0.9) rocks.push([coastX(z) - 0.8 - rand() * 2.5, z + (rand() - 0.5) * 0.8])
    return {
      oaks: hillPoints(190, 51, [-30, -72, 72, 72]),
      shrubs: hillPoints(480, 52, [-30, -72, 72, 72]),
      rocks,
    }
  }, [])
  return (
    <>
      <Atmosphere haze="#c5d0d7" zenith="#6f9cc8" fogNear={70} fogFar={230} />
      <Clouds seed={13} count={8} area={260} />
      <Terrain size={TERRAIN_SIZE} segments={160} height={height} colorAt={colorAt} />
      <Ocean size={[130, 200]} position={[-75, 0, 0]} amplitude={0.09} shore="east" calmWidth={10} />
      {/* beyond the terrain: open ocean to the west, flat land everywhere else */}
      <Flat size={[1000, 2000]} position={[-510, -0.4, 0]} color={COLORS.ocean} roughness={0.15} metalness={0.25} />
      <Flat size={[1000, 2000]} position={[575, EDGE_H, 0]} color="#8f9160" />
      {[-1, 1].map((s) => (
        <Flat key={s} size={[95, 1000]} position={[27.5, EDGE_H, s * 575]} color="#8f9160" />
      ))}
      <Rocks points={nature.rocks} scale={0.7} y={-0.25} />

      {ROADS.map((r, i) => (
        <DrapedRoad key={i} points={r} />
      ))}

      <Slc4e />
      <Lz4 />
      <Slc6 />
      <TrackingStation />
      <Headquarters />

      <Trees points={nature.oaks} kind="oak" seed={61} ground={height} scale={0.95} />
      <Trees points={nature.shrubs} kind="shrub" seed={62} ground={height} scale={0.8} />
    </>
  )
}
