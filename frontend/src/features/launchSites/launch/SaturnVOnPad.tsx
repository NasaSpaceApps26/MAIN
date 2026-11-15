import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Object3D, Quaternion, Vector3, type SpotLight } from 'three'
import { SATURN_V, type V3 } from '../models/lib'
import { COLORS } from '../models/colors'
import { Box, Cylinder } from '../models/basics'
import { SaturnV } from '../models/vehicles'
import { nightMaterials, sky } from '../sky/skyState'
import { LaunchableRocket } from './LaunchableRocket'
import type { FlightProfile } from './profiles'

/** Where the rocket floodlights stand, in degrees around the rocket from +x (the usual tower side). */
const LIGHT_ANGLES = [70, 110, -70, -110]
const LIGHT_DIST = 4.6
const LAMP_Y = 0.55 // lamp height above the rocket's base
const POLE_DEPTH = 4 // the pole reaches this far below the base, down into the ground or the pad
const UP = new Vector3(0, 1, 0)

/**
 * Floodlights around a rocket on its pad, aimed up at it. At night they light the rocket (two real
 * spot lights per pad, from opposite sides) and show faint beams; by day they are just lamp masts.
 */
function RocketFloodLights({ height, angles = LIGHT_ANGLES }: { height: number; angles?: number[] }) {
  const night = nightMaterials()
  const aim = useMemo(() => new Vector3(0, height * 0.5, 0), [height])
  const lamps = useMemo(
    () =>
      angles.map((deg, i) => {
        const a = (deg * Math.PI) / 180
        const pos = new Vector3(Math.cos(a) * LIGHT_DIST, LAMP_Y, Math.sin(a) * LIGHT_DIST)
        const to = aim.clone().sub(pos)
        const len = to.length()
        const quat = new Quaternion().setFromUnitVectors(UP, to.normalize())
        // spot lights only on every other lamp: from two sides is enough, and lights are not free
        return { pos, quat, len, spot: i % 2 === 0 }
      }),
    [angles, aim],
  )
  const target = useMemo(() => {
    const o = new Object3D()
    o.position.copy(aim)
    return o
  }, [aim])
  const spots = useRef<(SpotLight | null)[]>([])
  useFrame(() => {
    for (const s of spots.current) if (s) s.intensity = 140 * sky.night
  })

  return (
    <group>
      <primitive object={target} />
      {lamps.map(({ pos, quat, len, spot }, i) => (
        <group key={i} position={pos}>
          <Cylinder
            radius={0.05}
            height={POLE_DEPTH + LAMP_Y - 0.1}
            position={[0, -(POLE_DEPTH + LAMP_Y) / 2 - 0.05, 0]}
            color={COLORS.steel}
            segments={6}
          />
          <group quaternion={quat}>
            <Box size={[0.42, 0.2, 0.42]} color={COLORS.dark} />
            <mesh position={[0, 0.105, 0]} material={night.lamp}>
              <boxGeometry args={[0.36, 0.02, 0.36]} />
            </mesh>
            {/* faint beam up the rocket, only at night (wide end at the rocket) */}
            <mesh position={[0, len / 2 + 0.1, 0]} rotation={[Math.PI, 0, 0]} material={night.beam}>
              <coneGeometry args={[height * 0.16, len, 20, 1, true]} />
            </mesh>
          </group>
          {spot && (
            <spotLight
              ref={(s) => void (spots.current[i] = s)}
              target={target}
              color="#fff1d0"
              intensity={0}
              distance={height * 3}
              angle={Math.atan((height * 0.62) / len)}
              penumbra={0.6}
              decay={1.6}
            />
          )}
        </group>
      ))}
    </group>
  )
}

/** A Saturn V standing on a pad (base at `position`) that flies when that pad is launched. */
export function SaturnVOnPad({
  pad,
  profile,
  position = [0, 0, 0],
  lights,
}: {
  pad: string
  profile: FlightProfile
  position?: V3
  lights?: number[] // floodlight angles (degrees from +x), when the default places hit something
}) {
  return (
    <group position={position}>
      <RocketFloodLights height={SATURN_V.height} angles={lights} />
      <LaunchableRocket
        pad={pad}
        profile={profile}
        vehicle={SaturnV}
        height={SATURN_V.height}
        radius={SATURN_V.radius}
        engines={SATURN_V.engines}
      />
    </group>
  )
}
