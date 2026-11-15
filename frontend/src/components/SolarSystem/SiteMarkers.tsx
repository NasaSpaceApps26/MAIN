import { useRef } from 'react'
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Vector3, type Group, type Mesh } from 'three'
import { useDepartureSites, useLunarSites } from '../../api/hooks'
import type { Site } from '../../api/types'
import { ACTIVE_COLOUR, OTHER_COLOUR, landingLabel } from '../../features/mission/landing'
import { useSimStore } from '../../store/simStore'
import { latLonToLocal } from './sitePosition'
import { moonHeight, moonPosition, terrainDataset, useMoonTerrain } from './EarthMoon/moonTerrain'

type Props = { bodyId: 'earth' | 'moon'; equatorialRadius: number; flattening: number }
const cameraLocal = new Vector3()

/**
 * Site markers on Earth (departure sites) or the Moon (named landing sites, plus the mission's own
 * landing points). On the Moon, a named site that is a mission landing point is highlighted:
 * yellow for the active one, orange for the others.
 */
export function SiteMarkers({ bodyId, equatorialRadius, flattening }: Props) {
  const { data: departure } = useDepartureSites()
  const { data: lunar } = useLunarSites()
  const departureId = useSimStore((s) => s.departureSiteId)
  const landingPoints = useSimStore((s) => s.landingPoints)
  const activeSlot = useSimStore((s) => s.activeLandingSlot)
  const terrain = useMoonTerrain(bodyId === 'moon')
  const onMoon = bodyId === 'moon'
  const sites = (onMoon ? lunar : departure) ?? []

  /** Colour of a named site's marker: null = not in the mission. */
  const siteColour = (site: Site) => {
    if (!onMoon) return site.id === departureId ? ACTIVE_COLOUR : null
    const slot = landingPoints.findIndex((p) => p?.siteId === site.id)
    if (slot === -1) return null
    return slot === activeSlot ? ACTIVE_COLOUR : OTHER_COLOUR
  }

  const choose = (site: Site) => {
    const s = useSimStore.getState()
    if (!onMoon) return s.setDepartureSite(site.id)
    // A named lunar site becomes the active landing point (see MissionPanel)
    s.setLandingPoint({
      latDeg: site.lat_deg,
      lonDeg: site.lon_deg,
      elevationM: site.elevation_m ?? moonHeight(site.lat_deg, site.lon_deg),
      datasetId: terrainDataset(),
      siteId: site.id,
    })
    s.setPickingLanding(false)
  }
  // The snapshot re-renders markers once elevation becomes available.
  const terrainLoaded = terrain.phase === 'ready'
  return <>
    {sites.map((site) => {
      const colour = siteColour(site)
      return <Dot key={site.id} site={site} radius={equatorialRadius}
        flattening={flattening} lunar={onMoon} selected={colour !== null} colour={colour ?? undefined}
        terrainLoaded={terrainLoaded} onSelect={() => choose(site)} />
    })}
    {/* the mission's own landing points (named sites are already drawn above) */}
    {onMoon && landingPoints.map((p, slot) => p && p.siteId === null && <Dot key={`landing-${slot}`} site={{
      id: `landing-${slot}`, name: landingLabel(p, slot, lunar), lat_deg: p.latDeg,
      lon_deg: p.lonDeg, elevation_m: p.elevationM, notes: p.datasetId,
    }} radius={equatorialRadius} flattening={0} lunar selected
      colour={slot === activeSlot ? ACTIVE_COLOUR : OTHER_COLOUR}
      terrainLoaded={terrainLoaded} onSelect={() => useSimStore.getState().setActiveLandingSlot(slot)} />)}
  </>
}

function Dot({ site, radius, flattening, lunar, selected, colour, onSelect, terrainLoaded }: {
  site: Site; radius: number; flattening: number; lunar: boolean
  selected: boolean; colour?: string; terrainLoaded: boolean; onSelect: () => void
}) {
  const group = useRef<Group>(null)
  const dot = useRef<Mesh>(null)
  const label = useRef<HTMLDivElement>(null)
  const position = lunar && terrainLoaded
    ? moonPosition(site.lat_deg, site.lon_deg, radius, 1)
    : latLonToLocal(site.lat_deg, site.lon_deg, radius, flattening)
  useFrame(({ camera }) => {
    const g = group.current
    if (!g?.parent || !dot.current) return
    g.parent.updateWorldMatrix(true, false)
    g.parent.worldToLocal(cameraLocal.copy(camera.position))
    const toCamera = cameraLocal.sub(g.position)
    const visible = toCamera.dot(g.position) > 0
    dot.current.visible = visible
    dot.current.scale.setScalar(Math.min(
      radius * (selected ? 0.03 : 0.02),
      toCamera.length() * 0.005 * (selected ? 1.5 : 1),
    ))
    if (label.current) label.current.style.visibility = visible ? 'visible' : 'hidden'
  })
  return <group ref={group} position={position}>
    <mesh ref={dot} renderOrder={10} onClick={(e) => { e.stopPropagation(); onSelect() }}>
      <sphereGeometry args={[1, 12, 12]} />
      <meshBasicMaterial color={colour ?? (selected ? ACTIVE_COLOUR : '#ff5a4f')} depthTest={lunar} depthWrite={false} />
    </mesh>
    {selected && <Html zIndexRange={[0, 0]}>
      <div ref={label} style={{
        transform: 'translate(10px, -50%)', padding: '1px 6px', border: '1px solid var(--line)',
        borderRadius: 4, background: 'var(--panel)', color: 'var(--text)',
        fontSize: 11, whiteSpace: 'nowrap', pointerEvents: 'none',
      }}>{site.name}</div>
    </Html>}
  </group>
}
