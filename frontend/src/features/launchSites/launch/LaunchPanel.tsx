import { useState } from 'react'
import { missionReady, useSimStore } from '../../../store/simStore'
import { useFlight, useFlightStatus } from '../../mission/missionStore'
import type { LaunchPad, LaunchSiteId } from '../sites'
import { useLaunchStore } from './launchStore'
import { PROFILES } from './profiles'
import styles from './LaunchPanel.module.css'

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Mission clock: T−00:08 before liftoff, T+00:12 after. */
function formatClock(clock: number) {
  const a = Math.abs(clock)
  return `T${clock < 0 ? '−' : '+'}${pad2(Math.floor(a / 60))}:${pad2(a % 60)}`
}

const fmtUtc = (ms: number) => new Date(ms).toISOString().slice(11, 19) + ' UTC'

/**
 * Launch controls over the 3D model: choose a pad, launch, follow the rocket, reset.
 * With a computed flight for this site (mission panel, step 4) the launch happens at the flight's
 * liftoff time, and after it the space view follows the rocket to the Moon (see LaunchSiteViewer).
 */
export function LaunchPanel({ siteId, pads }: { siteId: LaunchSiteId; pads: readonly LaunchPad[] }) {
  const [selected, setSelected] = useState(pads[0]?.id)
  const activePad = useLaunchStore((s) => s.padId)
  const phase = useLaunchStore((s) => s.phase)
  const follow = useLaunchStore((s) => s.follow)
  const launch = useLaunchStore((s) => s.launch)
  const reset = useLaunchStore((s) => s.reset)
  const setFollow = useLaunchStore((s) => s.setFollow)
  // locked until the mission panel has a launch site and a landing point on the Moon
  const ready = useSimStore(missionReady)
  const hasSite = useSimStore((s) => s.missionSites.some((id) => id !== null))
  // the computed flight, if it starts from this site
  const plannedSite = useSimStore((s) => s.missionSites[s.activeSiteSlot] ?? null)
  const flight = useFlight()
  const flightStatus = useFlightStatus()
  const flightHere = plannedSite === siteId ? flight : null
  if (pads.length === 0) return null

  const busy = activePad !== null
  const current = activePad ?? selected

  const start = () => {
    if (!ready || !current) return
    // a computed flight: count down to its liftoff, so the sky and the clock show that moment
    if (flightHere?.trajectory) {
      const sim = useSimStore.getState()
      if (sim.isPlaying) sim.togglePlay()
      sim.setSimTime(flightHere.trajectory.launch_ms - PROFILES.saturnV.countdown * 1000)
    }
    launch(current)
  }

  const flightNote = !ready
    ? null
    : flightHere?.trajectory
      ? `Liftoff ${fmtUtc(flightHere.trajectory.launch_ms)}. After liftoff the space view follows the rocket to the Moon.`
      : plannedSite !== siteId
        ? 'The mission panel has another launch site highlighted: this launch is not followed into space.'
        : flightStatus === 'queued' || flightStatus === 'running'
          ? 'The flight is still being computed: launch when it is ready to follow it into space.'
          : 'Compute the flight in the mission panel (step 4) to follow the rocket into space after liftoff.'

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
        <>
          <button
            type="button"
            className={styles.launch}
            disabled={!ready}
            onClick={start}
          >
            <span aria-hidden>{ready ? '▲' : '🔒'}</span> Launch
          </button>
          {!ready && (
            <p className={styles.locked}>
              {hasSite
                ? 'Set the landing point on the Moon in the mission panel first.'
                : 'Choose a launch site and a landing point in the mission panel first.'}
            </p>
          )}
          {flightNote && <p className={styles.single}>{flightNote}</p>}
        </>
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
