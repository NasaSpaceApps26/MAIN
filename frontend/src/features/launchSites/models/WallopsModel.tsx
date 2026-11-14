import { useMemo } from 'react'
import { Box, Building, Flat, Road, Water } from './basics'
import { COLORS } from './colors'
import { along, inRect, MOUNT_H, scatter, smoothstep, type Rect, type V3 } from './lib'
import { Atmosphere, Clouds, Ocean, Rocks, Terrain, Trees } from './nature'
import { Dish, Fence, Hangar, HorizontalTank, LatticeTower, LightningRing, LightningTower, Office, Pad, Pillars, RadarDome, Shed, SphereTank, WaterTower } from './structures'
import { Airplane, ControlTower, ParkingLot, Rocket } from './vehicles'
import { SaturnVOnPad } from '../launch/SaturnVOnPad'
import { PROFILES } from '../launch/profiles'

// x = east (toward the Atlantic), -z = north
const ISLAND_Y = 0.3 // top of the sand island
const MAIN_Y = 0.35 // mainland, where the main base and airfield are
const ROAD_X = 4.6 // road along the island
const TERRAIN_SIZE: [number, number] = [170, 210]

const MARSH_X = -44 // the mainland base starts here: a wide marsh separates it from the pads
const BASE_SHIFT = MARSH_X + 14 // the base buildings are laid out for a coast at x = -14, moved west by this
const channelA = (z: number) => -5 + 1.5 * Math.sin(z * 0.1)
const channelC = (z: number) => -26 + 2 * Math.sin(z * 0.07 + 2)
const channelB = (x: number) => 12 + Math.sin(x * 0.3)

/** Mainland, marsh cut by tidal channels, the barrier island with dunes, beach into the ocean. */
function height(x: number, z: number) {
  if (x < MARSH_X) return MAIN_Y
  if (x < MARSH_X + 2) return MAIN_Y + (0.1 - MAIN_Y) * smoothstep(MARSH_X, MARSH_X + 2, x)
  if (x < 2.5) {
    let h = 0.1
    h = -0.35 + (h + 0.35) * smoothstep(0.5, 1.2, Math.abs(x - channelA(z)))
    h = -0.35 + (h + 0.35) * smoothstep(0.7, 1.6, Math.abs(x - channelC(z)))
    h = -0.35 + (h + 0.35) * smoothstep(0.4, 1, Math.abs(z - channelB(x)))
    return h
  }
  if (x < 3.5) return 0.1 + (ISLAND_Y - 0.1) * smoothstep(2.5, 3.5, x)
  if (x < 12) return ISLAND_Y
  if (x < 13.5) return ISLAND_Y + 0.45 * Math.sin(((x - 12) / 1.5) * Math.PI) * (0.6 + 0.4 * Math.sin(z * 0.7))
  return ISLAND_Y - (ISLAND_Y + 0.8) * smoothstep(13.5, 17, x)
}

function colorAt(x: number, z: number, h: number) {
  if (x < MARSH_X + 1) return Math.sin(x * 0.4) * Math.cos(z * 0.3) > 0.3 ? '#67884a' : '#6f8f4e'
  if (x < 2.5) {
    if (h < 0.05) return '#6d6448'
    return Math.sin(x * 1.3 + z * 0.4) + Math.sin(z * 0.9) > 0.5 ? '#8d9157' : '#7a8b52'
  }
  if (x > 12 && x < 13.5 && h > ISLAND_Y + 0.15) return '#b3ad74'
  return h > 0 ? COLORS.sand : '#cdbd90'
}

/** Rail launcher for sounding rockets, tilted toward the ocean. */
function RailLauncher({ position, tilt = 0.25 }: { position: V3; tilt?: number }) {
  return (
    <group position={position}>
      <Building size={[1.4, 0.6, 1.4]} color={COLORS.concrete} />
      <Box size={[0.4, 0.5, 0.4]} position={[0, 0.85, 0]} color={COLORS.steelDark} />
      <group position={[0, 1.1, 0]} rotation={[0, 0, -tilt]}>
        <Box size={[0.2, 4.6, 0.22]} position={[0, 2.1, 0]} color={COLORS.steel} metalness={0.3} />
        <Rocket position={[0.24, 0.3, 0]} height={3.3} radius={0.12} color={COLORS.white} accent="#2e5c9a" />
      </group>
    </group>
  )
}

