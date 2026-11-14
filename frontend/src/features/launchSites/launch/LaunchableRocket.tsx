import { useEffect, useRef, useState, type ComponentType, type RefObject } from 'react'
import { createPortal, useFrame, useThree } from '@react-three/fiber'
import type { Group } from 'three'
import { Rocket, type RocketProps } from '../models/vehicles'
import { Flame } from './Flame'
import { FlightSim } from './flightSim'
import { useLaunchStore } from './launchStore'
import type { FlightProfile } from './profiles'

type Props = RocketProps & {
  pad: string // pad id from sites.ts; the Launch button for that pad flies this rocket
  profile: FlightProfile
  track?: boolean // the camera and mission clock follow this rocket (one per pad)
  vehicle?: ComponentType<RocketProps> // what to draw: Rocket, or a specific one like SaturnV
}

/**
 * A rocket standing on its pad that flies when its pad is launched. On the pad it is an ordinary
 * vehicle model; once launched it is drawn in world space (so its smoke stays behind) and the pad stays
 * empty until the launch is reset.
 */
export function LaunchableRocket({
  pad,
  profile,
  track = true,
  vehicle: Vehicle = Rocket,
  position = [0, 0, 0],
  ...rocket
}: Props) {
  const anchor = useRef<Group>(null)
  const run = useLaunchStore((s) => (s.padId === pad ? s.run : 0))
  const scene = useThree((s) => s.scene)
  return (
    <>
      <group ref={anchor} position={position}>
        {run === 0 && <Vehicle {...rocket} />}
      </group>
      {run > 0 &&
        createPortal(
          <Flight
            key={run}
            anchor={anchor}
            rocket={rocket}
            profile={profile}
            track={track}
            Vehicle={Vehicle}
          />,
          scene,
        )}
    </>
  )
}

/** The flying rocket: its stages and boosters as separate pieces, their flames and smoke. */
function Flight({
  anchor,
  rocket,
  profile,
  track,
  Vehicle,
}: {
  anchor: RefObject<Group | null>
  rocket: RocketProps
  profile: FlightProfile
  track: boolean
  Vehicle: ComponentType<RocketProps>
}) {
  const scene = useThree((s) => s.scene)
  const report = useLaunchStore((s) => s.report)
  // one simulation per launch (this component is keyed by the launch run)
  const [sim] = useState(() => new FlightSim(rocket, profile, track, report))
  useEffect(() => () => sim.dispose(), [sim])
  useFrame((state, dt) => sim.step(dt, anchor.current, scene, state.camera))

  const { dims } = sim
  const rotation = rocket.rotation
  return (
    <>
      <primitive object={sim.pool.mesh} />
      <group ref={(g) => sim.setGroup('stage1', g)} visible={false}>
        <group rotation={rotation}>
          <Vehicle {...rocket} rotation={undefined} part="stage1" />
          <Flame radius={sim.coreRadius} kind={profile.core} burn={sim.stage1.burn} />
        </group>
      </group>
      <group ref={(g) => sim.setGroup('upper', g)} visible={false}>
        <group rotation={rotation}>
          <Vehicle {...rocket} rotation={undefined} part="upper" />
          <Flame
            position={[0, dims.y3 - dims.radius * 0.7, 0]}
            radius={dims.radius * 0.5}
            kind="vacuum"
            burn={sim.upper.burn}
          />
        </group>
      </group>
      {dims.boosterAt.map((b, i) => (
        <group key={i} ref={(g) => sim.setGroup(i, g)} visible={false}>
          <group rotation={rotation}>
            <Vehicle {...rocket} rotation={undefined} part={{ booster: i }} />
            <Flame
              position={[b.x, 0, b.z]}
              radius={dims.boosterRadius * 0.75}
              kind={profile.boosters ?? 'solid'}
              burn={sim.boosters[i].burn}
            />
          </group>
        </group>
      ))}
    </>
  )
}
