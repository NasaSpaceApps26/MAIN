import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { AdditiveBlending, ConeGeometry, type PointLight } from 'three'
import { useSimStore } from '../../../store/simStore'
import { tracker, useLaunchStore } from './launchStore'
import { ParticlePool } from './particles'

/**
 * Glow of a launching rocket's flames on the pad and the smoke. One light lives in the scene from
 * the start (dark until a launch): adding a light at launch time would make the browser rebuild the
 * shaders of every material in the scene, a long freeze on pressing Launch.
 */
export function LaunchLight() {
  const light = useRef<PointLight>(null)
  useFrame(() => {
    const l = light.current
    if (!l) return
    l.intensity = tracker.light.intensity
    l.position.copy(tracker.light.position)
  })
  return <pointLight ref={light} color="#ffb060" intensity={0} distance={90} decay={2} />
}

const cone = new ConeGeometry(1, 1, 8)

/**
 * Builds the shaders the launch needs (smoke and flame materials) when the window opens, so pressing
 * Launch does not stall while they compile. The objects stay in the scene, out of sight below the
 * ground: removing them would let the browser drop the compiled shaders again.
 */
export function LaunchPrewarm() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const pool = useMemo(() => new ParticlePool(1), [])
  useEffect(() => () => pool.dispose(), [pool])
  useEffect(() => {
    gl.compileAsync(scene, camera).catch(() => {}) // only a speed-up: launching works without it
  }, [gl, scene, camera])
  return (
    <group position={[0, -500, 0]} scale={0.001}>
      <primitive object={pool.mesh} />
      {/* same material settings as the flame cones (see Flame) */}
      <mesh geometry={cone}>
        <meshBasicMaterial
          transparent
          opacity={0.5}
          blending={AdditiveBlending}
          depthWrite={false}
          fog={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  )
}

/**
 * Freezes the mission clock when a launch begins and then runs it with the launch timer, one second
 * per second from the start of the countdown, so the sky and the clock show the moment of the launch.
 * Only for a moment: pressing play hands the clock back at once and it runs as usual. Otherwise it
 * goes back to how it was (playing again at its speed, if it was playing) once the rocket is out of
 * sight, or when the launch is reset earlier.
 */
export function LaunchTimeSync() {
  const held = useRef<{ run: number; start: number; wasPlaying: boolean } | null>(null)
  const released = useRef(0) // launch run whose clock the user took back
  const restore = () => {
    const h = held.current
    held.current = null
    const sim = useSimStore.getState()
    if (h?.wasPlaying && !sim.isPlaying) sim.togglePlay()
  }
  useEffect(() => restore, []) // window closed during a launch
  useFrame(() => {
    const { phase, run } = useLaunchStore.getState()
    const sim = useSimStore.getState()
    if (phase === 'idle') {
      if (held.current) restore()
      return
    }
    if (released.current === run) return
    if (phase === 'done') {
      // the rocket is out of sight ("Next rocket"): the clock goes back to how it was set
      if (held.current?.run === run) restore()
      released.current = run
      return
    }
    if (held.current?.run !== run) {
      // a new launch: freeze the clock where it is now
      held.current = { run, start: sim.simTimeMs, wasPlaying: sim.isPlaying }
      tracker.elapsed = 0
      if (sim.isPlaying) sim.togglePlay()
    } else if (sim.isPlaying) {
      // play pressed during the launch: the clock is the user's again
      held.current = null
      released.current = run
      return
    }
    const t = held.current.start + tracker.elapsed * 1000
    if (t !== sim.simTimeMs) sim.setSimTime(t)
  }, -3)
  return null
}
