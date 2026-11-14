import { Html } from '@react-three/drei'
import { useDepartureSites, useLunarSites } from '../../api/hooks'
import type { Site } from '../../api/types'
import { useSimStore } from '../../store/simStore'
import { latLonToLocal } from './sitePosition'

const labelStyle = {
  transform: 'translate(10px, -50%)',
  padding: '1px 6px',
  border: '1px solid var(--line)',
  borderRadius: 4,
  background: 'var(--panel)',
  color: 'var(--text)',
  fontSize: 11,
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
} as const

const DOT_COLOR = '#ff5a4f'
const SELECTED_COLOR = '#ffd23f'

type Props = {
  bodyId: 'earth' | 'moon'
  equatorialRadius: number // the body's drawn size, so dots sit on its surface
  flattening: number // how squashed the body is at the poles
}

/**
 * Dots for the sites the backend serves: launch sites on Earth, landing sites on the Moon.
 * Must be placed inside the body's spinning group, so the dots turn with the surface.
 */
export function SiteMarkers({ bodyId, equatorialRadius, flattening }: Props) {
  const { data: departureSites } = useDepartureSites()
  const { data: lunarSites } = useLunarSites()
  const departureSiteId = useSimStore((s) => s.departureSiteId)
  const landingSiteId = useSimStore((s) => s.landingSiteId)
  const setDepartureSite = useSimStore((s) => s.setDepartureSite)
  const setLandingSite = useSimStore((s) => s.setLandingSite)

  const onEarth = bodyId === 'earth'
  const sites = (onEarth ? departureSites : lunarSites) ?? []
  const selectedId = onEarth ? departureSiteId : landingSiteId
  const select = onEarth ? setDepartureSite : setLandingSite

  return (
    <>
      {sites.map((site) => (
        <SiteDot
          key={site.id}
          site={site}
          equatorialRadius={equatorialRadius}
          flattening={flattening}
          selected={site.id === selectedId}
          onSelect={() => select(site.id)}
        />
      ))}
    </>
  )
}

type DotProps = {
  site: Site
  equatorialRadius: number
  flattening: number
  selected: boolean
  onSelect: () => void
}

function SiteDot({ site, equatorialRadius, flattening, selected, onSelect }: DotProps) {
  const position = latLonToLocal(site.lat_deg, site.lon_deg, equatorialRadius, flattening)
  const dotRadius = equatorialRadius * (selected ? 0.03 : 0.02) // grows with the body, so it's visible at every size

  return (
    <group position={position}>
      <mesh
        onClick={(e) => {
          e.stopPropagation() // don't also count as a click on the planet
          onSelect()
        }}
      >
        <sphereGeometry args={[dotRadius, 12, 12]} />
        {/* Basic material: the dot stays bright even on the night side */}
        <meshBasicMaterial color={selected ? SELECTED_COLOR : DOT_COLOR} />
      </mesh>
      {selected && (
        <Html zIndexRange={[0, 0]}>
          <div style={labelStyle}>{site.name}</div>
        </Html>
      )}
    </group>
  )
}