/** Causeway from the mainland to the island: deck on pillars, with railings. */
const CAUSEWAY_X0 = MARSH_X
const CAUSEWAY_X1 = 3.2

function Causeway({ z }: { z: number }) {
  const pillars = useMemo(() => {
    const items: { p: V3; s: V3 }[] = []
    for (let x = CAUSEWAY_X0 + 0.8; x < CAUSEWAY_X1; x += 1.4) for (const o of [-0.35, 0.35]) items.push({ p: [x, 0.05, z + o], s: [0.1, 0.9, 0.1] })
    return items
  }, [z])
  const cx = (CAUSEWAY_X0 + CAUSEWAY_X1) / 2
  const len = CAUSEWAY_X1 - CAUSEWAY_X0
  return (
    <>
      <Box size={[len, 0.15, 1.1]} position={[cx, 0.52, z]} color={COLORS.concrete} />
      <Box size={[len, 0.02, 0.9]} position={[cx, 0.605, z]} color={COLORS.asphalt} shadows={false} />
      <Box size={[len, 0.12, 0.05]} position={[cx, 0.66, z + 0.53]} color={COLORS.offWhite} />
      <Box size={[len, 0.12, 0.05]} position={[cx, 0.66, z - 0.53]} color={COLORS.offWhite} />
      <Pillars items={pillars} />
    </>
  )
}

/** Runway with centre line, edge lines and threshold stripes at both ends. */
function Runway({ x, length }: { x: number; length: number }) {
  const marks = useMemo(() => {
    const items: { p: V3; s: V3 }[] = []
    for (let z = -length / 2 + 4; z < length / 2 - 4; z += 3.2) items.push({ p: [x, MAIN_Y + 0.045, z], s: [0.12, 0.01, 1.6] })
    for (const side of [-1, 1]) items.push({ p: [x + side * 1.45, MAIN_Y + 0.045, 0], s: [0.06, 0.01, length - 1] })
    for (const end of [-1, 1]) for (let k = -3; k <= 3; k++) if (k !== 0) items.push({ p: [x + k * 0.36, MAIN_Y + 0.045, end * (length / 2 - 1.5)], s: [0.18, 0.01, 1.8] })
    return items
  }, [x, length])
  return (
    <>
      <Box size={[3.2, 0.04, length]} position={[x, MAIN_Y + 0.02, 0]} color={COLORS.asphalt} roughness={1} />
      {marks.map((m, i) => (
        <Box key={i} size={m.s} position={m.p} color={COLORS.white} shadows={false} />
      ))}
    </>
  )
}

const MAIN_EXCLUDE: Rect[] = [
  [-74, -60, -52, 60], // airfield
  [-60, -26, -44, 26], // base buildings
  [-51, -90, -49, 90], // base road
  [-46, 28, -42, 32], // causeway approach
]

