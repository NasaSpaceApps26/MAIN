import { useEffect, useMemo } from 'react'
import { useLunarSites } from '../../api/hooks'
import { moonHeight, terrainDataset, useMoonTerrain } from '../../components/SolarSystem/EarthMoon/moonTerrain'
import { useSimStore, type LandingPoint } from '../../store/simStore'
import { siteById, type LaunchSiteId } from '../launchSites/sites'
import { analyzeSky, formatDuration } from '../moonSky/analysis.js'
import { fmtUtc } from '../moonSky/format.js'
import { useMoonSky } from '../moonSky/useMoonSky.js'
import '../moonSky/moonSky.css'
import { flightPlan, rocketById } from './flightPlan'
import { landingLabel } from './landing'
import { useFlight } from './missionStore'
import { ReliefMap } from './ReliefMap'
import { compass, slopeAround, slopeAt } from './terrainMath'
import styles from './MissionResults.module.css'

// --- shapes of the moon-sky data (it is plain JavaScript, so its types are written out here) ---
type SkySample = { t: number; az: number; el: number }
type SkyWindow = { start: number; end: number; durationMin: number; startKnown: boolean; endKnown: boolean }
type BodySky = {
  az: number
  el: number
  isUp: boolean
  nextRise: number | null
  nextSet: number | null
  minutesToSet: number | null
  minutesToRise: number | null
  fractionUp: number
  windows: SkyWindow[]
}
type SkyAnalysis = {
  at: number
  sun: BodySky | null
  earth: BodySky | null
  both: { isUp: boolean; windows: SkyWindow[]; minutesToEnd: number | null }
}
type Samples = { sun: SkySample[]; earth: SkySample[] }
type MoonSkyResult = {
  loading: boolean
  error: string | null
  retry: () => void
  samples: Samples | null
  analysis: SkyAnalysis | null
}

const SKY_DAYS = 30 // about one lunar day (29.5 Earth days) from just before touchdown
const HOUR = 3_600_000
const CLOCK_STEP_MS = 10 * 60_000 // the mission-clock numbers update every 10 simulated minutes

/** 'MM-DD HH:MM' (UTC): short enough for the narrow side column. */
const fmtShort = (t: number) => new Date(t).toISOString().slice(5, 16).replace('T', ' ')

/** Moves the mission clock (the UTC date in the top bar) and pauses it there. */
function setClock(t: number) {
  const s = useSimStore.getState()
  if (s.isPlaying) s.togglePlay()
  s.setSimTime(t)
}

/** The window the moment `at` is in, else the next one. */
const windowAround = (windows: SkyWindow[], at: number) =>
  windows.find((w) => w.start <= at && at <= w.end) ?? windows.find((w) => w.start > at) ?? null

type ClockRow = { kind: 'sun' | 'earth' | 'both'; name: string; up: boolean; now: string; w: SkyWindow | null }

/** Sun, Earth and both together at the mission clock, with the window it is in (or the next one). */
function clockRows(a: SkyAnalysis): ClockRow[] {
  const rows: ClockRow[] = []
  const body = (kind: 'sun' | 'earth', name: string, b: BodySky | null) => {
    if (b) rows.push({ kind, name, up: b.isUp, now: `${b.isUp ? '▲' : '▼'} ${b.el.toFixed(1)}°`, w: windowAround(b.windows, a.at) })
  }
  body('sun', 'Sun', a.sun)
  body('earth', 'Earth', a.earth)
  if (a.sun && a.earth) {
    rows.push({ kind: 'both', name: 'Both', up: a.both.isUp, now: a.both.isUp ? '✓ yes' : '✗ no', w: windowAround(a.both.windows, a.at) })
  }
  return rows
}

/** Sun and Earth over a landing point, fetched from moon-sky for the range around touchdown. */
function useLandingSky(point: LandingPoint | null, skyStart: number, touchdown: number) {
  return useMoonSky({
    lat: point?.latDeg ?? null,
    lon: point?.lonDeg ?? null,
    altKm: 0,
    start: skyStart,
    days: SKY_DAYS,
    step: '30m',
    at: touchdown,
    mode: 'center',
  }) as unknown as MoonSkyResult
}

