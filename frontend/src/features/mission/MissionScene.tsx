import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { BufferAttribute, BufferGeometry, Group, Vector3 } from 'three'
import type { StateSample } from '../../api/types'
import { positionAt } from '../../components/SolarSystem/orbitMath'
import { useSimStore } from '../../store/simStore'
import { type FlightPath, countUpTo, flightPathOf, phaseSpeed } from './flightPath'
import { rocketTracker, useMissionStore } from './missionStore'

const OBLIQUITY = (23.439291111 * Math.PI) / 180
/** Earth's north pole in scene axes (ecliptic frame, y = ecliptic north). */
const EARTH_POLE = new Vector3(0, Math.cos(OBLIQUITY), -Math.sin(OBLIQUITY))
const EARTH_SPIN = 7.2921159e-5 // rad/s

const labelStyle = {
  transform: 'translate(10px, -50%)',
  padding: '1px 6px',
  border: '1px solid',
  borderRadius: 4,
  background: 'var(--panel)',
  fontSize: 11,
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
} as const

type Props = {
  earth?: StateSample[]
  moon?: StateSample[]
}

/** Two copies of one line sharing the same points: the whole path dim, the flown part bright. */
function useLine(positions: Float32Array, colors: Float32Array) {
  return useMemo(() => {
    const pos = new BufferAttribute(positions, 3)
    const col = new BufferAttribute(colors, 3)
    const all = new BufferGeometry()
    all.setAttribute('position', pos)
    all.setAttribute('color', col)
    const flown = new BufferGeometry()
    flown.setAttribute('position', pos)
    flown.setAttribute('color', col)
    flown.setDrawRange(0, 0)
    return { all, flown }
  }, [positions, colors])
}

function PathLines({ path, earth, moon }: { path: FlightPath } & Required<Props>) {
  const earthGroup = useRef<Group>(null)
  const moonGroup = useRef<Group>(null)
  const rocket = useRef<Group>(null)
  const site = useRef<Group>(null)
  const label = useRef<HTMLDivElement>(null)
  const e = useLine(path.earthLine.positions, path.earthLine.colors)
  const m = useLine(path.moonLine.positions, path.moonLine.colors)
  const v = useMemo(() => ({ earth: new Vector3(), moon: new Vector3(), tmp: new Vector3() }), [])

  useEffect(
    () => () => {
      for (const g of [e.all, e.flown, m.all, m.flown]) g.dispose()
      rocketTracker.active = false
    },
    [e, m],
  )

  useFrame(() => {
    const sim = useSimStore.getState()
    const tS = (sim.simTimeMs - path.launchMs) / 1000
    positionAt(earth, sim.simTimeMs, v.earth)
    positionAt(moon, sim.simTimeMs, v.moon)

    // the flight up to the Moon, geocentric: moves with Earth
    earthGroup.current?.position.copy(v.earth)
    e.flown.setDrawRange(0, countUpTo(path.earthLine.times, tS))

    // lunar orbit and landing: before arrival drawn where the Moon will be, then it rides on the Moon
    if (moonGroup.current) {
      if (tS < path.arrivalS) moonGroup.current.position.copy(v.earth).add(path.moonGeo(path.arrivalS, v.tmp))
      else moonGroup.current.position.copy(v.moon)
    }
    m.flown.setDrawRange(0, countUpTo(path.moonLine.times, tS))

    // the spacecraft; before liftoff it stands on the pad and turns with Earth
    if (rocket.current) {
      if (tS < 0) {
        path.spacecraft(0, v.earth, v.moon, v.tmp).sub(v.earth)
        v.tmp.applyAxisAngle(EARTH_POLE, EARTH_SPIN * tS)
        rocket.current.position.copy(v.earth).add(v.tmp)
      } else path.spacecraft(tS, v.earth, v.moon, rocket.current.position)
      rocketTracker.active = true
      rocketTracker.position.copy(rocket.current.position)
    }
    site.current?.position.copy(v.moon).add(path.site(tS, v.tmp))

    const st = path.state(Math.max(tS, 0))
    rocketTracker.phase = tS < 0 ? 'On the launch pad' : st.phase
    rocketTracker.tS = tS
    if (label.current) label.current.textContent = rocketTracker.phase

    // clock speed follows the phase while the flight plays; pause when it is over
    const { autoSpeed } = useMissionStore.getState()
    if (autoSpeed && sim.isPlaying && tS > -600) {
      if (tS > path.endS) {
        sim.togglePlay()
        sim.setTimeScale(60)
      } else {
        const want = tS < 0 ? 10 : phaseSpeed(st.phase, st.moonDistKm)
        if (sim.timeScale !== want) sim.setTimeScale(want)
      }
    }
  })

  return (
    <>
      <group ref={earthGroup}>
        <line>
          <primitive object={e.all} attach="geometry" />
          <lineBasicMaterial vertexColors transparent opacity={0.3} depthWrite={false} />
        </line>
        <line>
          <primitive object={e.flown} attach="geometry" />
          <lineBasicMaterial vertexColors />
        </line>
      </group>
      <group ref={moonGroup}>
        <line>
          <primitive object={m.all} attach="geometry" />
          <lineBasicMaterial vertexColors transparent opacity={0.3} depthWrite={false} />
        </line>
        <line>
          <primitive object={m.flown} attach="geometry" />
          <lineBasicMaterial vertexColors />
        </line>
      </group>

      <group ref={rocket}>
        <points>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[new Float32Array(3), 3]} />
          </bufferGeometry>
          <pointsMaterial color="#ffffff" size={7} sizeAttenuation={false} depthTest={false} />
        </points>
        <Html zIndexRange={[1, 1]}>
          <div style={{ ...labelStyle, color: '#ffffff', borderColor: '#ffffff88' }}>
            <span ref={label} />
          </div>
        </Html>
      </group>

      <group ref={site}>
        <points>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[new Float32Array(3), 3]} />
          </bufferGeometry>
          <pointsMaterial color="#7dff8a" size={9} sizeAttenuation={false} />
        </points>
        <Html zIndexRange={[1, 1]}>
          <div style={{ ...labelStyle, color: '#7dff8a', borderColor: '#7dff8a88' }}>Landing site</div>
        </Html>
      </group>
    </>
  )
}

/** The computed flight in the solar system: path, spacecraft and landing site. */
export function MissionScene({ earth, moon }: Props) {
  const result = useMissionStore((s) => s.result)
  const path = useMemo(() => (result?.trajectory ? flightPathOf(result.trajectory) : null), [result])
  if (!path || !earth || !moon) return null
  return <PathLines path={path} earth={earth} moon={moon} />
}