/** Wallops Flight Facility: barrier island launch range, marsh, causeway and the mainland base. */
export function WallopsModel() {
  const nature = useMemo(() => {
    const marsh = scatter(1100, [MARSH_X + 2, -80, 2.4, 80], 81).filter(([x, z]) => height(x, z) > 0.06 && !inRect(x, z, [MARSH_X, 28.8, 3.4, 31.2]))
    return {
      pines: scatter(200, [-85, -90, MARSH_X, 90], 82, MAIN_EXCLUDE),
      oaks: scatter(70, [-85, -90, MARSH_X, 90], 83, MAIN_EXCLUDE),
      marsh,
      dunes: scatter(160, [12.1, -80, 13.4, 80], 84),
      seawall: along([14, -50], [14, 12], 70, 0.6, 85),
    }
  }, [])

  const pad0A: V3 = [9.5, ISLAND_Y, -18]
  const pad0B: V3 = [9.5, ISLAND_Y, -4]
  const lc2: V3 = [10, ISLAND_Y, 8]

  return (
    <>
      <Atmosphere haze="#c4d6e4" fogNear={90} fogFar={280} />
      <Clouds seed={21} count={12} area={260} />
      <Terrain size={TERRAIN_SIZE} segments={230} height={height} colorAt={colorAt} />
      {/* still water in the marsh channels and the bay, swell only out on the open ocean */}
      <Water size={[99, 260]} position={[-35.5, 0, 0]} />
      <Ocean size={[210, 260]} position={[119, 0, 0]} amplitude={0.035} segments={120} shore="west" calmWidth={10} />
      {/* beyond the terrain: mainland to the west and along the coast, open water elsewhere */}
      <Flat size={[2000, 2000]} position={[0, -0.4, 0]} color={COLORS.ocean} roughness={0.15} metalness={0.25} />
      <Flat size={[915, 2000]} position={[-85 - 457.5, MAIN_Y, 0]} color={COLORS.grass} />
      {[-1, 1].map((s) => (
        <Flat key={s} size={[85 + MARSH_X, 900]} position={[(-85 + MARSH_X) / 2, MAIN_Y, s * (105 + 450)]} color={COLORS.grass} />
      ))}
      <Rocks points={nature.seawall} scale={0.55} y={ISLAND_Y - 0.25} />

      {/* island road and causeway */}
      <Road from={[ROAD_X, -60]} to={[ROAD_X, 45]} width={0.9} y={ISLAND_Y + 0.02} dashes />
      <Road from={[3.2, 30]} to={[ROAD_X, 30]} width={0.9} y={ISLAND_Y + 0.02} />
      <Causeway z={30} />

      {/* Pad 0A: liquid rocket on its transporter-erector, lightning masts, tanks */}
      <Pad position={pad0A} radius={3.2} rotationY={Math.PI}>
        <SaturnVOnPad pad="0a" profile={PROFILES.saturnVWallops} position={[0, MOUNT_H, 0]} />
        <LatticeTower position={[-0.85, 0.3, 0]} height={6.6} width={0.55} color="#5a6067" crane={false} floorsEvery={4} elevator={false} />
      </Pad>
      <LightningRing center={pad0A} radius={4.8} height={10} />
      <SphereTank position={[pad0A[0] + 2, ISLAND_Y, pad0A[2] - 6.5]} radius={0.9} />
      <HorizontalTank position={[pad0A[0] - 2.5, ISLAND_Y, pad0A[2] - 6.5]} length={2.6} />
      <WaterTower position={[pad0A[0] - 3, ISLAND_Y, pad0A[2] + 5.5]} height={4.5} radius={1} />
      <Fence rect={[pad0A[0] - 4.2, pad0A[2] - 8, pad0A[0] + 3.6, pad0A[2] + 7]} y={ISLAND_Y} />

      {/* horizontal integration building north of the pads */}
      <Hangar position={[8.5, ISLAND_Y, -31]} size={[5, 2.8, 6]} rotationY={-Math.PI / 2} />
      <Box size={[2.4, 0.02, 4]} position={[8.5, ISLAND_Y + 0.012, -26.5]} color={COLORS.concrete} roughness={1} />

      {/* Pad 0B: solid rocket in its red service gantry */}
      <Pad position={pad0B} radius={2.6} rotationY={Math.PI}>
        <SaturnVOnPad pad="0b" profile={PROFILES.saturnVWallops} position={[0, MOUNT_H, 0]} />
        <LatticeTower position={[1.75, 0, 0]} height={7} width={1.2} color={COLORS.tower} arms={[{ y: 5, length: 0.65 }, { y: 3, length: 0.65 }]} />
      </Pad>
      <LightningTower position={[pad0B[0] - 3.2, ISLAND_Y, pad0B[2] + 2.5]} height={10} />

      {/* Launch Complex 2: small carbon-black rocket with a white strongback */}
      <Pad position={lc2} radius={1.9} rotationY={Math.PI}>
        <SaturnVOnPad pad="lc2" profile={PROFILES.saturnVWallops} position={[0, MOUNT_H, 0]} />
        <Box size={[0.22, 3.5, 0.45]} position={[0.75, MOUNT_H + 1.75, 0]} color={COLORS.white} />
      </Pad>
      <Hangar position={[7, ISLAND_Y, lc2[2] + 0.5]} size={[2.6, 1.5, 3]} rotationY={Math.PI / 2} />

      {/* sounding rocket rail launchers and their blockhouse */}
      <RailLauncher position={[10.5, ISLAND_Y, 17]} />
      <RailLauncher position={[11.3, ISLAND_Y, 20]} tilt={0.18} />
      <RailLauncher position={[10.5, ISLAND_Y, 23]} tilt={0.3} />
      <Shed position={[7, ISLAND_Y, 20]} size={[2, 0.9, 1.6]} />

      {/* range radars and tracking dishes */}
      <RadarDome position={[7.5, ISLAND_Y, 28]} radius={1} />
      <RadarDome position={[10.5, ISLAND_Y, 35]} radius={1.3} />
      <Dish position={[10.5, ISLAND_Y, 28.5]} size={1.2} />
      <Dish position={[7, ISLAND_Y, 38]} size={1} speed={-0.2} />

      {/* main base: airfield, hangars, tower, offices, far across the marsh from the pads */}
      <group position={[BASE_SHIFT, 0, 0]}>
      <Runway x={-38} length={80} />
      <Box size={[1.4, 0.03, 60]} position={[-33.5, MAIN_Y + 0.015, 0]} color="#56575b" roughness={1} />
      <Box size={[7, 0.03, 14]} position={[-29, MAIN_Y + 0.015, 0]} color="#56575b" roughness={1} />
      {[-25, 25].map((z) => (
        <Box key={z} size={[4.5, 0.03, 1.2]} position={[-35.5, MAIN_Y + 0.015, z]} color="#56575b" roughness={1} />
      ))}
      <Airplane position={[-29, MAIN_Y, -2]} rotationY={-Math.PI / 2} />
      <Airplane position={[-29.5, MAIN_Y, 4]} rotationY={-Math.PI / 2} color="#e2e6ea" />
      <Hangar position={[-23, MAIN_Y, -5]} size={[5, 2.6, 5]} rotationY={Math.PI} />
      <Hangar position={[-23, MAIN_Y, 5]} size={[5, 2.6, 5]} rotationY={Math.PI} />
      <ControlTower position={[-26, MAIN_Y, 12]} />
      <Office position={[-24, MAIN_Y, -17]} size={[5, 1.8, 3]} floors={2} />
      <ParkingLot position={[-24, MAIN_Y, -12.5]} rows={1} cols={14} seed={6} />
      <Office position={[-17, MAIN_Y, -22]} size={[3, 1.4, 2.4]} floors={2} />
      <WaterTower position={[-17, MAIN_Y, 20]} height={6} radius={1.1} stripe />
      <Road from={[-20, -80]} to={[-20, 80]} width={1.1} y={MAIN_Y + 0.02} dashes />
      <Road from={[-20, 30]} to={[-14, 30]} width={1} y={MAIN_Y + 0.02} />
      <Road from={[-26, -9]} to={[-20, -9]} width={0.9} y={MAIN_Y + 0.02} />
      </group>

      <Trees points={nature.pines} kind="pine" seed={91} ground={height} scale={1.3} />
      <Trees points={nature.oaks} kind="oak" seed={92} ground={height} />
      <Trees points={nature.marsh} kind="shrub" seed={93} ground={height} scale={0.35} />
      <Trees points={nature.dunes} kind="shrub" seed={94} ground={height} scale={0.5} />
    </>
  )
}
