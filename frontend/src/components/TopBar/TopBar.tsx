import { MissionClock } from './MissionClock'
import styles from './TopBar.module.css'

export function TopBar() {
  return (
    <div className={styles.bar}>
      <div className={styles.brand}>
        <span className={styles.logo} aria-hidden="true">◐</span>
        <div>
          <h1 className={styles.title}>Lunar Mission Explorer</h1>
          <p className={styles.subtitle}>Earth–Moon transit simulator</p>
        </div>
      </div>
      <MissionClock />
    </div>
  )
}
