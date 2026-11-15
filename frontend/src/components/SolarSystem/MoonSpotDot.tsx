import { useRef, useState } from 'react'
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Vector3, type Group, type Mesh } from 'three'
import { ACTIVE_COLOUR, OTHER_COLOUR } from '../../features/mission/landing'
import { useSimStore } from '../../store/simStore'
import { latLonToLocal } from './sitePosition'
import { moonHeight, moonPosition, terrainDataset, useMoonTerrain } from './EarthMoon/moonTerrain'

const cameraLocal = new Vector3()

/** A labelled point on the Moon: a historic landing, a crater, a mountain... */
export type MoonSpot = {
  /** siteId it gets as a mission landing point, e.g. "historic:apollo-11" */
  siteId: string
  name: string
  latDeg: number
  lonDeg: number
  /** short text after the name, e.g. the year or "crater" */
  tag: string
  /** small grey line under the name */
  subtitle: string
  /** why it matters */
  note: string
}

type Props = { spots: MoonSpot[]; colour: string; equatorialRadius: number; flattening: number }

/**
 * Dots for a list of spots on the Moon. Rendered inside the Moon's `spin` group, so they turn
 * with the surface. Hover shows the name and why it matters; click pins the label.
 * In "Pick" mode (mission step 3), a click makes the spot the active landing point;
 * a spot in the mission turns yellow (active) or orange (other slots), like the named sites.
 */
export function MoonSpots({ spots, colour, equatorialRadius, flattening }: Props) {
  const terrain = useMoonTerrain(true)
  const terrainLoaded = terrain.phase === 'ready'
  const landingPoints = useSimStore((s) => s.landingPoints)
  const activeSlot = useSimStore((s) => s.activeLandingSlot)
  const picking = useSimStore((s) => s.pickingLanding)

  /** Colour of a spot in the mission, null = not in it. */
  const missionColour = (spot: MoonSpot) => {
    const slot = landingPoints.findIndex((p) => p?.siteId === spot.siteId)
    if (slot === -1) return null
    return slot === activeSlot ? ACTIVE_COLOUR : OTHER_COLOUR
  }

  return <>
    {spots.map((spot) => (
      <SpotDot key={spot.siteId} spot={spot} radius={equatorialRadius} flattening={flattening}
        terrainLoaded={terrainLoaded} picking={picking} colour={colour}
        missionColour={missionColour(spot)} />
    ))}
  </>
}

/** Puts a spot into the active landing slot (or jumps to its slot if it is already there). */
function chooseAsLandingPoint(spot: MoonSpot) {
  const s = useSimStore.getState()
  s.setLandingPoint({
    latDeg: spot.latDeg,
    lonDeg: spot.lonDeg,
    elevationM: moonHeight(spot.latDeg, spot.lonDeg),
    datasetId: terrainDataset(),
    siteId: spot.siteId,
  })
  s.setPickingLanding(false) // one click, one point
}

function SpotDot({ spot, radius, flattening, terrainLoaded, picking, colour, missionColour }: {
  spot: MoonSpot; radius: number; flattening: number; terrainLoaded: boolean
  picking: boolean; colour: string; missionColour: string | null
}) {
  const group = useRef<Group>(null)
  const dot = useRef<Mesh>(null)
  const label = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState(false)
  const [pinned, setPinned] = useState(false)
  const inMission = missionColour !== null
  const shown = missionColour ?? colour
  const position = terrainLoaded
    ? moonPosition(spot.latDeg, spot.lonDeg, radius, 1)
    : latLonToLocal(spot.latDeg, spot.lonDeg, radius, flattening)

  useFrame(({ camera }) => {
    const g = group.current
    if (!g?.parent || !dot.current) return
    g.parent.updateWorldMatrix(true, false)
    g.parent.worldToLocal(cameraLocal.copy(camera.position))
    const toCamera = cameraLocal.sub(g.position)
    // only on the side of the Moon facing the camera
    const visible = toCamera.dot(g.position) > 0
    dot.current.visible = visible
    // bigger while it can be picked or is part of the mission
    const grow = inMission ? 1.6 : picking ? 1.3 : 1
    dot.current.scale.setScalar(Math.min(radius * 0.015 * grow, toCamera.length() * 0.004 * grow))
    if (label.current) label.current.style.visibility = visible ? 'visible' : 'hidden'
  })

  const details = hovered || pinned
  return <group ref={group} position={position}>
    <mesh ref={dot} renderOrder={11}
      onClick={(e) => {
        e.stopPropagation()
        if (e.delta >= 5) return // a drag is a camera move, not a click
        if (picking) chooseAsLandingPoint(spot)
        else setPinned((p) => !p)
      }}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer' }}
      onPointerOut={() => {
        setHovered(false)
        // while picking, MissionPanel shows a crosshair: give it back
        document.body.style.cursor = useSimStore.getState().pickingLanding ? 'crosshair' : ''
      }}>
      <sphereGeometry args={[1, 12, 12]} />
      <meshBasicMaterial color={shown} depthWrite={false} />
    </mesh>
    {(details || inMission) && <Html zIndexRange={[0, 0]}>
      <div ref={label} style={{
        transform: 'translate(10px, -50%)', padding: details ? '4px 8px' : '1px 6px',
        border: `1px solid ${shown}`, borderRadius: 4, background: 'var(--panel)', color: 'var(--text)',
        fontSize: 11, pointerEvents: 'none',
        whiteSpace: details ? 'normal' : 'nowrap', width: details ? 240 : undefined,
      }}>
        <strong>{spot.name}</strong> · {spot.tag}
        {details && <>
          <div style={{ opacity: 0.75 }}>
            {spot.subtitle} · {spot.latDeg.toFixed(2)}°, {spot.lonDeg.toFixed(2)}°
          </div>
          <div style={{ marginTop: 3 }}>{spot.note}</div>
          {picking && <div style={{ marginTop: 3, color: ACTIVE_COLOUR }}>Click to land here</div>}
        </>}
      </div>
    </Html>}
  </group>
}
