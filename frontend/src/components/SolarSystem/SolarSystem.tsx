import { useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Stars } from '@react-three/drei'
import { useBodies, useEphemerisYear, useOrbits } from '../../api/hooks'
import { useSimStore } from '../../store/simStore'
import { CameraFollow } from './CameraFollow'
import { CelestialBody } from './CelestialBody'
import { ClockDriver } from './ClockDriver'
import { Lights } from './Lights'
import { OrbitLine } from './OrbitLine'

const DAY_MS = 86_400_000
const WINDOW_DAYS = 366 // must match WINDOW_DAYS in backend/app/services/horizons_year.py
const EARTH_CENTER = '500@399'

const toDay = (ms: number) => new Date(ms).toISOString().slice(0, 10) // "YYYY-MM-DD"

export function SolarSystem() {
  const { data: bodies } = useBodies()
  const { data: orbits } = useOrbits() // planet orbits, the same for every period
  const selectBody = useSimStore((s) => s.selectBody)

  // First day of the downloaded year. Starts at the clock's date.
  const [windowStart, setWindowStart] = useState(() => toDay(useSimStore.getState().simTimeMs))
  const { data: year, isFetching, isError } = useEphemerisYear(windowStart)

  // When the clock leaves the downloaded year, download the year starting at the clock's day
  useEffect(() => {
    const startMs = Date.parse(windowStart)
    const stopMs = startMs + WINDOW_DAYS * DAY_MS
    return useSimStore.subscribe(({ simTimeMs }) => {
      if (simTimeMs < startMs || simTimeMs >= stopMs) setWindowStart(toDay(simTimeMs))
    })
  }, [windowStart])

  return (
    <>
      <Canvas
        camera={{ position: [0, 250, 350], fov: 50, near: 1e-5, far: 1e7 }}
        gl={{ logarithmicDepthBuffer: true }} // needed for sizes from 0.001 to 5000 units
        onPointerMissed={() => selectBody(null)}
      >
        <ClockDriver />
        <Lights />
        <Stars radius={200_000} depth={10_000} count={5000} factor={4} fade />
        {bodies?.map((b) => {
          const eph = year?.bodies[b.id] // this period's positions (none for the Sun)
          // Planets: one fixed orbit, loaded once. Moon: one orbit per day of this period.
          const fixedOrbit = orbits?.[b.id]
          const orbitList = fixedOrbit ? [fixedOrbit] : eph?.daily_orbits
          return (
            <group key={b.id}>
              {(eph || b.id === 'sun') && <CelestialBody body={b} samples={eph?.samples} />}
              {orbitList && orbitList.length > 0 && (
                <OrbitLine
                  orbits={orbitList}
                  samples={eph?.samples}
                  parentSamples={
                    orbitList[0].center === EARTH_CENTER ? year?.bodies.earth?.samples : undefined
                  }
                />
              )}
            </group>
          )
        })}
        {bodies && year && <CameraFollow bodies={bodies} year={year} />}
        <OrbitControls makeDefault />
      </Canvas>

      {(isFetching || isError) && (
        <div style={statusStyle}>
          {isError
            ? 'Could not download JPL Horizons data – is the backend running?'
            : `Downloading one year of JPL Horizons data from ${windowStart}…`}
        </div>
      )}
    </>
  )
}

const statusStyle = {
  position: 'absolute',
  left: 16,
  bottom: 16,
  padding: '6px 10px',
  border: '1px solid var(--line)',
  borderRadius: 4,
  background: 'var(--panel)',
  color: 'var(--text-dim)',
  fontSize: 12,
} as const
