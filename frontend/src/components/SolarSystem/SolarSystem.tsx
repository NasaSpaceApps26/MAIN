import { useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Stars } from '@react-three/drei'
import { useBodies, useEphemerisYear, useOrbits } from '../../api/hooks'
import { useSimStore } from '../../store/simStore'
import { CameraFollow } from './CameraFollow'
import { CameraViewButtons, CameraViewDriver } from './CameraViews'
import { CelestialBody } from './CelestialBody'
import { ClockDriver } from './ClockDriver'
import { FlyCamera } from './FlyCamera'
import { Lights } from './Lights'
import { OrbitLine } from './OrbitLine'
import { parentSamplesOf } from './orbitMath'
import { moonOrbitScale } from './scale'
import { SurfaceReadoutPanel, SurfaceReadoutTracker } from './SurfaceReadout'

const DAY_MS = 86_400_000
const WINDOW_DAYS = 366 // must match WINDOW_DAYS in backend/app/services/horizons_year.py

const toDay = (ms: number) => new Date(ms).toISOString().slice(0, 10) // "YYYY-MM-DD"

export function SolarSystem() {
  const { data: bodies } = useBodies()
  const { data: orbits } = useOrbits() // planet orbits in 2000: only shown while a year loads
  const selectBody = useSimStore((s) => s.selectBody)
  const moonOrbit = useSimStore((s) => moonOrbitScale(s.planetSize))

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
          const parent = parentSamplesOf(year, b.id) // Earth's positions for the Moon, else nothing
          // The orbit of every day of this period, so the line matches the position.
          // While the period is still downloading, planets show their orbit from 2000 instead.
          const fixedOrbit = orbits?.[b.id]
          const orbitList = eph?.daily_orbits ?? (fixedOrbit ? [fixedOrbit] : undefined)
          return (
            <group key={b.id}>
              {(eph || b.id === 'sun') && (
                <CelestialBody body={b} samples={eph?.samples} parentSamples={parent} />
              )}
              {orbitList && orbitList.length > 0 && (
                <OrbitLine
                  orbits={orbitList}
                  samples={eph?.samples}
                  parentSamples={parent}
                  scale={parent ? moonOrbit : 1}
                />
              )}
            </group>
          )
        })}
        <FlyCamera bodies={bodies} year={year} />
        {bodies && year && <CameraFollow bodies={bodies} year={year} />}
        {bodies && year && <CameraViewDriver bodies={bodies} year={year} />}
        {bodies && <SurfaceReadoutTracker bodies={bodies} year={year} />}
      </Canvas>

      <SurfaceReadoutPanel />
      <CameraViewButtons />

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
