import { useState } from 'react'
import type { LaunchPad } from '../sites'
import { useLaunchStore } from './launchStore'
import styles from './LaunchPanel.module.css'

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Mission clock: T−00:08 before liftoff, T+00:12 after. */
function formatClock(clock: number) {
  const a = Math.abs(clock)
  return `T${clock < 0 ? '−' : '+'}${pad2(Math.floor(a / 60))}:${pad2(a % 60)}`
}

/** Launch controls over the 3D model: choose a pad, launch, follow the rocket, reset. */
export function LaunchPanel({ pads }: { pads: readonly LaunchPad[] }) {
  const [selected, setSelected] = useState(pads[0]?.id)
  const activePad = useLaunchStore((s) => s.padId)
  const phase = useLaunchStore((s) => s.phase)
  const follow = useLaunchStore((s) => s.follow)
  const launch = useLaunchStore((s) => s.launch)
  const reset = useLaunchStore((s) => s.reset)
  const setFollow = useLaunchStore((s) => s.setFollow)
  if (pads.length === 0) return null

  const busy = activePad !== null
  const current = activePad ?? selected

  return (
    <div className={styles.panel}>
      <div className={styles.heading}>Launch</div>
      {pads.length > 1 && (
        <div className={styles.pads} role="radiogroup" aria-label="Launch pad">
          {pads.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={p.id === current}
              className={p.id === current ? `${styles.pad} ${styles.padActive}` : styles.pad}
              disabled={busy && p.id !== current}
              onClick={() => setSelected(p.id)}
              title={p.rocket}
            >
              <span className={styles.padName}>{p.name}</span>
              <span className={styles.padRocket}>{p.rocket}</span>
            </button>
          ))}
        </div>
      )}
      {pads.length === 1 && <p className={styles.single}>{pads[0].rocket}</p>}

      {phase === 'idle' ? (
        <button type="button" className={styles.launch} onClick={() => current && launch(current)}>
          <span aria-hidden>▲</span> Launch
        </button>
      ) : (
        <button type="button" className={styles.reset} onClick={reset}>
          {phase === 'countdown' ? 'Scrub launch' : phase === 'done' ? 'Next rocket' : 'Reset'}
        </button>
      )}

      <label className={styles.follow}>
        <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
        Tracking camera
      </label>
    </div>
  )
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
