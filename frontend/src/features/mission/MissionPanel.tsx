import { useEffect, useState } from 'react'
import { useSimStore } from '../../store/simStore'
import { LAUNCH_SITES } from '../launchSites/sites'
import { flightPathOf } from './flightPath'
import { rocketTracker, useMissionStore } from './missionStore'
import type { MissionMode } from './types'
import styles from './MissionPanel.module.css'

const MODES: { id: MissionMode; label: string; hint: string }[] = [
  { id: 'szybki', label: 'Fastest', hint: 'Shortest flight the fuel allows, with reserves' },
  { id: 'oszczedny', label: 'Least fuel', hint: 'Slower flight (about 4 days), least propellant' },
]

const pad2 = (n: number) => String(Math.floor(n)).padStart(2, '0')
function fmtT(s: number) {
  const a = Math.abs(s)
  return `T${s < 0 ? '−' : '+'}${pad2(a / 3600)}:${pad2((a % 3600) / 60)}:${pad2(a % 60)}`
}
const fmtUtc = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
const fmtMin = (s: number) => `${Math.floor(s / 60)}:${pad2(s % 60)}`

function NumberField({ label, value, min, max, onChange }: {
  label: string; value: number; min: number; max: number; onChange: (v: number) => void
}) {
  const [text, setText] = useState(String(value))
  // the value changed from outside (site list, Moon map): show it
  const [shown, setShown] = useState(value)
  if (shown !== value) {
    setShown(value)
    if (Number(text) !== value) setText(String(value))
  }
  return (
    <label className={styles.num}>
      <span>{label}</span>
      <input
        type="number" step="any" min={min} max={max} value={text}
        onChange={(e) => {
          setText(e.target.value)
          const v = Number(e.target.value)
          if (e.target.value !== '' && Number.isFinite(v) && v >= min && v <= max) onChange(v)
        }}
      />
    </label>
  )
}

