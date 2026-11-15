import { useRef } from 'react'
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Vector3, type Group, type Mesh } from 'three'
import { useDepartureSites, useLunarSites } from '../../api/hooks'
import type { Site } from '../../api/types'
import { useSimStore } from '../../store/simStore'
import { latLonToLocal } from './sitePosition'
import { moonPosition, useMoonTerrain } from './EarthMoon/moonTerrain'

type Props = { bodyId: 'earth' | 'moon'; equatorialRadius: number; flattening: number }
const cameraLocal = new Vector3()
export function SiteMarkers({ bodyId, equatorialRadius, flattening }: Props) {
  const { data: departure } = useDepartureSites()
  const { data: lunar } = useLunarSites()
  const departureId = useSimStore((s) => s.departureSiteId)
  const landingId = useSimStore((s) => s.landingSiteId)
  const point = useSimStore((s) => s.pickedMoonPoint)
  const terrain = useMoonTerrain(bodyId === 'moon')
  const onMoon = bodyId === 'moon'
  const selected = onMoon ? landingId : departureId
  const sites = (onMoon ? lunar : departure) ?? []
  const choose = (id: string) => onMoon
    ? useSimStore.getState().setLandingSite(id)
    : useSimStore.getState().setDepartureSite(id)
  // The snapshot re-renders markers once elevation becomes available.
  const terrainLoaded = terrain.phase === 'ready'
  return <>
    {sites.map((site) => <Dot key={site.id} site={site} radius={equatorialRadius}
      flattening={flattening} lunar={onMoon} selected={site.id === selected}
      terrainLoaded={terrainLoaded} onSelect={() => choose(site.id)} />)}
    {onMoon && point && <Dot site={{
      id: 'picked-point', name: 'Picked terrain point', lat_deg: point.latDeg,
      lon_deg: point.lonDeg, elevation_m: point.elevationM, notes: point.datasetId,
    }} radius={equatorialRadius} flattening={0} lunar selected
      terrainLoaded={terrainLoaded} onSelect={() => {}} />}
  </>
}
function Dot({ site, radius, flattening, lunar, selected, onSelect, terrainLoaded }: {
  site: Site; radius: number; flattening: number; lunar: boolean
  selected: boolean; terrainLoaded: boolean; onSelect: () => void
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
      <meshBasicMaterial color={selected ? '#ffd23f' : '#ff5a4f'} depthTest={lunar} depthWrite={false} />
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
