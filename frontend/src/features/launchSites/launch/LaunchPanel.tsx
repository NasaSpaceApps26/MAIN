import { useLaunchStore } from './launchStore'
import styles from './LaunchPanel.module.css'

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Mission clock: T−00:08 before liftoff, T+00:12 after. */
function formatClock(clock: number) {
  const a = Math.abs(clock)
  return `T${clock < 0 ? '−' : '+'}${pad2(Math.floor(a / 60))}:${pad2(a % 60)}`
}

/** Big countdown / mission clock and the latest flight event, top centre of the model. */
export function LaunchClock() {
  const phase = useLaunchStore((s) => s.phase)
  const clock = useLaunchStore((s) => s.clock)
  const event = useLaunchStore((s) => s.event)
  if (phase === 'idle' || !event) return null // nothing until the flight reports its first second
  return (
    <div className={styles.clock} aria-live="polite">
      <div className={phase === 'countdown' ? `${styles.time} ${styles.counting}` : styles.time}>
        {formatClock(clock)}
      </div>
      <div className={styles.event}>{event}</div>
    </div>
  )
}
