import { useEffect, useState } from 'react'
import { useSimStore } from '../../store/simStore'
import { flightPathOf } from './flightPath'
import { followFlight, rocketTracker, useFlight, useFlightStatus, useMissionStore } from './missionStore'
import type { MissionResult } from './types'
import styles from './FlightPanel.module.css'

const pad2 = (n: number) => String(Math.floor(n)).padStart(2, '0')
function fmtT(s: number) {
  const a = Math.abs(s)
  return `T${s < 0 ? '−' : '+'}${pad2(a / 3600)}:${pad2((a % 3600) / 60)}:${pad2(a % 60)}`
}
const fmtMin = (s: number) => `${Math.floor(s / 60)}:${pad2(s % 60)}`
const fmtUtc = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ') + ' UTC'

/** Live readout of the flight: mission time, phase, altitude, speed. */
function Telemetry({ flight }: { flight: MissionResult }) {
  const [, redraw] = useState(0)
  useEffect(() => {
    const id = setInterval(() => redraw((n) => n + 1), 200)
    return () => clearInterval(id)
  }, [])
  if (!flight.trajectory) return null
  const path = flightPathOf(flight.trajectory)
  const tS = (useSimStore.getState().simTimeMs - path.launchMs) / 1000
  const st = path.state(Math.max(0, tS))
  const nearMoon = st.moonDistKm < 60_000
  return (
    <div className={styles.telemetry}>
      <div className={styles.clock}>{fmtT(Math.round(tS))}</div>
      <div className={styles.phase}>{tS < 0 ? 'On the launch pad' : rocketTracker.phase || st.phase}</div>
      {tS >= 0 && (
        <div className={styles.grid}>
          <span>{nearMoon ? 'Alt. above Moon' : 'Alt. above Earth'}</span>
          <b>{Math.round(nearMoon ? st.altMoonKm : st.altEarthKm).toLocaleString('en')} km</b>
          <span>Speed (geocentric)</span>
          <b>{st.speedKmS.toFixed(2)} km/s</b>
          <span>Mass</span>
          <b>{(st.massKg / 1000).toFixed(1)} t</b>
        </div>
      )}
    </div>
  )
}

/**
 * The computed Moon flight (mission panel, step 4): progress while the simulation runs, then the
 * verdict, live telemetry, the flight's events (click one to jump there) and the full report.
 * Shown only while there is something to show.
 */
export function FlightPanel() {
  const [open, setOpen] = useState(true)
  const flight = useFlight()
  const status = useFlightStatus()
  const log = useMissionStore((s) => s.log)
  const error = useMissionStore((s) => s.error)
  const elapsedS = useMissionStore((s) => s.elapsedS)
  const autoSpeed = useMissionStore((s) => s.autoSpeed)
  const busy = status === 'queued' || status === 'running'

  if (!flight && !busy && status !== 'error') return null

  if (!open) {
    return (
      <button type="button" className={styles.tab} onClick={() => setOpen(true)}>
        Flight
      </button>
    )
  }

  const seek = (tS: number) => {
    if (!flight?.trajectory) return
    useSimStore.getState().setSimTime(flight.trajectory.launch_ms + tS * 1000)
    useSimStore.getState().selectBody('rocket')
  }

  return (
    <aside className={styles.panel} aria-label="Flight">
      <header className={styles.head}>
        <span className={styles.heading}>Flight to the Moon</span>
        <button type="button" className={styles.close} onClick={() => setOpen(false)} aria-label="Hide">
          –
        </button>
      </header>

      {busy && (
        <div className={styles.progress}>
          <div className={styles.bar}>
            <i />
          </div>
          <p className={styles.hint}>
            {status === 'queued' ? 'Waiting for a free slot…' : `Simulating the flight… ${fmtMin(elapsedS)}`} (usually
            under a few minutes)
          </p>
          {log.length > 0 && <pre className={styles.log}>{log.slice(-5).join('\n')}</pre>}
        </div>
      )}

      {status === 'error' && <p className={styles.error}>{error}</p>}

      {flight && (
        <>
          <p className={flight.landed ? styles.ok : styles.error}>{flight.verdict}</p>
          {flight.failure && (
            <p className={styles.hint}>
              [{flight.failure[0]}] {flight.failure[1]}
            </p>
          )}

          {flight.trajectory && (
            <>
              <p className={styles.hint}>Liftoff {fmtUtc(flight.trajectory.launch_ms)}</p>
              <div className={styles.row}>
                <button type="button" className={styles.launch} onClick={() => followFlight(-20)}>
                  Fly in space view
                </button>
                <button type="button" onClick={() => useSimStore.getState().selectBody('rocket')}>
                  Follow
                </button>
              </div>
              <p className={styles.hint}>
                Or open the launch site from the mission panel and launch there: after liftoff the view comes back
                here and follows the rocket.
              </p>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={autoSpeed}
                  onChange={(e) => useMissionStore.getState().setAutoSpeed(e.target.checked)}
                />
                Clock speed follows the flight phase
              </label>
              <Telemetry flight={flight} />
            </>
          )}

          {flight.events.length > 0 && (
            <ol className={styles.events}>
              {flight.events.map((ev) => (
                <li key={ev.name + ev.t_s}>
                  <button type="button" onClick={() => seek(ev.t_s)}>
                    <span className={styles.evTime}>{fmtT(ev.t_s)}</span> {ev.name}
                  </button>
                </li>
              ))}
            </ol>
          )}

          <details className={styles.details}>
            <summary>Summary</summary>
            <table>
              <tbody>
                {flight.summary.map(([k, v]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          <details className={styles.details}>
            <summary>Full report</summary>
            <pre className={styles.report}>{flight.report}</pre>
          </details>
        </>
      )}
    </aside>
  )
}
