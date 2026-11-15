import { useSimStore } from '../../store/simStore'
import { PauseIcon, PlayIcon } from '../icons/Icons'
import styles from './MissionClock.module.css'

const SPEEDS = [
  { value: 1, label: '1×' },
  { value: 60, label: '1 min/s' },
  { value: 3600, label: '1 h/s' },
  { value: 86400, label: '1 d/s' },
]

function formatUtc(ms: number) {
  const iso = new Date(ms).toISOString()
  return { date: iso.slice(0, 10), time: iso.slice(11, 19) }
}

export function MissionClock() {
  const simTimeMs = useSimStore((s) => s.simTimeMs)
  const isPlaying = useSimStore((s) => s.isPlaying)
  const timeScale = useSimStore((s) => s.timeScale)
  const togglePlay = useSimStore((s) => s.togglePlay)
  const setTimeScale = useSimStore((s) => s.setTimeScale)

  const { date, time } = formatUtc(simTimeMs)

  return (
    <div className={styles.clock}>
      <div className={styles.readout}>
        <span className={styles.label}>UTC</span>
        <span className={styles.date}>{date}</span>
        <span className={styles.time}>{time}</span>
      </div>

      <button
        className={styles.play}
        onClick={togglePlay}
        aria-label={isPlaying ? 'Pause simulation' : 'Play simulation'}
      >
        {isPlaying ? <PauseIcon /> : <PlayIcon />}
      </button>

      <div className={styles.speeds} role="group" aria-label="Simulation speed">
        {SPEEDS.map((s) => (
          <button
            key={s.value}
            className={s.value === timeScale ? `${styles.speed} ${styles.active}` : styles.speed}
            onClick={() => setTimeScale(s.value)}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  )
}