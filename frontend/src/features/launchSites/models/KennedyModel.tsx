import { useMemo } from 'react'
import { Box, Building, Flat, Pipe, Road, RoadPath, Water } from './basics'
import { COLORS } from './colors'
import { around, SATURN_V, scatter, type Rect } from './lib'
import { Atmosphere, Clouds, Ocean, Surf, Trees } from './nature'
import { Fence, Flag, FloodLight, LightningRing, Mound, Office, Pad, Ribs, Shed, SphereTank, WaterTower } from './structures'
import { Crawler, MobileLauncher, ParkingLot, Rocket, SaturnV } from './vehicles'
import { LaunchableRocket } from '../launch/LaunchableRocket'
import { PROFILES } from '../launch/profiles'

// x = east (toward the Atlantic), -z = north
const VAB_X = -58 // the assembly building and control centre sit far back from the pads, for safety
const LCC_X = -42
const PAD_A: [number, number] = [22, -14]
const PAD_B: [number, number] = [6, -40]
const LANE_GAP = 0.85 // half the distance between the two crawlerway lanes
const CRAWLER_A: [number, number][] = [
  [VAB_X + 8, 0],
  [2, 0],
  [17.5, -11.5],
]
const CRAWLER_B: [number, number][] = [
  [2, 0],
  [4.5, -34.5],
]

/** Same polyline moved sideways by d (positive = to the left of the direction of travel). */
function offsetPath(pts: [number, number][], d: number): [number, number][] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(pts.length - 1, i + 1)]
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const len = Math.hypot(dx, dz)
    return [p[0] + (dz / len) * d, p[1] - (dx / len) * d]
  })
}

function Crawlerway({ points }: { points: [number, number][] }) {
  return (
    <>
      <RoadPath points={points} width={LANE_GAP * 2 + 1.1} color="#7f9157" y={0.012} />
      <RoadPath points={offsetPath(points, LANE_GAP)} width={1.1} color={COLORS.gravel} y={0.02} />
      <RoadPath points={offsetPath(points, -LANE_GAP)} width={1.1} color={COLORS.gravel} y={0.02} />
    </>
  )
}

/** The Vehicle Assembly Building with its low bay, tall doors, panelled walls and painted flag. */
function VehicleAssemblyBuilding() {
  const size: [number, number, number] = [16, 16, 13]
  const slats = useMemo(() => Array.from({ length: 18 }, (_, i) => 0.6 + i * 0.75), [])
  return (
    <group position={[VAB_X, 0, 0]}>
      <Building size={size} color="#e4e4df" />
      <Ribs size={size} spacing={1.05} color="#cacbc6" />
      <Building size={[16.3, 0.9, 13.3]} position={[0, 15.4, 0]} color="#c9c9c4" />
      {/* roof units */}
      <Building size={[3, 0.8, 2.5]} position={[-3, 16.3, -2]} color="#a9aaa6" />
      <Building size={[2, 0.6, 2]} position={[4, 16.3, 3]} color="#a9aaa6" />
      {/* two high bay doors on the east face: wide lower door and narrow upper slot */}
      {[-3.2, 3.2].map((z) => (
        <group key={z} position={[8.06, 0, z]}>
          <Box size={[0.1, 6.5, 3]} position={[0, 3.25, 0]} color="#69717b" metalness={0.2} />
          <Box size={[0.1, 8, 1.6]} position={[0, 10.5, 0]} color="#69717b" metalness={0.2} />
          {slats.map((y) => (
            <Box key={y} size={[0.03, 0.05, y < 6.5 ? 3 : 1.6]} position={[0.06, y, 0]} color="#4c535b" shadows={false} />
          ))}
        </group>
      ))}
      {/* low bay on the south side */}
      <group position={[0, 0, 9.5]}>
        <Building size={[13, 6.5, 6]} color="#dcdcd6" />
        <Ribs size={[13, 6.5, 6]} spacing={1} color="#c6c6c1" faces="z" />
        {[-4, 0, 4].map((x) => (
          <Box key={x} size={[2.2, 4, 0.08]} position={[x, 2, 3.03]} color="#69717b" />
        ))}
      </group>
      {/* flag painted on the south wall above the low bay */}
      <Flag position={[-3.2, 11.5, 6.55]} width={6} />
    </group>
  )
}

/**
 * Launch Complex 39A as in the Apollo years: a Saturn V on its mobile launcher with the red launch
 * umbilical tower and its swing arms (the crew access arm at the command module), tanks, lights.
 */
