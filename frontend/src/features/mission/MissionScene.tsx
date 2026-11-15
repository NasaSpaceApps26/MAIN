import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { BufferAttribute, BufferGeometry, Group, Vector3 } from 'three'
import type { StateSample } from '../../api/types'
import { positionAt } from '../../components/SolarSystem/orbitMath'
import { useSimStore } from '../../store/simStore'
import { type FlightPath, countUpTo, drawScaleFor, flightPathOf, phaseSpeed, turnWithMoon, warpFromMoon } from './flightPath'
import { rocketTracker, useMissionStore } from './missionStore'

const OBLIQUITY = (23.439291111 * Math.PI) / 180
/** Earth's north pole in scene axes (ecliptic frame, y = ecliptic north). */
const EARTH_POLE = new Vector3(0, Math.cos(OBLIQUITY), -Math.sin(OBLIQUITY))
const EARTH_SPIN = 7.2921159e-5 // rad/s
/** Clock speed after touchdown: 1 h/s, the slowest speed in the top bar. */
const LANDED_TIME_SCALE = 3_600

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
  // the flight stretched to the planet size picked in the top bar (see DrawScale)
  const planetSize = useSimStore((s) => s.planetSize)
  const scale = useMemo(() => drawScaleFor(planetSize), [planetSize])
  const drawn = useMemo(() => path.drawnLines(scale), [path, scale])
  const e = useLine(drawn.earth, path.earthLine.colors)
  const m = useLine(drawn.moon, path.moonLine.colors)
  const v = useMemo(() => ({ earth: new Vector3(), moon: new Vector3(), tmp: new Vector3() }), [])

  // Touchdown: the clock stops there. When it is started again by hand, this mission's path
  // disappears (the rocket and the landing site stay). A newly computed flight shows its path again.
  const [hiddenFor, setHiddenFor] = useState<FlightPath | null>(null)
  const pathHidden = hiddenFor === path
  const lastTS = useRef<number | null>(null) // tS in the previous frame, to see the touchdown being crossed
  const stoppedAtTouchdown = useRef(false)
  useEffect(() => {
    lastTS.current = null
    stoppedAtTouchdown.current = false
  }, [path])

  useEffect(
    () => () => {
      for (const g of [e.all, e.flown, m.all, m.flown]) g.dispose()
      rocketTracker.active = false
    },
    [e, m],
  )

  useFrame(() => {
    const sim = useSimStore.getState()
    let tS = (sim.simTimeMs - path.launchMs) / 1000

    // the clock runs over the touchdown: stop it exactly there. Not with togglePlay(): pausing by
    // hand also moves the planned launch time to the clock, which would change the mission.
    const touchdown = path.touchdownS
    const before = lastTS.current
    lastTS.current = tS
    if (touchdown !== null && sim.isPlaying && before !== null && before < touchdown && tS >= touchdown) {
      const touchdownMs = path.launchMs + touchdown * 1000
      useSimStore.setState({ isPlaying: false, simTimeMs: touchdownMs })
      tS = touchdown
      lastTS.current = tS
      stoppedAtTouchdown.current = true
    } else if (stoppedAtTouchdown.current && sim.isPlaying) {
      // started again by hand after the stop: hide this mission's path
      stoppedAtTouchdown.current = false
      setHiddenFor(path)
    }
    positionAt(earth, sim.simTimeMs, v.earth)
    positionAt(moon, sim.simTimeMs, v.moon)
    v.moon.sub(v.earth).multiplyScalar(scale.orbit).add(v.earth) // where the Moon is drawn

    // the flight up to the Moon, geocentric: moves with Earth
    earthGroup.current?.position.copy(v.earth)
    e.flown.setDrawRange(0, countUpTo(path.earthLine.times, tS))

    // lunar orbit and landing: before arrival drawn where the Moon will be, then it rides on the Moon
    if (moonGroup.current) {
      if (tS < path.arrivalS)
        moonGroup.current.position.copy(v.earth).add(path.moonGeo(path.arrivalS, v.tmp).multiplyScalar(scale.orbit))
      else moonGroup.current.position.copy(v.moon)
    }
    m.flown.setDrawRange(0, countUpTo(path.moonLine.times, tS))

    // after the last sample the flight data stops, but the Moon keeps turning: what is on the
    // surface (the landed spacecraft, the landing site) turns with it instead of staying behind
    const endMs = path.launchMs + path.endS * 1000
    const afterEnd = tS > path.endS

    // the spacecraft; before liftoff it stands on the pad and turns with Earth
    if (rocket.current) {
      if (tS < 0) {
        path.spacecraft(0, v.earth, v.moon, v.tmp, scale).sub(v.earth)
        v.tmp.applyAxisAngle(EARTH_POLE, EARTH_SPIN * tS)
        rocket.current.position.copy(v.earth).add(v.tmp)
      } else if (afterEnd && path.endsOnSurface) {
        turnWithMoon(path.fromMoon(path.endS, v.tmp), endMs, sim.simTimeMs)
        rocket.current.position.copy(v.moon).add(warpFromMoon(v.tmp, scale))
      } else path.spacecraft(tS, v.earth, v.moon, rocket.current.position, scale)
      rocketTracker.active = true
      rocketTracker.position.copy(rocket.current.position)
    }
    path.site(Math.min(tS, path.endS), v.tmp)
    if (afterEnd) turnWithMoon(v.tmp, endMs, sim.simTimeMs)
    site.current?.position.copy(v.moon).add(warpFromMoon(v.tmp, scale))

    const st = path.state(Math.max(tS, 0))
    rocketTracker.phase = tS < 0 ? 'On the launch pad' : st.phase
    rocketTracker.tS = tS
    if (label.current) label.current.textContent = rocketTracker.phase

    // clock speed follows the phase while the flight plays; once the rocket has landed the clock
    // keeps running at the top bar's normal speed (1 h/s) and the speed is the user's again
    const { autoSpeed } = useMissionStore.getState()
    if (autoSpeed && sim.isPlaying && tS > -600) {
      if (tS > path.endS || st.phase.startsWith('On the surface')) {
        sim.setTimeScale(LANDED_TIME_SCALE)
        useMissionStore.getState().setAutoSpeed(false)
      } else {
        const want = tS < 0 ? 10 : phaseSpeed(st.phase, st.moonDistKm)
        if (sim.timeScale !== want) sim.setTimeScale(want)
      }
    }
  })

  return (
    <>
      <group ref={earthGroup} visible={!pathHidden}>
        <line>
          <primitive object={e.all} attach="geometry" />
          <lineBasicMaterial vertexColors transparent opacity={0.3} depthWrite={false} />
        </line>
        <line>
          <primitive object={e.flown} attach="geometry" />
          <lineBasicMaterial vertexColors />
        </line>
      </group>
      <group ref={moonGroup} visible={!pathHidden}>
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