/** Sun and Earth at touchdown, in words. */
function skySummary(a: SkyAnalysis) {
  const lines: { kind: 'sun' | 'earth' | 'both'; ok: boolean; text: string }[] = []
  const { sun, earth, both } = a
  if (sun) {
    lines.push(
      sun.isUp
        ? {
            kind: 'sun',
            ok: true,
            text:
              `Daylight at touchdown, Sun ${sun.el.toFixed(1)}° high. ` +
              (sun.minutesToSet !== null
                ? `Solar power for ${formatDuration(sun.minutesToSet)}, until sunset ${fmtUtc(sun.nextSet)}.`
                : `The Sun stays up past the end of the ${SKY_DAYS}-day range.`),
          }
        : {
            kind: 'sun',
            ok: false,
            text:
              `Night at touchdown (Sun ${sun.el.toFixed(1)}°). ` +
              (sun.minutesToRise !== null
                ? `Sunrise in ${formatDuration(sun.minutesToRise)} (${fmtUtc(sun.nextRise)}): batteries must last until then.`
                : `No sunrise within ${SKY_DAYS} days (permanently shadowed?).`),
          },
    )
  }
  if (earth) {
    lines.push(
      earth.isUp
        ? {
            kind: 'earth',
            ok: true,
            text:
              `Earth ${earth.el.toFixed(1)}° above the horizon: direct radio link. ` +
              (earth.minutesToSet !== null ? `It sets in ${formatDuration(earth.minutesToSet)}.` : 'It stays up the whole range.'),
          }
        : {
            kind: 'earth',
            ok: false,
            text:
              'Earth below the horizon: no direct link, a relay satellite is needed. ' +
              (earth.minutesToRise !== null ? `Earth rises in ${formatDuration(earth.minutesToRise)}.` : 'It does not rise within the range (far side).'),
          },
    )
  }
  if (sun && earth) {
    const next = both.windows.find((w) => w.start > a.at)
    lines.push(
      both.isUp
        ? {
            kind: 'both',
            ok: true,
            text:
              'Power and Earth link together ' +
              (both.minutesToEnd !== null ? `for ${formatDuration(both.minutesToEnd)}.` : 'past the end of the range.'),
          }
        : {
            kind: 'both',
            ok: false,
            text: next
              ? `Power and Earth link are not both there at touchdown. Next shared window: ${fmtUtc(next.start)}.`
              : 'Power and Earth link never overlap in this range.',
          },
    )
  }
  return lines
}

type RowProps = {
  point: LandingPoint
  label: string
  active: boolean
  skyStart: number
  touchdown: number
  terrainOk: boolean
  onSelect: () => void
}

/** One landing point in the comparison table (each row asks moon-sky for its own Sun and Earth). */
function LandingRow({ point, label, active, skyStart, touchdown, terrainOk, onSelect }: RowProps) {
  const sky = useLandingSky(point, skyStart, touchdown)
  const slope = useMemo(
    () => (terrainOk ? slopeAt(point.latDeg, point.lonDeg).slopeDeg : null),
    [point, terrainOk],
  )
  const elevation = terrainOk ? moonHeight(point.latDeg, point.lonDeg) : point.elevationM
  const a = sky.analysis
  const waiting = sky.error ? 'error' : '…'

  return (
    <tr className={active ? styles.activeRow : undefined} onClick={onSelect} title="Show this point below">
      <td>{label}</td>
      <td>{point.latDeg.toFixed(2)}°, {point.lonDeg.toFixed(2)}°</td>
      <td>{Math.round(elevation).toLocaleString('en-US')} m</td>
      <td className={slope === null ? undefined : slope > 10 ? styles.bad : styles.good}>
        {slope === null ? '…' : `${slope.toFixed(1)}°`}
      </td>
      <td>
        {a?.sun
          ? a.sun.isUp
            ? `☀ ${a.sun.el.toFixed(0)}° · ${formatDuration(a.sun.minutesToSet)} left`
            : `☾ sunrise in ${formatDuration(a.sun.minutesToRise)}`
          : waiting}
      </td>
      <td>{a?.earth ? (a.earth.isUp ? `✓ ${a.earth.el.toFixed(0)}°` : '✗ below') : waiting}</td>
      <td>{a?.sun ? `${Math.round(a.sun.fractionUp * 100)}%` : waiting}</td>
    </tr>
  )
}