function PadA() {
  const [x, z] = PAD_A
  const lights: [number, number][] = [
    [3.3, 3.3],
    [-3.3, 3.3],
    [3.3, -3.3],
    [-3.3, -3.3],
  ]
  const pedestals = [-1.8, 0, 1.8].flatMap((px) => [-1.6, 1.6].map((pz) => [px, pz] as const))
  // arms reach from the tower's inner face (1.45 from the rocket's axis) to the rocket's skin
  const toSkin = (r: number) => 1.45 - r
  return (
    <>
      <Mound position={[x, 0, z]} radius={6.5}>
        <Pad radius={3.4} rotationY={Math.PI}>
          {pedestals.map(([px, pz]) => (
            <Box key={`${px}${pz}`} size={[0.4, 0.3, 0.4]} position={[px, 0.15, pz]} color={COLORS.concreteDark} />
          ))}
          <group position={[0, 0.3, 0]}>
            <MobileLauncher
              towerHeight={12.2}
              towerColor={COLORS.tower}
              arms={[
                { y: 1.6, length: toSkin(SATURN_V.radius) },
                { y: 3.3, length: toSkin(SATURN_V.radius) },
                { y: 4.4, length: toSkin(SATURN_V.radius) },
                { y: 5.6, length: toSkin(SATURN_V.radius) },
                { y: 6.5, length: toSkin(SATURN_V.radius) },
                { y: 7.6, length: toSkin(SATURN_V.upperRadius) },
                { y: 8.5, length: toSkin(SATURN_V.upperRadius) },
                { y: 10, length: toSkin(0.12), kind: 'crew' },
              ]}
            >
              <LaunchableRocket pad="39a" profile={PROFILES.saturnV} vehicle={SaturnV} height={SATURN_V.height} radius={SATURN_V.radius} engines={SATURN_V.engines} />
            </MobileLauncher>
          </group>
        </Pad>
        {lights.map(([lx, lz]) => (
          <FloodLight key={`${lx}${lz}`} position={[lx, 0, lz]} face={Math.atan2(-lz, lx)} height={3} />
        ))}
      </Mound>
      <SphereTank position={[x - 8, 0, z - 6]} radius={1.1} />
      <SphereTank position={[x + 8, 0, z + 6]} radius={1.3} />
      <Pipe a={[x - 7, 0.4, z - 5]} b={[x - 2.5, 0.9, z - 1]} radius={0.08} />
      <Pipe a={[x + 7, 0.4, z + 5]} b={[x + 2.5, 0.9, z + 1]} radius={0.08} />
      <WaterTower position={[x + 8, 0, z - 8]} height={6.5} radius={1.2} />
      <Shed position={[x - 9, 0, z + 5]} />
      <Fence rect={[x - 11, z - 11, x + 11, z + 11]} />
      <Road from={[x - 11, z + 9]} to={[x - 4, z + 4]} width={0.9} />
    </>
  )
}

/** Launch Complex 39B: mobile launcher with a heavy-lift rocket, three lightning towers. */
function PadB() {
  const [x, z] = PAD_B
  const pedestals = [-1.8, 0, 1.8].flatMap((px) => [-1.6, 1.6].map((pz) => [px, pz] as const))
  return (
    <>
      <Mound position={[x, 0, z]} radius={6.5}>
        <Pad radius={3.4} rotationY={Math.PI}>
          {pedestals.map(([px, pz]) => (
            <Box key={`${px}${pz}`} size={[0.4, 0.3, 0.4]} position={[px, 0.15, pz]} color={COLORS.concreteDark} />
          ))}
          <group position={[0, 0.3, 0]}>
            <MobileLauncher
              towerHeight={12.5}
              arms={[
                { y: 8.4, length: 1.05, kind: 'crew' },
                { y: 6, length: 1.05 },
                { y: 3.4, length: 1.05 },
              ]}
            >
              <Rocket
                rotation={[0, Math.PI / 2, 0]}
                height={9.8}
                radius={0.42}
                color="#d9772f"
                accent="#c8692a"
                engines={4}
                boosters={2}
                boosterRadius={0.2}
                boosterHeight={0.56}
                capsule
              />
            </MobileLauncher>
          </group>
        </Pad>
      </Mound>
      <LightningRing center={[x, 0, z]} radius={7.6} height={14} count={3} angle={-Math.PI / 2} />
      <WaterTower position={[x + 9, 0, z - 6]} height={6.5} radius={1.2} />
      <SphereTank position={[x - 9, 0, z - 3]} radius={1.1} />
      <SphereTank position={[x + 9, 0, z + 5]} radius={1.3} />
      <Fence rect={[x - 12, z - 12, x + 12, z + 10]} />
    </>
  )
}

