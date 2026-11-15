import { useEffect, useState, type FormEvent } from 'react'
import { useLunarSites } from '../../api/hooks'
import { LAUNCH_SITES, siteById, type LaunchSiteId } from '../../features/launchSites/sites'
import { ROCKETS, type RocketId } from '../../features/mission/flightPlan'
import { landingLabel } from '../../features/mission/landing'
import { MAX_LANDING_POINTS, missionReady, useSimStore } from '../../store/simStore'
import { moonHeight, terrainDataset, useMoonTerrain } from '../SolarSystem/EarthMoon/moonTerrain'
import styles from './MissionPanel.module.css'

const SNAP_KM = 100 // typed launch coordinates must be this close to one of the launch sites
const EARTH_RADIUS_KM = 6371
const DEG = Math.PI / 180

/** Great-circle distance between two points on Earth, km. */
function kmOnEarth(lat1: number, lon1: number, lat2: number, lon2: number) {
  const dLat = (lat2 - lat1) * DEG
  const dLon = (lon2 - lon1) * DEG
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h))
}

/** "28.5" or "28,5" → 28.5. Empty, not a number, or beyond ±limit → null. */
function parseDegrees(text: string, limit: number) {
  const trimmed = text.trim().replace(',', '.')
  const value = Number(trimmed)
  return trimmed !== '' && Number.isFinite(value) && Math.abs(value) <= limit ? value : null
}

/** UTC ms ↔ the value of a datetime-local input, read as UTC ('1969-07-16T13:32'). */
const toUtcInput = (ms: number) => new Date(ms).toISOString().slice(0, 16)
const fromUtcInput = (value: string) => Date.parse(`${value}:00Z`)

type CoordFormProps = {
  label: string // what the coordinates are for (read out by screen readers)
  lat: number | null // current value, shown when the form opens
  lon: number | null
  onSet: (lat: number, lon: number) => string | null // null = accepted, else the error to show
}

/**
 * Latitude + longitude boxes and a Set button. The parent gives it a `key` made from the current
 * value, so when the value changes elsewhere (a click on the globe) the boxes show the new one.
 */
function CoordForm({ label, lat, lon, onSet }: CoordFormProps) {
  const [latText, setLatText] = useState(lat === null ? '' : lat.toFixed(4))
  const [lonText, setLonText] = useState(lon === null ? '' : lon.toFixed(4))
  const [error, setError] = useState<string | null>(null)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const la = parseDegrees(latText, 90)
    const lo = parseDegrees(lonText, 180)
    if (la === null || lo === null) return setError('Lat −90…90, lon −180…180')
    setError(onSet(la, lo))
  }

  return (
    <form className={styles.coords} onSubmit={submit} aria-label={label}>
      <label className={styles.field}>
        <span>Lat</span>
        <input
          className={styles.input}
          inputMode="decimal"
          value={latText}
          placeholder="0.0000"
          onChange={(e) => setLatText(e.target.value)}
        />
      </label>
      <label className={styles.field}>
        <span>Lon</span>
        <input
          className={styles.input}
          inputMode="decimal"
          value={lonText}
          placeholder="0.0000"
          onChange={(e) => setLonText(e.target.value)}
        />
      </label>
      <button type="submit" className={styles.small}>
        Set
      </button>
      {error && (
        <span className={styles.error} role="alert">
          {error}
        </span>
      )}
    </form>
  )
}

/**
 * Mission planner at the bottom of the space view.
 *  1. Launch sites: one or more (＋ adds another to compare). Click a red dot on Earth, choose from
 *     the list, or type coordinates near a site. A dot click fills the highlighted slot.
 *  2. Rocket and launch time.
 *  3. Landing points on the Moon: one or more (＋ adds another to compare). Type coordinates, click a
 *     named lunar site, or switch on "Pick on Moon" and click the Moon's surface (only then does a
 *     click on the Moon pick a point). Each fills the highlighted slot.
 * "Go to launch site" opens the 3D model of the highlighted site; its Launch button stays locked until
 * the mission is complete (see LaunchPanel). "Mission results" opens the analysis (MissionResults).
 */
