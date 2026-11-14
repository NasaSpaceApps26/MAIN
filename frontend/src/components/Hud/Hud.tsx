import { BackendStatus } from './BackendStatus'
import { TimeControls } from './TimeControls'
import styles from './Hud.module.css'

export function Hud() {
  return (
    <aside className={styles.hud}>
      <BackendStatus />
      <TimeControls />
    </aside>
  )
}