/** Opens the Landing settings drawer, where the site is picked on the Moon map. */
function openLandingMap() {
  const { pathname, search } = window.location
  window.history.replaceState(null, '', pathname + search + '#landing-settings')
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

/** Live readout of the flight: mission time, phase, altitude, speed. */
function Telemetry() {
  const result = useMissionStore((s) => s.result)
  const [, redraw] = useState(0)
  useEffect(() => {
    const id = setInterval(() => redraw((n) => n + 1), 200)
    return () => clearInterval(id)
  }, [])
  if (!result?.trajectory) return null
  const path = flightPathOf(result.trajectory)
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
 * Moon mission: choose where to launch from and where to land, compute the flight with the
 * mission simulation (backend), then watch it fly in the solar system on the mission clock.
 */
export function MissionPanel() {
  const [open, setOpen] = useState(true)
  const s = useMissionStore()
  const simTimeMs = useSimStore((st) => Math.floor(st.simTimeMs / 3_600_000) * 3_600_000)
  const busy = s.status === 'queued' || s.status === 'running'
  const r = s.result
  const siteId = LAUNCH_SITES.find((x) => x.name === s.launchName)?.id ?? 'custom'

  const play = () => {
    if (!r?.trajectory) return
    const sim = useSimStore.getState()
    sim.setSimTime(r.trajectory.launch_ms - 20_000)
    sim.setTimeScale(10)
    s.setAutoSpeed(true)
    if (!sim.isPlaying) sim.togglePlay()
    sim.selectBody('rocket')
  }
  const seek = (tS: number) => {
    if (!r?.trajectory) return
    useSimStore.getState().setSimTime(r.trajectory.launch_ms + tS * 1000)
    useSimStore.getState().selectBody('rocket')
  }

  if (!open) {
    return (
      <button type="button" className={styles.tab} onClick={() => setOpen(true)}>
        Moon mission
      </button>
    )
  }

  return (
    <aside className={styles.panel} aria-label="Moon mission">
      <header className={styles.head}>
        <span className={styles.heading}>Moon mission</span>
        <button type="button" className={styles.close} onClick={() => setOpen(false)} aria-label="Hide">–</button>
      </header>

      <fieldset className={styles.group} disabled={busy}>
        <legend>Launch (Earth)</legend>
        <select
          value={siteId}
          onChange={(e) => {
            const site = LAUNCH_SITES.find((x) => x.id === e.target.value)
            if (site) s.setLaunch({ lat: site.lat, lon: site.lon }, site.name)
            else s.setLaunch(s.launch, 'Custom location')
          }}
        >
          {LAUNCH_SITES.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          <option value="custom">Custom coordinates…</option>
        </select>
        <div className={styles.row}>
          <NumberField label="Lat °" value={s.launch.lat} min={-90} max={90}
            onChange={(lat) => s.setLaunch({ ...s.launch, lat }, 'Custom location')} />
          <NumberField label="Lon °" value={s.launch.lon} min={-180} max={180}
            onChange={(lon) => s.setLaunch({ ...s.launch, lon }, 'Custom location')} />
        </div>
      </fieldset>

      <fieldset className={styles.group} disabled={busy}>
        <legend>Landing (Moon)</legend>
        <div className={styles.row}>
          <NumberField label="Lat °" value={s.landing.lat} min={-90} max={90}
            onChange={(lat) => s.setLanding({ ...s.landing, lat })} />
          <NumberField label="Lon °" value={s.landing.lon} min={-180} max={180}
            onChange={(lon) => s.setLanding({ ...s.landing, lon })} />
        </div>
        <button type="button" className={styles.link} onClick={openLandingMap}>Pick on the Moon map ›</button>
      </fieldset>

      <fieldset className={styles.group} disabled={busy}>
        <legend>Mission mode</legend>
        <div className={styles.seg} role="radiogroup">
          {MODES.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={s.mode === m.id} title={m.hint}
              className={s.mode === m.id ? styles.on : ''} onClick={() => s.setMode(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
        <p className={styles.hint}>Launch window searched from {fmtUtc(simTimeMs)} (mission clock), 3 days ahead.</p>
      </fieldset>

      <button type="button" className={styles.primary} disabled={busy} onClick={() => void s.compute()}>
        {busy ? 'Computing…' : r ? 'Recompute flight' : 'Compute flight'}
      </button>

      {busy && (
        <div className={styles.progress}>
          <div className={styles.bar}><i /></div>
          <p className={styles.hint}>
            {s.status === 'queued' ? 'Waiting for a free slot…' : `Simulating the flight… ${fmtMin(s.elapsedS)}`}
            {' '}(usually a few minutes)
          </p>
          {s.log.length > 0 && <pre className={styles.log}>{s.log.slice(-5).join('\n')}</pre>}
        </div>
      )}

      {s.status === 'error' && <p className={styles.error}>{s.error}</p>}

      {r && (
        <>
          <p className={r.landed ? styles.ok : styles.error}>{r.verdict}</p>
          {r.failure && <p className={styles.hint}>[{r.failure[0]}] {r.failure[1]}</p>}

          {r.trajectory && (
            <>
              <div className={styles.row}>
                <button type="button" className={styles.launch} onClick={play}>Launch</button>
                <button type="button" onClick={() => useSimStore.getState().selectBody('rocket')}>Follow</button>
              </div>
              <label className={styles.check}>
                <input type="checkbox" checked={s.autoSpeed} onChange={(e) => s.setAutoSpeed(e.target.checked)} />
                Clock speed follows the flight phase
              </label>
              <Telemetry />
            </>
          )}

          {r.events.length > 0 && (
            <ol className={styles.events}>
              {r.events.map((ev) => (
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
                {r.summary.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}
              </tbody>
            </table>
          </details>
          <details className={styles.details}>
            <summary>Full report</summary>
            <pre className={styles.report}>{r.report}</pre>
          </details>
        </>
      )}
    </aside>
  )
}
