import { MoonPhaseIcon } from '../icons/Icons'
import { useSimStore } from '../../store/simStore'
import { SIZE_OPTIONS } from '../SolarSystem/scale'
import { MissionClock } from './MissionClock'
import styles from './TopBar.module.css'

export function TopBar() {
  const planetSize = useSimStore((s) => s.planetSize)
  const setPlanetSize = useSimStore((s) => s.setPlanetSize)
  const shadows = useSimStore((s) => s.shadows)
  const setShadows = useSimStore((s) => s.setShadows)

  const buttonClass = (active: boolean) =>
    active ? `${styles.size} ${styles.active}` : styles.size

  return (
    <div className={styles.bar}>
      <div className={styles.brand}>
        <span className={styles.logo} aria-hidden="true"><MoonPhaseIcon /></span>
        <div>
          <h1 className={styles.title}>Lunar Mission Explorer</h1>
          <p className={styles.subtitle}>Earth–Moon transit simulator</p>
        </div>
      </div>

      <div className={styles.controls}>
        {/* Off: every body evenly lit, no night side. Same look as the size picker next to it. */}
        <div className={styles.sizeBox}>
          <span className={styles.sizeLabel}>Shadows</span>
          <div className={styles.sizes} role="group" aria-label="Shadows">
            <button className={buttonClass(shadows)} onClick={() => setShadows(true)}>
              On
            </button>
            <button className={buttonClass(!shadows)} onClick={() => setShadows(false)}>
              Off
            </button>
          </div>
        </div>
        {/* Makes the spheres bigger so they're easier to see. Only the Moon's orbit changes (from ×50). */}
        <div className={styles.sizeBox}>
          <span className={styles.sizeLabel}>Planets</span>
          <div className={styles.sizes} role="group" aria-label="Planet size">
            {SIZE_OPTIONS.map((o) => (
              <button
                key={o.size}
                className={buttonClass(o.size === planetSize)}
                onClick={() => setPlanetSize(o.size)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <MissionClock />
      </div>
    </div>
  )
}
