import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { AmbientLight, DirectionalLight, HemisphereLight } from 'three'
import { useSimStore } from '../../../store/simStore'
import { applySkyLights, updateNightMaterials, updateSky } from './skyState'

/** Keeps the sky in step with the mission clock for the site at lat / lon. Render once per canvas. */
export function SkyClock({ lat, lon }: { lat: number; lon: number }) {
  // runs before the rest of the frame, so everything reads this frame's sky
  useFrame(({ clock }) => {
    updateSky(useSimStore.getState().simTimeMs, lat, lon)
    updateNightMaterials(clock.elapsedTime)
  }, -2)
  return null
}

/** Sun (or moon) light with shadows, sky light and ambient light, following the time of day. */
export function SkyLights() {
  const sun = useRef<DirectionalLight>(null)
  const hemi = useRef<HemisphereLight>(null)
  const ambient = useRef<AmbientLight>(null)
  useFrame(() => applySkyLights(sun.current, hemi.current, ambient.current))
  return (
    <>
      <hemisphereLight ref={hemi} args={['#dfefff', '#4b5a3a', 0.9]} />
      <ambientLight ref={ambient} intensity={0.15} />
      <directionalLight
        ref={sun}
        position={[70, 100, 40]}
        intensity={2.3}
        castShadow
        shadow-mapSize={[4096, 4096]}
        shadow-camera-left={-110}
        shadow-camera-right={110}
        shadow-camera-top={110}
        shadow-camera-bottom={-110}
        shadow-camera-far={300}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
      />
    </>
  )
}
