import { MOON_RADIUS_M, moonHeight, terrainExaggeration, terrainReady } from './EarthMoon/moonTerrain'
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Quaternion, Vector3 } from 'three'
import type { Body, EphemerisYear } from '../../api/types'
import { useSimStore, type SurfaceReadout } from '../../store/simStore'
import { bodyOrientation } from './bodyFrame'
import { surfaceBelowCamera } from './EarthMoon/surfaceStatus'
import { drawnPositionAt, parentSamplesOf } from './orbitMath'
import { KM_PER_UNIT, moonOrbitScale, radiusToUnits, spheroidRadii } from './scale'

const UPDATE_EVERY_S = 0.2 // the numbers change 5 times a second: often enough to read
const DEG = 180 / Math.PI

type Props = { bodies: Body[]; year?: EphemerisYear }

/**
 * Inside the <Canvas>: works out what the camera is above and puts it in the store.
 *  - the body whose surface is closest to the camera
 *  - the altitude above it in REAL km: the size buttons draw bodies bigger, that's taken out,
 *    so the number means "this view is what you'd see from this high above the real Moon"
 *  - the latitude/longitude right below the camera (the same ones the sites and Moon Trek use)
 *  - for Earth/Moon: the map level drawn there (the same numbers as Moon Trek's zoom levels)
 */
export function SurfaceReadoutTracker({ bodies, year }: Props) {
  const sinceUpdate = useRef(0)
  const bodyPos = useRef(new Vector3())
  const fromBody = useRef(new Vector3())
  const turn = useRef(new Quaternion())

  useFrame(({ camera }, delta) => {
    sinceUpdate.current += delta
    if (sinceUpdate.current < UPDATE_EVERY_S) return
    sinceUpdate.current = 0

    const { simTimeMs, planetSize, readout, setReadout } = useSimStore.getState()
    let best: SurfaceReadout | null = null
    let bestDrawnAltitude = Infinity
    for (const body of bodies) {
      const samples = year?.bodies[body.id]?.samples
      if (samples) {
        const parent = parentSamplesOf(year, body.id)
        drawnPositionAt(samples, parent, simTimeMs, moonOrbitScale(planetSize), bodyPos.current)
      } else if (body.id === 'sun') {
        bodyPos.current.set(0, 0, 0)
      } else {
        continue // this body's positions aren't loaded yet
      }

      // The camera as seen from the body, in the body's own turning frame (turned like CelestialBody)
      const toBody = bodyOrientation(body, simTimeMs, turn.current).invert()
      const p = fromBody.current.subVectors(camera.position, bodyPos.current)
      p.applyQuaternion(toBody)

      // How far the drawn surface is from the centre in that direction (bodies are a bit flat)
      const drawnRadius = radiusToUnits(body.radius_km, body.id, planetSize)
      const flattening = body.id === 'moon' ? 0 : body.flattening
      const { equatorial, polar } = spheroidRadii(drawnRadius, flattening)
      const latFromCentre = Math.atan2(p.y, Math.hypot(p.x, p.z))
      const baseSurface =
        (equatorial * polar) /
        Math.hypot(polar * Math.cos(latFromCentre), equatorial * Math.sin(latFromCentre))
      const latDeg = Math.atan(Math.tan(latFromCentre) / (1 - flattening) ** 2) * DEG
      const lonDeg = Math.atan2(-p.z, p.x) * DEG
      const elevationM = body.id === 'moon' && terrainReady() ? moonHeight(latDeg, lonDeg) : undefined
      // The drawn terrain is stretched by the size buttons, so measure from the stretched surface
      const surface = baseSurface + (elevationM ?? 0) * terrainExaggeration() / MOON_RADIUS_M * drawnRadius
      const drawnAltitude = p.length() - surface
      if (drawnAltitude >= bestDrawnAltitude) continue
      bestDrawnAltitude = drawnAltitude

      // Drawn units → real km: the body is drawn `scale` times its real size
      const scale = drawnRadius / (body.radius_km / KM_PER_UNIT)
      const below =
        body.id === 'earth' || body.id === 'moon' ? surfaceBelowCamera[body.id] : undefined
      best = {
        bodyName: body.name,
        altitudeKm: Math.max(0, (drawnAltitude * KM_PER_UNIT) / scale),
        // Map latitude ("geodetic"), the kind maps and the site lists use
        latDeg, lonDeg, elevationM,
        terrainAvailable: body.id === 'moon' ? terrainReady() : undefined,
        mapLevel: below?.level,
        metresPerPixel: below?.metresPerPixel,
      }
    }
    // Only tell React when something changed, so the panel doesn't redraw for nothing
    if (JSON.stringify(best) !== JSON.stringify(readout)) setReadout(best)
  })

  return null
}

/** Outside the <Canvas>: the box in the bottom-right corner that shows the numbers */
export function SurfaceReadoutPanel() {
  const readout = useSimStore((s) => s.readout)
  if (!readout) return null
  const { bodyName, altitudeKm, latDeg, lonDeg, mapLevel, metresPerPixel } = readout
  const lat = `${Math.abs(latDeg).toFixed(2)}°${latDeg >= 0 ? 'N' : 'S'}`
  const lon = `${Math.abs(lonDeg).toFixed(2)}°${lonDeg >= 0 ? 'E' : 'W'}`
  return (
    <div style={panelStyle}>
      <div style={titleStyle}>{bodyName}</div>
      <div>
        Altitude <strong>{formatKm(altitudeKm)}</strong>
      </div>
      <div>Below {lat} {lon}</div>
      {readout.elevationM !== undefined && <div>Ground: {readout.elevationM.toFixed(1)} m · LOLA ~1.9 km grid</div>}
      {readout.terrainAvailable === false && <div>Terrain loading…</div>}
      {/* The landing point is set and shown in the mission panel at the bottom */}
      {mapLevel !== undefined && metresPerPixel !== undefined && (
        <div>
          Map level {mapLevel} · {formatMetres(metresPerPixel)} per pixel
        </div>
      )}
    </div>
  )
}

function formatKm(km: number) {
  if (km < 10) return `${km.toFixed(2)} km`
  if (km < 1000) return `${km.toFixed(1)} km`
  return `${Math.round(km).toLocaleString('en-US')} km`
}

function formatMetres(m: number) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`
}

const panelStyle = {
  position: 'absolute',
  right: 16,
  bottom: 16,
  zIndex: 1,
  minWidth: 220,
  padding: '8px 12px',
  border: '1px solid var(--line)',
  borderRadius: 4,
  background: 'var(--bar-bottom)',
  color: 'var(--text)',
  fontSize: 12,
  lineHeight: 1.6,
  pointerEvents: 'none',
} as const

const titleStyle = {
  fontFamily: 'var(--font-display)',
  fontSize: 11,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: 'var(--accent)',
} as const
