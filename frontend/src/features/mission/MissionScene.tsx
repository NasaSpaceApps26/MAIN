import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { BufferAttribute, BufferGeometry, Group, Quaternion, Vector3 } from 'three'
import { useBodies } from '../../api/hooks'
import type { Body, StateSample } from '../../api/types'
import { bodyOrientation, bodyPole } from '../../components/SolarSystem/bodyFrame'
import { moonPosition, useMoonTerrain } from '../../components/SolarSystem/EarthMoon/moonTerrain'
import { drawnPositionAt, positionAt } from '../../components/SolarSystem/orbitMath'
import { moonOrbitScale, radiusToUnits, spheroidRadii } from '../../components/SolarSystem/scale'
import { latLonToLocal } from '../../components/SolarSystem/sitePosition'
import { useSimStore } from '../../store/simStore'
import { type DrawnEarth, type DrawnLine, type DrawnMoon, drawScale, drawnLines, drawnSpacecraft, moonWeight } from './drawnFlight'
import { type FlightPath, countUpTo, flightPathOf, phaseSpeed } from './flightPath'
import { SPEED_AFTER_FLIGHT, rocketTracker, useFlight, useMissionStore } from './missionStore'
import type { MissionResult } from './types'

const labelStyle = {
  transform: 'translate(10px, -50%)',
  padding: '1px 6px',
  border: '1px solid #ffffff88',
  borderRadius: 4,
  background: 'var(--panel)',
  color: '#ffffff',
  fontSize: 11,
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
} as const

type Props = {
  earth?: StateSample[]
  moon?: StateSample[]
}

/** Two copies of one line sharing the same points: the whole path dim, the flown part bright. */
function useLine(line: DrawnLine) {
  const geometries = useMemo(() => {
    const pos = new BufferAttribute(line.positions, 3)
    const col = new BufferAttribute(line.colors, 3)
    const all = new BufferGeometry()
    all.setAttribute('position', pos)
    all.setAttribute('color', col)
    const flown = new BufferGeometry()
    flown.setAttribute('position', pos)
    flown.setAttribute('color', col)
    flown.setDrawRange(0, 0)
    return { all, flown }
  }, [line])
  useEffect(
    () => () => {
      geometries.all.dispose()
      geometries.flown.dispose()
    },
    [geometries],
  )
  return geometries
}

function PathLine({ line, flownTo }: { line: DrawnLine; flownTo: { current: number } }) {
  const g = useLine(line)
  useFrame(() => g.flown.setDrawRange(0, countUpTo(line.times, flownTo.current)))
  return (
    <>
      <line>
        <primitive object={g.all} attach="geometry" />
        <lineBasicMaterial vertexColors transparent opacity={0.3} depthWrite={false} />
      </line>
      <line>
        <primitive object={g.flown} attach="geometry" />
        <lineBasicMaterial vertexColors />
      </line>
    </>
  )
}

type DrawingProps = {
  path: FlightPath
  flight: MissionResult
  earth: StateSample[]
  moon: StateSample[]
  earthBody: Body
  moonBody: Body
}

const rocketPos = new Vector3()
const ahead = new Vector3()
const up = new Vector3()
const padLocal = new Vector3()
const earthQ = new Quaternion()
const moonQ = new Quaternion()

