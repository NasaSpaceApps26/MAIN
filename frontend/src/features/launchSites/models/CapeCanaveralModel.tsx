import { useMemo } from 'react'
import { Box, Building, Cylinder, Flat, Pipe, Road } from './basics'
import { COLORS } from './colors'
import { around, MOUNT_H, scatter, type Rect, type V3 } from './lib'
import { Atmosphere, Clouds, Ocean, Surf, Trees } from './nature'
import { Fence, FloodLight, Hangar, HorizontalTank, LatticeTower, Lighthouse, LightningRing, LightningTower, Office, Pad, Ribs, Shed, SphereTank, WaterTower } from './structures'
import { Airplane, ParkingLot, Rocket } from './vehicles'

// x = east (toward the Atlantic), -z = north
const SLC41: V3 = [12, 0, -24]
const SLC40: V3 = [14, 0, 0]
const SLC37: V3 = [12, 0, 24]
const LC34: V3 = [-10, 0, 40]

/** Tall vertical integration building with ribs and a full-height door facing the pad (+x). */
function IntegrationBuilding({ position, size }: { position: V3; size: V3 }) {
  const [w, h, d] = size
  return (
    <group position={position}>
      <Building size={size} color="#dad8d0" />
      <Ribs size={size} spacing={0.8} color="#c4c2ba" />
      <Box size={[0.08, h * 0.88, d * 0.5]} position={[w / 2 + 0.05, (h * 0.88) / 2, 0]} color="#5e666f" metalness={0.2} />
      <Building size={[w * 0.6, 0.6, d * 0.5]} position={[0, h, 0]} color="#bdbbb3" />
      <Building size={[w * 0.9, h * 0.25, d * 0.6]} position={[-w / 2 - (w * 0.9) / 2, 0, 0]} color="#d2d0c8" />
    </group>
  )
}

/** SLC-41: rocket rolled out on rails from the integration buildings, crew access tower, four masts. */
function Slc41() {
  const [x, , z] = SLC41
  return (
    <>
      <IntegrationBuilding position={[-24, 0, z]} size={[4.5, 14, 5]} />
      <IntegrationBuilding position={[-24, 0, z - 8]} size={[4, 12.5, 4.5]} />
      {[-0.55, 0.55].map((o) => (
        <Road key={o} from={[-21.75, z + o]} to={[x, z + o]} width={0.1} y={0.035} color="#4f4b45" />
      ))}
      <Pad position={SLC41} radius={3.4} rotationY={Math.PI}>
        {/* mobile launch platform with a short umbilical mast */}
        <Building size={[3.2, 0.6, 3]} position={[0, 0, 0]} color="#7a8088" />
        <LatticeTower position={[-1.2, 0.6, -1.1]} height={2.5} width={0.6} color="#6f757d" crane={false} floorsEvery={2} elevator={false} />
        <Rocket position={[0, 0.6, 0]} height={8.4} radius={0.34} color="#c98d56" accent="#2b2b2b" fairingRadius={0.46} engines={2} boosters={2} boosterRadius={0.14} boosterHeight={0.3} boosterColor={COLORS.offWhite} />
        <LatticeTower position={[2.4, 0, 0]} height={9.5} width={1.5} color="#7d838a" arms={[{ y: 7.7, length: 1.15, kind: 'crew' }]} />
      </Pad>
      <LightningRing center={SLC41} radius={5.2} height={11.5} />
      <SphereTank position={[x + 6, 0, z - 7]} radius={1.1} />
      <SphereTank position={[x - 5, 0, z - 7]} radius={1.25} />
      <WaterTower position={[x + 7, 0, z + 6]} height={5.5} />
      <Fence rect={[x - 9, z - 10, x + 10, z + 9]} />
    </>
  )
}

