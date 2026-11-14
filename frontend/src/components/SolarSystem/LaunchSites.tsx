import { Vector3 } from 'three'
import { LAUNCH_SITES } from '../../features/launchSites/sites'
import { useSimStore } from '../../store/simStore'

const DEG = Math.PI / 180

/**
 * Point on a sphere in the body's local frame: +Y = north pole, longitude 0 on +X,
 * east longitude counter-clockwise seen from the north (same direction as rotation.y).
 */
function latLonToLocal(lat: number, lon: number, r: number) {
  const la = lat * DEG
  const lo = lon * DEG
  return new Vector3(r * Math.cos(la) * Math.cos(lo), r * Math.sin(la), -r * Math.cos(la) * Math.sin(lo))
}

type Props = { radius: number } // planet radius in scene units

/**
 * Red dots on the surface. Render as a child of the rotating planet mesh so they turn with it.
 * Clicking a dot opens the 3D model window (LaunchSiteViewer) for that site and any site next to it.
 */
export function LaunchSites({ radius }: Props) {
  const openLaunchSite = useSimStore((s) => s.openLaunchSite)
  const dotRadius = radius * 0.01 // ~64 km on Earth
  const surface = radius * 1.001

  return (
    <>
      {LAUNCH_SITES.map((s) => (
        <mesh
          key={s.id}
          position={latLonToLocal(s.lat, s.lon, surface)}
          onClick={(e) => {
            e.stopPropagation() // don't also select Earth
            openLaunchSite(s.id)
          }}
          onPointerOver={(e) => {
            e.stopPropagation()
            document.body.style.cursor = 'pointer'
          }}
          onPointerOut={() => {
            document.body.style.cursor = ''
          }}
        >
          <sphereGeometry args={[dotRadius, 12, 12]} />
          {/* Unlit, so the dots stay red on the night side too */}
          <meshBasicMaterial color="#ff2020" />
        </mesh>
      ))}
    </>
  )
}