export function MissionPanel() {
  const missionSites = useSimStore((s) => s.missionSites)
  const activeSlot = useSimStore((s) => s.activeSiteSlot)
  const rocketId = useSimStore((s) => s.rocketId)
  const launchTimeMs = useSimStore((s) => s.launchTimeMs)
  const landingPoints = useSimStore((s) => s.landingPoints)
  const activeLanding = useSimStore((s) => s.activeLandingSlot)
  const picking = useSimStore((s) => s.pickingLanding)
  const ready = useSimStore(missionReady)
  const { data: lunarSites } = useLunarSites()
  const terrain = useMoonTerrain(picking) // picking needs the Moon's heights: start loading them

  const activeId = missionSites[activeSlot] ?? null
  const activeSite = activeId ? siteById(activeId) : null
  const anySite = missionSites.some((id) => id !== null)
  const canAdd = missionSites.length < LAUNCH_SITES.length && missionSites.every((id) => id !== null)
  const point = landingPoints[activeLanding] ?? null // the landing point being edited
  const anyLanding = landingPoints.some((p) => p !== null)
  const canAddLanding = landingPoints.length < MAX_LANDING_POINTS && landingPoints.every((p) => p !== null)

  // While picking: crosshair cursor, and Esc cancels
  useEffect(() => {
    if (!picking) return
    document.body.style.cursor = 'crosshair'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useSimStore.getState().setPickingLanding(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.cursor = ''
      window.removeEventListener('keydown', onKey)
    }
  }, [picking])

  /** Typed launch coordinates: the nearest launch site goes into the active slot, if close enough. */
  const setLaunchByCoords = (lat: number, lon: number) => {
    let nearest = LAUNCH_SITES[0]
    let nearestKm = Infinity
    for (const s of LAUNCH_SITES) {
      const km = kmOnEarth(lat, lon, s.lat, s.lon)
      if (km < nearestKm) {
        nearest = s
        nearestKm = km
      }
    }
    if (nearestKm > SNAP_KM) return `No launch site within ${SNAP_KM} km. Use a red dot.`
    useSimStore.getState().chooseLaunchSite(nearest.id)
    return null
  }

  /** Typed landing coordinates: any point on the Moon, into the active landing slot. */
  const setLandingByCoords = (lat: number, lon: number) => {
    const s = useSimStore.getState()
    s.setLandingPoint({ latDeg: lat, lonDeg: lon, elevationM: moonHeight(lat, lon), datasetId: terrainDataset(), siteId: null })
    s.setPickingLanding(false)
    return null
  }

  const setCount = Number(anySite) + Number(anyLanding)
  const hint = !anySite
    ? 'Choose a launch site: click a red dot on Earth, pick one from the list or type its coordinates.'
    : !anyLanding
      ? 'Launch stays locked until the landing point on the Moon is set.'
      : 'All set: open the launch site to fly it, or the results to compare.'

  return (
    <section className={styles.panel} aria-label="Mission">
      <header className={styles.header}>
        <h2 className={styles.title}>Mission</h2>
        <span className={ready ? `${styles.status} ${styles.ok}` : styles.status}>
          {ready ? 'Ready for launch' : `${setCount} / 2 set`}
        </span>
      </header>

      {/* 1. Launch sites */}
      <div className={styles.row}>
        <div className={styles.rowLabel}>
          <span className={anySite ? `${styles.step} ${styles.stepDone}` : styles.step}>1</span>
          Launch sites
        </div>
        <div className={styles.slots}>
          {missionSites.map((id, slot) => (
            <div
              key={slot}
              className={slot === activeSlot ? `${styles.slot} ${styles.slotActive}` : styles.slot}
              onClick={() => useSimStore.getState().setActiveSiteSlot(slot)}
            >
              <select
                className={styles.select}
                value={id ?? ''}
                aria-label={`Launch site ${slot + 1}`}
                onChange={(e) =>
                  useSimStore.getState().setMissionSiteAt(slot, (e.target.value || null) as LaunchSiteId | null)
                }
              >
                <option value="">{slot === 0 ? 'Click a red dot…' : 'Choose a site…'}</option>
                {LAUNCH_SITES.map((s) => (
                  // a site can only be in one slot
                  <option key={s.id} value={s.id} disabled={s.id !== id && missionSites.includes(s.id)}>
                    {s.name}
                  </option>
                ))}
              </select>
              {missionSites.length > 1 && (
                <button
                  type="button"
                  className={styles.remove}
                  aria-label={`Remove launch site ${slot + 1}`}
                  title="Remove"
                  onClick={(e) => {
                    e.stopPropagation()
                    useSimStore.getState().removeMissionSiteSlot(slot)
                  }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            className={styles.add}
            disabled={!canAdd}
            title={canAdd ? 'Add another launch site to compare' : 'Fill the empty slot first'}
            onClick={() => useSimStore.getState().addMissionSiteSlot()}
          >
            ＋
          </button>
        </div>
        <CoordForm
          key={`launch:${activeSlot}:${activeId}`}
          label="Launch site coordinates"
          lat={activeSite?.lat ?? null}
          lon={activeSite?.lon ?? null}
          onSet={setLaunchByCoords}
        />
      </div>

      {/* 2. Rocket and launch time */}
      <div className={styles.row}>
        <div className={styles.rowLabel}>
          <span className={`${styles.step} ${styles.stepDone}`}>2</span>
          Rocket
        </div>
        <select
          className={styles.select}
          value={rocketId}
          aria-label="Rocket"
          onChange={(e) => useSimStore.getState().setRocket(e.target.value as RocketId)}
        >
          {ROCKETS.map((r) => (
            <option key={r.id} value={r.id} title={r.description}>
              {r.name}
            </option>
          ))}
        </select>
        <div className={styles.coords}>
          <label className={styles.field}>
            <span>Launch UTC</span>
            <input
              className={`${styles.input} ${styles.time}`}
              type="datetime-local"
              value={toUtcInput(launchTimeMs)}
              onChange={(e) => {
                const t = fromUtcInput(e.target.value)
                if (Number.isFinite(t)) useSimStore.getState().setLaunchTime(t)
              }}
            />
          </label>
          <button
            type="button"
            className={styles.small}
            title="Launch at the mission clock's time"
            onClick={() => {
              const s = useSimStore.getState()
              s.setLaunchTime(Math.floor(s.simTimeMs / 60_000) * 60_000)
            }}
          >
            Clock
          </button>
        </div>
      </div>

      {/* 3. Landing points */}
      <div className={styles.row}>
        <div className={styles.rowLabel}>
          <span className={anyLanding ? `${styles.step} ${styles.stepDone}` : styles.step}>3</span>
          Landing (Moon)
        </div>
        <div className={styles.slots}>
          {landingPoints.map((p, slot) => (
            <div key={slot} className={slot === activeLanding ? `${styles.slot} ${styles.slotActive}` : styles.slot}>
              <button
                type="button"
                className={styles.chip}
                title={p ? `${p.latDeg.toFixed(4)}°, ${p.lonDeg.toFixed(4)}° · ${p.elevationM.toFixed(0)} m` : 'Empty: pick a point'}
                onClick={() => useSimStore.getState().setActiveLandingSlot(slot)}
              >
                {landingLabel(p, slot, lunarSites)}
              </button>
              {(p || landingPoints.length > 1) && (
                <button
                  type="button"
                  className={styles.remove}
                  aria-label={`Remove landing point ${slot + 1}`}
                  title="Remove"
                  onClick={() => useSimStore.getState().removeLandingSlot(slot)}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            className={styles.add}
            disabled={!canAddLanding}
            title={canAddLanding ? 'Add another landing point to compare' : landingPoints.length >= MAX_LANDING_POINTS ? `At most ${MAX_LANDING_POINTS}` : 'Fill the empty slot first'}
            onClick={() => useSimStore.getState().addLandingSlot()}
          >
            ＋
          </button>
          <button
            type="button"
            className={picking ? `${styles.small} ${styles.picking}` : styles.small}
            aria-pressed={picking}
            onClick={(e) => {
              useSimStore.getState().setPickingLanding(!picking)
              e.currentTarget.blur() // so W/A/S/D go back to flying the camera
            }}
          >
            {picking ? 'Click the Moon… (Esc)' : '◎ Pick'}
          </button>
        </div>
        <CoordForm
          key={`landing:${activeLanding}:${point?.latDeg}:${point?.lonDeg}`}
          label="Landing point coordinates"
          lat={point?.latDeg ?? null}
          lon={point?.lonDeg ?? null}
          onSet={setLandingByCoords}
        />
      </div>

      {picking && terrain.phase !== 'ready' && (
        <p className={styles.note}>
          {terrain.phase === 'error'
            ? 'Moon terrain could not load: type the coordinates instead.'
            : 'Loading Moon terrain… clicks work once it is in.'}
        </p>
      )}

      <footer className={styles.footer}>
        <p className={styles.note}>{hint}</p>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.go}
            disabled={!activeSite}
            title={activeSite ? `Open ${activeSite.name}` : 'Choose a launch site first'}
            onClick={() => activeSite && useSimStore.getState().openLaunchSite(activeSite.id)}
          >
            Launch site ▸
          </button>
          <button
            type="button"
            className={`${styles.go} ${styles.results}`}
            disabled={!ready}
            title={ready ? 'Arrival, landing area, power and comms' : 'Set a launch site and a landing point first'}
            onClick={() => useSimStore.getState().setResultsOpen(true)}
          >
            Results ▸
          </button>
        </div>
      </footer>
    </section>
  )
}