const TREE_EXCLUDE: Rect[] = [
  [VAB_X - 11, -8, VAB_X + 11, 14], // VAB
  [LCC_X - 6, 6, LCC_X + 12, 21], // LCC and parking
  [VAB_X - 17, 8, VAB_X - 7, 20], // second parking lot
  [VAB_X - 6, 16, VAB_X + 6, 70], // turning basin and canal
  [-140, 16.8, 40, 19.2], // main road
  [-91.5, -90, -88.5, 90], // parkway
  [VAB_X + 7, -2.5, 4, 2.5], // crawlerway
  around(10, -6, 4),
  around(15, -10, 4),
  [0, -36, 7.5, 0], // crawlerway to 39B
  [9, -27, 35, -1], // pad 39A
  [-8, -54, 20, -27], // pad 39B
  [28, -90, 60, 90], // beach and ocean
]

/** Kennedy Space Center: Vehicle Assembly Building, Launch Control Center, crawlerways, pads 39A and 39B. */
export function KennedyModel() {
  const trees = useMemo(
    () => ({
      shrubs: scatter(480, [-120, -80, 28, 70], 11, TREE_EXCLUDE),
      oaks: scatter(90, [-120, -80, 26, 70], 12, TREE_EXCLUDE),
      pines: scatter(110, [-140, -80, -92, 70], 13, TREE_EXCLUDE),
      palms: [
        ...scatter(12, [LCC_X - 8, 19.5, LCC_X + 12, 22], 14),
        ...scatter(10, [VAB_X - 12, -12, VAB_X + 12, -9], 15),
        ...scatter(14, [26, -70, 29.5, 60], 16),
      ],
      dunes: scatter(110, [28.5, -90, 30.3, 90], 17),
    }),
    [],
  )
  return (
    <>
      <Atmosphere fogNear={90} fogFar={280} />
      <Clouds area={260} count={12} />
      {/* land, sloping beach, Atlantic Ocean to the east (waves calm down toward the beach) */}
      <Flat size={[1230, 1600]} position={[30 - 615, 0, 0]} color={COLORS.grass} />
      <Box size={[8, 0.4, 1600]} position={[34, -0.494, 0]} rotation={[0, 0, -0.076]} color={COLORS.sand} roughness={1} />
      <Ocean size={[220, 260]} position={[140, -0.12, 0]} shore="west" calmWidth={14} />
      <Flat size={[1600, 1600]} position={[830, -0.4, 0]} color={COLORS.ocean} roughness={0.15} metalness={0.25} />
      <Surf x={32} z0={-400} z1={400} y={-0.1} />

      {/* turning basin and barge canal */}
      <Water size={[10, 6]} position={[VAB_X, 0.012, 20]} />
      <Water size={[3, 50]} position={[VAB_X, 0.012, 47]} />

      {/* roads */}
      <Road from={[-140, 18]} to={[28, 18]} width={1.2} dashes />
      <Road from={[-90, -100]} to={[-90, 100]} width={1.6} dashes edges />
      <Road from={[LCC_X - 1, 18]} to={[LCC_X - 1, 13]} width={0.8} />
      <Road from={[VAB_X - 8, 18]} to={[VAB_X - 8, 14]} width={0.8} />
      <Road from={[4, 18]} to={[13, -2]} width={0.9} />

      <VehicleAssemblyBuilding />

      {/* Launch Control Center: four floors, slanted firing room windows facing the pads */}
      <Office position={[LCC_X, 0, 10]} size={[6, 2.8, 3.5]} floors={4} />
      <Box size={[5.6, 0.9, 0.5]} position={[LCC_X, 2.4, 8.1]} rotation={[-0.5, 0, 0]} color={COLORS.glass} metalness={0.4} roughness={0.2} />
      <Pipe a={[LCC_X - 3, 2, 8.25]} b={[VAB_X + 8, 2, 5]} radius={0.25} color={COLORS.offWhite} />
      <ParkingLot position={[LCC_X + 1, 0, 15.3]} rows={2} cols={18} seed={3} />
      <ParkingLot position={[VAB_X - 12, 0, 14]} rows={3} cols={12} seed={4} rotationY={Math.PI / 2} />
      <Flag position={[LCC_X - 5, 3.6, 13]} width={1.1} rotationY={Math.PI / 2} pole />

      {/* crawlerways and a crawler-transporter on its way out to the pads */}
      <Crawlerway points={CRAWLER_A} />
      <Crawlerway points={CRAWLER_B} />
      <Crawler position={[-24, 0, 0]} />

      <PadA />
      <PadB />

      <Office position={[-100, 0, 26]} size={[5, 1.8, 3]} floors={2} />
      <Shed position={[-6, 0, -12]} size={[2.5, 1.2, 1.8]} />

      <Trees points={trees.shrubs} kind="shrub" seed={21} />
      <Trees points={trees.oaks} kind="oak" seed={22} />
      <Trees points={trees.pines} kind="pine" seed={23} scale={1.3} />
      <Trees points={trees.palms} kind="palm" seed={24} />
      <Trees points={trees.dunes} kind="shrub" seed={25} scale={0.6} />
    </>
  )
}
