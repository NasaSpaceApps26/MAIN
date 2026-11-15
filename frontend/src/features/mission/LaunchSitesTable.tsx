import { useSimStore } from '../../store/simStore'
import { siteById, type LaunchSiteId } from '../launchSites/sites'
import { analyzeSky } from '../moonSky/analysis.js'
import { fmtUtc } from '../moonSky/format.js'
import { flightPlan, rocketById, siteFactors } from './flightPlan'

type SkySample = { t: number; az: number; el: number }
type Samples = { sun: SkySample[]; earth: SkySample[] }
type SunAt = { sun: { isUp: boolean; el: number } | null }

/**
 * The mission's launch sites side by side: free speed from Earth's spin, lowest inclination, when
 * the flight from each touches down (launching at the mission clock's time) and the Sun at the
 * landing site then (`samples`: Sun and Earth over the landing site, from moon-sky). A click on a
 * row moves the mission clock to that touchdown.
 */
export function LaunchSitesTable({ samples }: { samples: Samples | null }) {
  const missionSites = useSimStore((s) => s.missionSites)
  const rocketId = useSimStore((s) => s.rocketId)
  const launchTimeMs = useSimStore((s) => s.launchTimeMs)
  const rocket = rocketById(rocketId)
  const sites = missionSites.filter((id): id is LaunchSiteId => id !== null).map(siteById)

  if (sites.length === 0) {
    return <p className="muted">Choose a launch site in the mission panel (click a red dot on Earth).</p>
  }

  const first = samples?.sun[0]?.t ?? Infinity
  const last = samples?.sun.at(-1)?.t ?? -Infinity
  const toTouchdown = (t: number) => {
    const s = useSimStore.getState()
    if (s.isPlaying) s.togglePlay()
    s.setSimTime(t)
  }

  return (
    <>
      <table className="sites-table">
        <thead>
          <tr>
            <th>Site</th>
            <th title="Free speed from Earth's spin for a due-east launch">Spin boost</th>
            <th title="Lowest orbit inclination without a plane change">Min. incl.</th>
            <th>Touchdown</th>
            <th>Sun</th>
          </tr>
        </thead>
        <tbody>
          {sites.map((site) => {
            const plan = flightPlan(rocket, site, launchTimeMs)
            const factors = siteFactors(site)
            const t = plan.arrivalMs
            const a = samples && t >= first && t <= last ? (analyzeSky(samples, t, { mode: 'center' }) as SunAt) : null
            return (
              <tr key={site.id} onClick={() => toTouchdown(t)} title="Move the mission clock to this touchdown">
                <td>{site.name}</td>
                <td>{Math.round(factors.rotationBoostMs)} m/s</td>
                <td>{factors.minInclinationDeg.toFixed(1)}°</td>
                <td>{fmtUtc(t)}</td>
                <td>{a?.sun ? (a.sun.isUp ? `☀ ${a.sun.el.toFixed(0)}°` : '☾ night') : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </>
  )
}
