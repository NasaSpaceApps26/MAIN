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

const RED = '#ff2020' // not in the mission
const ORANGE = '#ff9f1c' // in the mission, to compare
const YELLOW = '#ffd23f' // the launch site being edited (its slot is active in the mission panel)

type Props = { radius: number } // planet radius in scene units

/**
 * Red dots on the surface. Render as a child of the rotating planet mesh so they turn with it.
 * Clicking a dot puts that site into the mission panel (the active slot). Sites in the mission turn
 * orange, the active one yellow. The 3D model window opens from the mission panel, not from the dot.
 */
export function LaunchSites({ radius }: Props) {
  const missionSites = useSimStore((s) => s.missionSites)
  const activeId = useSimStore((s) => s.missionSites[s.activeSiteSlot] ?? null)
  const chooseLaunchSite = useSimStore((s) => s.chooseLaunchSite)
  const dotRadius = radius * 0.01 // ~64 km on Earth
  const surface = radius * 1.001

  return (
    <>
      {LAUNCH_SITES.map((s) => {
        const active = s.id === activeId
        const inMission = missionSites.includes(s.id)
        return (
          <mesh
            key={s.id}
            position={latLonToLocal(s.lat, s.lon, surface)}
            // chosen dots are a bit bigger, so they show over a neighbour (KSC and the Cape overlap)
            scale={active ? 1.35 : inMission ? 1.15 : 1}
            onClick={(e) => {
              e.stopPropagation() // don't also select Earth
              chooseLaunchSite(s.id)
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
            {/* Unlit, so the dots keep their colour on the night side too */}
            <meshBasicMaterial color={active ? YELLOW : inMission ? ORANGE : RED} />
          </mesh>
        )
      })}
    </>
  )
}