/** Mission results window: opened from the mission panel ("Detail information ▸"). */
export function MissionResults() {
  const open = useSimStore((s) => s.resultsOpen)
  const launchTimeMs = useSimStore((s) => s.launchTimeMs)
  const rocketId = useSimStore((s) => s.rocketId)
  if (!open) return null
  // keyed: a new launch time or rocket starts over with the new touchdown
  return <ResultsWindow key={`${launchTimeMs}:${rocketId}`} onClose={() => useSimStore.getState().setResultsOpen(false)} />
}

function ResultsWindow({ onClose }: { onClose: () => void }) {
  const landingPoints = useSimStore((s) => s.landingPoints)
  const activeLanding = useSimStore((s) => s.activeLandingSlot)
  const missionSites = useSimStore((s) => s.missionSites)
  const rocketId = useSimStore((s) => s.rocketId)
  const launchTimeMs = useSimStore((s) => s.launchTimeMs)
  const { data: lunarSites } = useLunarSites()
  const terrain = useMoonTerrain(true)
  const terrainOk = terrain.phase === 'ready'
  const flight = useFlight() // computed by the mission simulation (mission panel, step 4)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // the landing point shown in detail: the active slot, or the first one that is set
  const focusSlot = landingPoints[activeLanding] ? activeLanding : landingPoints.findIndex((p) => p !== null)
  const point = focusSlot === -1 ? null : landingPoints[focusSlot]

  const rocket = rocketById(rocketId)
  const sites = missionSites.filter((id): id is LaunchSiteId => id !== null).map(siteById)
  const plans = sites.map((site) => ({
    site,
    plan: flightPlan(rocket, site, launchTimeMs, flight),
  }))
  // the Flight card: the computed flight if there is one, else the first site's timeline
  const mainPlan = (plans.find((p) => !p.plan.illustrative) ?? plans[0])?.plan
  const firstArrival = plans.length ? Math.min(...plans.map((p) => p.plan.arrivalMs)) : launchTimeMs
  const lastArrival = plans.length ? Math.max(...plans.map((p) => p.plan.arrivalMs)) : launchTimeMs
  // one fetch covers every site's touchdown: from a day before the first one, for about a lunar day
  const skyStart = Math.floor((firstArrival - 24 * HOUR) / HOUR) * HOUR

  const sky = useLandingSky(point, skyStart, firstArrival)

  // Sun and Earth at the mission clock (the UTC date in the top bar), within the fetched lunar day
  const clockMs = useSimStore((s) => Math.floor(s.simTimeMs / CLOCK_STEP_MS) * CLOCK_STEP_MS)
  const clockInRange = clockMs >= skyStart && clockMs <= skyStart + SKY_DAYS * 24 * HOUR
  const clockSky = useMemo(
    () => (sky.samples && clockInRange ? (analyzeSky(sky.samples, clockMs, { mode: 'center' }) as SkyAnalysis) : null),
    [sky.samples, clockMs, clockInRange],
  )

  // ground at the landing point (the heights load with the map)
  const ground = useMemo(() => {
    if (!point || !terrainOk) return null
    const here = slopeAt(point.latDeg, point.lonDeg)
    const around = slopeAround(point.latDeg, point.lonDeg, 5)
    return { elevationM: moonHeight(point.latDeg, point.lonDeg), ...here, around }
  }, [point, terrainOk])

  if (!point || plans.length === 0) {
    return (
      <section className={styles.window} role="dialog" aria-label="Mission results">
        <header className={styles.header}>
          <h2 className={styles.title}>Mission results</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">×</button>
        </header>
        <p className={styles.empty}>Choose a launch site and a landing point in the mission panel first.</p>
      </section>
    )
  }

  const label = (slot: number) => landingLabel(landingPoints[slot], slot, lunarSites)
  const others = landingPoints.flatMap((p, slot) =>
    p && slot !== focusSlot ? [{ lat: p.latDeg, lon: p.lonDeg, label: label(slot) }] : [],
  )
  // a click on the map moves the landing point shown in detail
  const pickPoint = (lat: number, lon: number) => {
    const s = useSimStore.getState()
    s.setActiveLandingSlot(focusSlot)
    s.setLandingPoint({ latDeg: lat, lonDeg: lon, elevationM: moonHeight(lat, lon), datasetId: terrainDataset(), siteId: null })
  }
  const showInSpace = () => {
    const s = useSimStore.getState()
    if (s.isPlaying) s.togglePlay()
    s.setSimTime(firstArrival)
    s.selectBody('moon')
    onClose()
  }
  const sameArrival = firstArrival === lastArrival

  return (
    <section className={styles.window} role="dialog" aria-label="Mission results">
      <header className={styles.header}>
        <h2 className={styles.title}>
          Mission results
          <span className={styles.subtitle}>
            {label(focusSlot)} · {point.latDeg.toFixed(4)}°, {point.lonDeg.toFixed(4)}°
          </span>
        </h2>
        <button type="button" className={styles.close} onClick={onClose} title="Close (Esc)" aria-label="Close">×</button>
      </header>

      <div className={styles.body}>
        {/* All landing points side by side */}
        <section className={`${styles.card} ${styles.compare}`}>
          <h3 className={styles.cardTitle}>Landing points at touchdown</h3>
          <table className={`${styles.table} ${styles.clickable}`}>
            <thead>
              <tr>
                <th>Point</th>
                <th>Lat, lon</th>
                <th>Elevation</th>
                <th title="Regional slope over ~4 km">Slope</th>
                <th>Sun at touchdown</th>
                <th title="Earth above the horizon = direct radio link">Earth link</th>
                <th title={`Share of the next ${SKY_DAYS} days with the Sun up`}>Sunlit</th>
              </tr>
            </thead>
            <tbody>
              {landingPoints.map((p, slot) =>
                p ? (
                  <LandingRow
                    key={`${slot}:${p.latDeg}:${p.lonDeg}`}
                    point={p}
                    label={label(slot)}
                    active={slot === focusSlot}
                    skyStart={skyStart}
                    touchdown={firstArrival}
                    terrainOk={terrainOk}
                    onSelect={() => useSimStore.getState().setActiveLandingSlot(slot)}
                  />
                ) : null,
              )}
            </tbody>
          </table>
          <p className={styles.note}>
            Add more points with ＋ in the mission panel (step 3). Click a row to look at it in detail below.
          </p>
        </section>

        {/* Landing area of the point in detail: map + ground numbers */}
        <section className={`${styles.card} ${styles.area}`}>
          <h3 className={styles.cardTitle}>Landing area · {label(focusSlot)}</h3>
          <ReliefMap
            key={focusSlot}
            lat={point.latDeg}
            lon={point.lonDeg}
            others={others}
            sites={lunarSites}
            onPick={pickPoint}
          />
          {ground ? (
            <dl className={styles.facts}>
              <dt>Elevation</dt>
              <dd>{Math.round(ground.elevationM).toLocaleString('en-US')} m</dd>
              <dt>Slope here</dt>
              <dd className={ground.slopeDeg > 10 ? styles.bad : styles.good}>
                {ground.slopeDeg.toFixed(1)}° facing {compass(ground.aspectDeg)}
              </dd>
              <dt>Within 5 km</dt>
              <dd>
                mean {ground.around.meanDeg.toFixed(1)}°, steepest {ground.around.maxDeg.toFixed(1)}°
              </dd>
            </dl>
          ) : (
            <p className={styles.muted}>Loading Moon terrain…</p>
          )}
          <p className={styles.note}>
            Slopes over ~4 km from the LOLA grid (~1.9 km cells): boulders and small craters are smaller than that.
            Apollo's lander tolerated about 12° of tilt.
          </p>
        </section>

        <div className={styles.side}>
          {/* Flight */}
          <section className={styles.card}>
            <h3 className={styles.cardTitle}>
              Flight
              {mainPlan.illustrative && <span className={styles.badge}>illustrative</span>}
            </h3>
            <dl className={styles.facts}>
              <dt>Rocket</dt>
              <dd>{rocket.name}</dd>
              <dt>Launch</dt>
              <dd>{fmtUtc(mainPlan.launchMs)}</dd>
              <dt>To touchdown</dt>
              <dd>{formatDuration(Math.round(mainPlan.transitH * 60))}</dd>
              <dt>Touchdown</dt>
              <dd>{sameArrival ? fmtUtc(firstArrival) : `${fmtUtc(firstArrival)} – ${fmtUtc(lastArrival)}`}</dd>
            </dl>
            <p className={styles.note}>{mainPlan.method}</p>
            <button type="button" className={styles.button} onClick={showInSpace}>
              Show touchdown in space view ▸
            </button>
          </section>

          {/* Power and comms: at touchdown, and at the mission clock over the next lunar day */}
          <section className={styles.card}>
            <h3 className={styles.cardTitle}>Power &amp; comms</h3>
            <h4 className={styles.subTitle}>At touchdown · {fmtUtc(firstArrival)}</h4>
            {sky.error && (
              <p className={styles.error}>
                {sky.error}{' '}
                <button type="button" className={styles.button} onClick={sky.retry}>Retry</button>
              </p>
            )}
            {!sky.error && !sky.analysis && <p className={styles.muted}>{sky.loading ? 'Asking JPL Horizons…' : 'No data'}</p>}
            {sky.analysis && (
              <ul className={styles.summary}>
                {skySummary(sky.analysis).map((l) => (
                  <li key={l.kind} className={`${styles[l.kind]} ${l.ok ? styles.okLine : styles.warnLine}`}>
                    {l.text}
                  </li>
                ))}
              </ul>
            )}

            <h4 className={styles.subTitle}>At the mission clock · {fmtUtc(clockMs)}</h4>
            {!clockInRange ? (
              <p className={styles.muted}>The clock is outside the {SKY_DAYS} days after touchdown.</p>
            ) : clockSky ? (
              <table className={`${styles.table} ${styles.clickable}`}>
                <thead>
                  <tr>
                    <th />
                    <th>Now</th>
                    <th title="The window the clock is in, else the next one">Above horizon</th>
                    <th>Length</th>
                  </tr>
                </thead>
                <tbody>
                  {clockRows(clockSky).map((r) => (
                    <tr
                      key={r.kind}
                      className={r.up ? styles.activeRow : undefined}
                      title={r.w ? 'Move the mission clock to the start of this window' : undefined}
                      onClick={() => r.w && setClock(r.w.start)}
                    >
                      <td className={styles[r.kind]}>{r.name}</td>
                      <td>{r.now}</td>
                      <td>
                        {r.w
                          ? `${r.w.startKnown ? fmtShort(r.w.start) : 'before'} → ${r.w.endKnown ? fmtShort(r.w.end) : 'after'}`
                          : 'none in range'}
                      </td>
                      <td>{r.w ? (r.w.startKnown && r.w.endKnown ? '' : '≥ ') + formatDuration(r.w.durationMin) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className={styles.muted}>{sky.loading ? 'Asking JPL Horizons…' : 'No data'}</p>
            )}
            <button type="button" className={styles.button} onClick={() => setClock(firstArrival)}>
              Clock to touchdown
            </button>
          </section>
        </div>

      </div>
    </section>
  )
}