function FlightDrawing({ path, flight, earth, moon, earthBody, moonBody }: DrawingProps) {
  const planetSize = useSimStore((s) => s.planetSize)
  const terrain = useMoonTerrain(true) // the touchdown sits on the drawn mountains and craters
  const terrainReady = terrain.phase === 'ready'
  const earthGroup = useRef<Group>(null)
  const moonGroup = useRef<Group>(null)
  const rocket = useRef<Group>(null)
  const label = useRef<HTMLSpanElement>(null)
  const flownTo = useRef(0)
  const lastTS = useRef(-Infinity) // mission time of the previous frame

  // How Earth and the Moon are drawn at this planet size
  const scale = useMemo(() => drawScale(planetSize), [planetSize])
  const radii = useMemo(() => {
    const e = spheroidRadii(radiusToUnits(earthBody.radius_km, 'earth', planetSize), earthBody.flattening)
    return { earth: e, moon: radiusToUnits(moonBody.radius_km, 'moon', planetSize) }
  }, [earthBody, moonBody, planetSize])

  // The path, redrawn when the size changes (and once the Moon's heights are in)
  const lines = useMemo(() => {
    const pole = bodyPole(earthBody, path.launchMs, new Vector3()) // Earth's pole hardly moves in a few days
    const q = new Quaternion()
    return drawnLines(
      path,
      { pole, equatorial: radii.earth.equatorial, polar: radii.earth.polar },
      radii.moon,
      (tMs) => bodyOrientation(moonBody, tMs, q),
      scale,
    )
    // terrainReady: the heights are read inside drawnLines
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, earthBody, moonBody, radii, scale, terrainReady])

  // where Earth and the Moon are drawn this frame (filled in every frame)
  const drawn = useRef<{ earth: DrawnEarth; moon: DrawnMoon }>({
    earth: { center: new Vector3(), pole: new Vector3(), equatorial: 0, polar: 0 },
    moon: { center: new Vector3(), radius: 0, toBody: new Quaternion() },
  })

  useEffect(() => () => void (rocketTracker.active = false), [])

  useFrame(() => {
    const sim = useSimStore.getState()
    const t = sim.simTimeMs
    const tS = (t - path.launchMs) / 1000
    flownTo.current = tS

    // Earth and the Moon exactly where CelestialBody draws them
    const e = drawn.current.earth
    const m = drawn.current.moon
    positionAt(earth, t, e.center)
    bodyOrientation(earthBody, t, earthQ)
    e.pole.set(0, 1, 0).applyQuaternion(earthQ)
    e.equatorial = radii.earth.equatorial
    e.polar = radii.earth.polar
    drawnPositionAt(moon, earth, t, moonOrbitScale(planetSize), m.center)
    bodyOrientation(moonBody, t, moonQ)
    m.toBody.copy(moonQ).invert()
    m.radius = radii.moon

    // the flight up to the Moon rides with Earth; the lunar part waits where the Moon will be
    earthGroup.current?.position.copy(e.center)
    if (moonGroup.current) {
      if (tS < lines.arrivalS) {
        path.moonGeo(lines.arrivalS, moonGroup.current.position)
        moonGroup.current.position.multiplyScalar(scale.orbit / 1_000_000).add(e.center)
      } else moonGroup.current.position.copy(m.center)
    }

    // the spacecraft: on the pad before liftoff, on the landing point after touchdown
    const touchdownS = flight.landed ? path.touchdownS : null
    if (tS < 0) {
      padLocal.set(...latLonToLocal(flight.launch.lat, flight.launch.lon, e.equatorial * 1.001))
      rocketPos.copy(padLocal).applyQuaternion(earthQ).add(e.center)
    } else if (touchdownS !== null && tS >= touchdownS) {
      padLocal.set(...moonPosition(flight.landing.lat, flight.landing.lon, m.radius, 1))
      rocketPos.copy(padLocal).applyQuaternion(moonQ).add(m.center)
    } else {
      drawnSpacecraft(path, tS, e, m, scale, rocketPos)
    }
    rocket.current?.position.copy(rocketPos)

    // For the camera: a spot above the spacecraft and a little behind it
    const st = path.state(Math.max(tS, 0))
    const nearMoon = moonWeight(st.moonDistKm) > 0.5
    up.subVectors(rocketPos, nearMoon ? m.center : e.center).normalize()
    drawnSpacecraft(path, Math.max(tS, 0) + 60, e, m, scale, ahead).sub(rocketPos)
    if (ahead.lengthSq() > 0) ahead.normalize()
    rocketTracker.viewDir.copy(up).multiplyScalar(0.6).addScaledVector(ahead, -1).normalize()
    if (rocketTracker.viewDir.lengthSq() === 0) rocketTracker.viewDir.copy(up)
    rocketTracker.viewDistance = nearMoon
      ? m.radius * 0.35
      : st.altEarthKm < 20_000
        ? e.equatorial * 0.07
        : rocketPos.distanceTo(e.center) * 0.15
    rocketTracker.position.copy(rocketPos)
    rocketTracker.active = true
    rocketTracker.phase = tS < 0 ? 'On the launch pad' : st.phase
    rocketTracker.tS = tS
    if (label.current && label.current.textContent !== rocketTracker.phase) label.current.textContent = rocketTracker.phase

    // clock speed follows the phase while the flight plays; it pauses once, as the flight ends
    const { autoSpeed } = useMissionStore.getState()
    const before = lastTS.current
    lastTS.current = tS
    if (autoSpeed && sim.isPlaying) {
      if (before <= path.endS && tS > path.endS) {
        sim.togglePlay()
        sim.setTimeScale(SPEED_AFTER_FLIGHT)
      } else if (tS > -600 && tS <= path.endS) {
        const want = tS < 0 ? 10 : phaseSpeed(st.phase, st.moonDistKm)
        if (sim.timeScale !== want) sim.setTimeScale(want)
      }
    }
  })

  return (
    <>
      <group ref={earthGroup}>
        <PathLine line={lines.earth} flownTo={flownTo} />
      </group>
      <group ref={moonGroup}>
        <PathLine line={lines.moon} flownTo={flownTo} />
      </group>

      <group ref={rocket}>
        <points>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[new Float32Array(3), 3]} />
          </bufferGeometry>
          <pointsMaterial color="#ffffff" size={7} sizeAttenuation={false} depthTest={false} />
        </points>
        <Html zIndexRange={[1, 1]}>
          <div style={labelStyle}>
            <span ref={label} />
          </div>
        </Html>
      </group>
    </>
  )
}

/**
 * The computed flight in the space view: its path (bright up to now, dim ahead) and the spacecraft,
 * from the launch-site dot on Earth to the landing point on the Moon. Drawn only while the mission
 * panel still describes the flight that was computed (see useFlight).
 */
export function MissionScene({ earth, moon }: Props) {
  const flight = useFlight()
  const { data: bodies } = useBodies()
  const path = useMemo(() => (flight?.trajectory ? flightPathOf(flight.trajectory) : null), [flight])
  const earthBody = bodies?.find((b) => b.id === 'earth')
  const moonBody = bodies?.find((b) => b.id === 'moon')
  if (!flight || !path || !earth || !moon || !earthBody || !moonBody) return null
  return (
    <FlightDrawing
      key={flight.trajectory?.launch_ms}
      path={path}
      flight={flight}
      earth={earth}
      moon={moon}
      earthBody={earthBody}
      moonBody={moonBody}
    />
  )
}