/** SLC-40: crewed rocket with strongback and crew tower, hangar and rails, four lightning masts. */
function Slc40() {
  const [x, , z] = SLC40
  return (
    <>
      <Hangar position={[-10, 0, z]} size={[8, 3, 5]} />
      {[-0.6, 0.6].map((o) => (
        <Road key={o} from={[-6, z + o]} to={[x, z + o]} width={0.1} y={0.035} color="#4f4b45" />
      ))}
      <Road from={[-6, z]} to={[x - 3, z]} width={2} color={COLORS.concrete} y={0.018} />
      <Pad position={SLC40} radius={3.3} rotationY={Math.PI}>
        <Rocket position={[0, MOUNT_H, 0]} height={8} radius={0.28} engines={9} gridFins legs capsule />
        <LatticeTower position={[-0.75, 0.3, 0]} height={7.6} width={0.5} color="#3f4349" crane={false} floorsEvery={4} elevator={false} />
        <LatticeTower position={[2.2, 0, 0]} height={9} width={1.4} color="#8a9096" arms={[{ y: 7.25, length: 1.2, kind: 'crew' }]} mast={2} />
      </Pad>
      <LightningRing center={SLC40} radius={5.4} height={12} />
      <SphereTank position={[x - 7, 0, z + 7]} radius={1.1} />
      <HorizontalTank position={[x + 6, 0, z + 7]} length={3} />
      <HorizontalTank position={[x + 6, 0, z + 8.5]} length={3} />
      <Pipe a={[x - 6, 0.4, z + 6]} b={[x - 2, 0.4, z + 1.5]} radius={0.07} />
      <WaterTower position={[x - 7, 0, z - 7]} height={5.5} />
      {[
        [x - 3.8, z - 3.8],
        [x + 3.8, z + 3.8],
      ].map(([lx, lz]) => (
        <FloodLight key={lx} position={[lx, 0, lz]} face={Math.atan2(-(lz - z), lx - x)} />
      ))}
      <Fence rect={[x - 10, z - 10, x + 10, z + 10]} />
    </>
  )
}

/** SLC-37: heavy rocket with three equal cores beside its enclosed mobile service tower. */
function Slc37() {
  const [x, , z] = SLC37
  return (
    <>
      <Pad position={SLC37} radius={3.6} rotationY={Math.PI}>
        <Rocket position={[0, MOUNT_H, 0]} rotation={[0, Math.PI / 2, 0]} height={8.6} radius={0.32} color="#d9772f" accent="#2b2b2b" fairingRadius={0.38} boosters={2} boosterRadius={0.32} boosterHeight={0.74} boosterColor="#d9772f" />
        <LatticeTower position={[-1.9, 0, 0]} height={8} width={1.2} color="#7d838a" rotationY={Math.PI} arms={[{ y: 6.2, length: 1 }, { y: 3.5, length: 1 }]} />
      </Pad>
      {/* mobile service tower, rolled back from the rocket */}
      <group position={[x, 0, z + 5.5]}>
        <Building size={[3.2, 12.5, 3.6]} color="#c9c7bf" />
        <Ribs size={[3.2, 12.5, 3.6]} spacing={0.7} color="#b6b4ac" />
        <Box size={[1.4, 10, 0.05]} position={[0, 5.5, -1.83]} color="#5e666f" />
        {[-1.2, 1.2].map((o) => (
          <Road key={o} from={[o, 2]} to={[o, -6]} width={0.1} y={0.03} color="#4f4b45" />
        ))}
      </group>
      <LightningTower position={[x - 6, 0, z - 5]} height={16} />
      <LightningTower position={[x + 6, 0, z + 9]} height={16} />
      <SphereTank position={[x - 6, 0, z + 6]} radius={1.3} />
      <SphereTank position={[x + 7, 0, z - 6]} radius={1.1} />
      <Fence rect={[x - 8, z - 9, x + 10, z + 11]} />
    </>
  )
}

/** Launch Complex 34, kept as a memorial: bare launch pedestal and the domed blockhouse. */
function Lc34() {
  const [x, , z] = LC34
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.06, 0]} receiveShadow>
        <cylinderGeometry args={[3.6, 3.8, 0.12, 24]} />
        <meshStandardMaterial color="#a8a294" roughness={1} />
      </mesh>
      {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => <Box key={`${sx}${sz}`} size={[0.45, 1.8, 0.45]} position={[sx * 0.9, 1, sz * 0.9]} color="#958f82" />))}
      <Box size={[2.6, 0.5, 2.6]} position={[0, 2.1, 0]} color="#958f82" />
      <Box size={[1.2, 0.52, 1.2]} position={[0, 2.1, 0]} color="#5a564f" />
      <mesh position={[-6, 0, 2]} castShadow>
        <sphereGeometry args={[1.5, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#b7b2a6" roughness={1} />
      </mesh>
      <Box size={[0.6, 0.4, 0.05]} position={[2.5, 0.35, 3]} rotation={[-0.4, 0, 0]} color="#3a3a3a" />
    </group>
  )
}

const HQ_X = -58 // operations centre, far back from the pads for safety
const RUNWAY_X = -88

