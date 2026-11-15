import { useEffect, useState, type ComponentType } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useSimStore } from '../../store/simStore'
import { CapeCanaveralModel } from './models/CapeCanaveralModel'
import { KennedyModel } from './models/KennedyModel'
import { VandenbergModel } from './models/VandenbergModel'
import { WallopsModel } from './models/WallopsModel'
import { formatCoord, nearbySites, siteById, type LaunchSiteId } from './sites'
import { LaunchDirector } from './launch/LaunchDirector'
import { LaunchLight, LaunchPrewarm, LaunchTimeSync } from './launch/LaunchStage'
import { SkyClock, SkyLights } from './sky/SkyScene'
import { LaunchClock, LaunchPanel } from './launch/LaunchPanel'
import { useLaunchStore } from './launch/launchStore'
import styles from './LaunchSiteViewer.module.css'

/** After liftoff the window closes on its own after this many seconds, back to the space view. */
const AUTO_CLOSE_AFTER_LIFTOFF_S = 18

const MODELS: Record<LaunchSiteId, ComponentType> = {
  ksc: KennedyModel,
  ccsfs: CapeCanaveralModel,
  vandenberg: VandenbergModel,
  wallops: WallopsModel,
}

type View = { camera: [number, number, number]; target: [number, number, number] }

/** Starting viewpoint for each model. */
const VIEWS: Record<LaunchSiteId, View> = {
  ksc: { camera: [40, 52, 62], target: [-20, 2, -8] },
  ccsfs: { camera: [42, 50, 62], target: [-22, 2, 2] },
  vandenberg: { camera: [52, 50, 62], target: [8, 3, 4] },
  wallops: { camera: [38, 46, 66], target: [-18, 1, 0] },
}

/** Moves the camera to the model's starting view whenever another model is shown. */
function ResetView({ view }: { view: View }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as { target: { set: (...v: number[]) => void }; update: () => void } | null
  useEffect(() => {
    camera.position.set(...view.camera)
    controls?.target.set(...view.target)
    controls?.update()
  }, [camera, controls, view])
  return null
}

/** Window with a 3D model of the launch site whose red dot was clicked on Earth. */
export function LaunchSiteViewer() {
  const siteId = useSimStore((s) => s.launchSiteId)
  const openLaunchSite = useSimStore((s) => s.openLaunchSite)
  if (!siteId) return null
  // keyed so a new click starts on the clicked site
  return <ViewerWindow key={siteId} siteId={siteId} onClose={() => openLaunchSite(null)} />
}

function ViewerWindow({ siteId, onClose }: { siteId: LaunchSiteId; onClose: () => void }) {
  const [activeId, setActiveId] = useState(siteId)
  const group = nearbySites(siteId) // sites sharing the clicked dot, one under another
  const active = siteById(activeId)
  const Model = MODELS[activeId]

  // a launch belongs to the model it started in: stop it when another site is shown or the window closes
  const resetLaunch = useLaunchStore((s) => s.reset)
  useEffect(() => {
    resetLaunch()
    return resetLaunch
  }, [activeId, resetLaunch])

  // T+18 s: close the window. A real-time timer from liftoff, because the flight's own clock stops
  // early when the rocket fades into the haze. Scrubbing or resetting the launch cancels it.
  const run = useLaunchStore((s) => s.run)
  const lifted = useLaunchStore((s) => s.phase === 'flight' || s.phase === 'done')
  useEffect(() => {
    if (!lifted) return
    const timer = setTimeout(() => useSimStore.getState().openLaunchSite(null), AUTO_CLOSE_AFTER_LIFTOFF_S * 1000)
    return () => clearTimeout(timer)
  }, [lifted, run])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <section className={styles.window} role="dialog" aria-label={`3D model: ${active.name}`}>
      <header className={styles.header}>
        <h2 className={styles.title}>{group.length > 1 ? 'Launch sites' : active.name}</h2>
        <button type="button" className={styles.close} onClick={onClose} title="Close (Esc)" aria-label="Close">
          ×
        </button>
      </header>

      <div className={styles.content}>
        <ul className={styles.list}>
          {group.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className={s.id === activeId ? `${styles.site} ${styles.active}` : styles.site}
                aria-pressed={s.id === activeId}
                onClick={() => setActiveId(s.id)}
              >
                <span className={styles.siteName}>{s.name}</span>
                <span className={styles.coord}>
                  {formatCoord(s.lat)}, {formatCoord(s.lon)}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div className={styles.stage}>
          <Canvas shadows dpr={[1, 2]} camera={{ position: VIEWS[siteId].camera, fov: 40, near: 0.1, far: 1200 }}>
            {/* during a launch the mission clock runs with the launch timer */}
            <LaunchTimeSync />
            {/* sky, sunlight and night lamps follow the mission clock at this site */}
            <SkyClock lat={active.lat} lon={active.lon} />
            <SkyLights />
            <Model key={activeId} />
            <OrbitControls makeDefault autoRotate autoRotateSpeed={0.35} minDistance={4} maxDistance={220} maxPolarAngle={Math.PI / 2.08} />
            <ResetView view={VIEWS[activeId]} />
            <LaunchDirector viewKey={activeId} />
            <LaunchLight />
            <LaunchPrewarm key={`prewarm-${activeId}`} />
          </Canvas>
          <LaunchClock />
          <LaunchPanel key={activeId} pads={active.pads} />
          <p className={styles.hint}>Drag to rotate · scroll to zoom · right-drag to pan</p>
        </div>

        <div className={styles.info}>
          <p className={styles.description}>{active.description}</p>
          <ul className={styles.features}>
            {active.features.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
