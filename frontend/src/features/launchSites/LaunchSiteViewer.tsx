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
import { LaunchClock, LaunchPanel } from './launch/LaunchPanel'
import { useLaunchStore } from './launch/launchStore'
import styles from './LaunchSiteViewer.module.css'

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
            <hemisphereLight args={['#dfefff', '#4b5a3a', 0.9]} />
            <ambientLight intensity={0.15} />
            <directionalLight
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
            <Model key={activeId} />
            <OrbitControls makeDefault autoRotate autoRotateSpeed={0.35} minDistance={4} maxDistance={220} maxPolarAngle={Math.PI / 2.08} />
            <ResetView view={VIEWS[activeId]} />
            <LaunchDirector viewKey={activeId} />
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
          <p className={styles.note}>Simplified model built from basic shapes: buildings and rockets roughly to scale, distances between them shortened. The Saturn V launch shows the last 3 s of the countdown and the first 7 s of flight.</p>
        </div>
      </div>
    </section>
  )
}