const TREE_EXCLUDE: Rect[] = [
  [1, -90, 3, 90], // coast road
  [-63, -90, -61, 90], // inland road
  [-32, -41, 24, -12], // SLC-41 and its integration buildings
  [-16, -12, 26, 12], // SLC-40
  [0, 12, 24, 37], // SLC-37
  [-18, 34, -3, 46], // LC-34
  around(-44, 12.5, 3),
  [HQ_X - 6, -10, HQ_X + 8, 3], // operations centre and parking
  [RUNWAY_X - 5, -90, RUNWAY_X + 12, 90], // runway and apron
  [-63, -7, 3, -5], // cross roads
  [-63, 33, 3, 35],
  [20, -90, 60, 90], // beach and ocean
]

/** Cape Canaveral Space Force Station: pads along the Atlantic coast, lighthouse, skid strip. */
export function CapeCanaveralModel() {
  const trees = useMemo(
    () => ({
      shrubs: scatter(460, [-115, -80, 19, 70], 31, TREE_EXCLUDE),
      oaks: scatter(70, [-115, -80, 18, 70], 32, TREE_EXCLUDE),
      palms: [...scatter(16, [HQ_X - 6, -11, HQ_X + 6, -9.5], 33), ...scatter(14, [17, -70, 20, 60], 34, TREE_EXCLUDE)],
      dunes: scatter(120, [19.5, -90, 21.3, 90], 35),
    }),
    [],
  )
  return (
    <>
      <Atmosphere fogNear={90} fogFar={280} />
      <Clouds seed={9} area={260} count={12} />
      {/* land, sloping beach, Atlantic Ocean to the east (waves calm down toward the beach) */}
      <Flat size={[1220, 1600]} position={[21 - 610, 0, 0]} color={COLORS.grassDry} />
      <Box size={[8, 0.4, 1600]} position={[25, -0.494, 0]} rotation={[0, 0, -0.076]} color={COLORS.sand} roughness={1} />
      <Ocean size={[220, 260]} position={[131, -0.12, 0]} shore="west" calmWidth={14} />
      <Flat size={[1600, 1600]} position={[821, -0.4, 0]} color={COLORS.ocean} roughness={0.15} metalness={0.25} />
      <Surf x={23} z0={-400} z1={400} y={-0.1} />

      <Road from={[2, -100]} to={[2, 100]} width={1.3} dashes edges />
      <Road from={[-62, -100]} to={[-62, 100]} width={1.2} dashes />
      <Road from={[-62, -6]} to={[2, -6]} width={1} dashes />
      <Road from={[-62, 34]} to={[2, 34]} width={1} />
      <Road from={[2, SLC41[2] + 5]} to={[SLC41[0] - 3, SLC41[2] + 5]} width={0.8} />
      <Road from={[2, SLC37[2] - 4]} to={[SLC37[0] - 3, SLC37[2] - 3]} width={0.8} />
      <Road from={[RUNWAY_X + 10, -6]} to={[-62, -6]} width={1} />

      <Slc41 />
      <Slc40 />
      <Slc37 />
      <Lc34 />
      <Lighthouse position={[-46, 0, 12]} />

      {/* operations centre with parking */}
      <Office position={[HQ_X, 0, -6]} size={[6, 2.6, 4]} floors={4} />
      <ParkingLot position={[HQ_X, 0, -0.5]} rows={2} cols={20} seed={8} />
      <Shed position={[-4, 0, 14]} size={[2.4, 1, 1.6]} />
      <Shed position={[-14, 0, -16]} size={[2, 1, 1.4]} />

      {/* skid strip runway and apron */}
      <Box size={[3.2, 0.04, 90]} position={[RUNWAY_X, 0.02, 0]} color={COLORS.asphalt} roughness={1} />
      {Array.from({ length: 24 }, (_, i) => (
        <Box key={i} size={[0.14, 0.01, 1.8]} position={[RUNWAY_X, 0.045, -42 + i * 3.6]} color={COLORS.white} shadows={false} />
      ))}
      <Box size={[6, 0.03, 10]} position={[RUNWAY_X + 5, 0.02, 0]} color="#56575b" roughness={1} />
      <Airplane position={[RUNWAY_X + 5, 0, 2.5]} rotationY={Math.PI / 2} />
      <Hangar position={[RUNWAY_X + 7, 0, -6]} size={[5, 2.4, 4]} rotationY={Math.PI} />
      <Cylinder radius={0.02} height={3} position={[RUNWAY_X + 7, 4, -3]} color={COLORS.steel} segments={4} />

      <Trees points={trees.shrubs} kind="shrub" seed={41} />
      <Trees points={trees.oaks} kind="oak" seed={42} scale={0.9} />
      <Trees points={trees.palms} kind="palm" seed={43} />
      <Trees points={trees.dunes} kind="shrub" seed={44} scale={0.6} />
    </>
  )
}
