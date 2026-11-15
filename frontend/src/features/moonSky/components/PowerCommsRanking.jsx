import { useMemo } from 'react';
import { useLunarSites } from '../../../api/hooks';
import { useSimStore } from '../../../store/simStore';
import { LAUNCH_SITES } from '../../launchSites/sites';
import { landingLabel } from '../../mission/landing';
import { formatDuration } from '../analysis.js';
import { fmtUtc } from '../format.js';
import { rankPairs } from '../ranking.js';
import { useSkyForPoints } from '../useMoonSky.js';

const pct = (x) => `${Math.round(x * 100)}%`;
const hours = (h) => formatDuration(Math.round(h * 60));
const same = (a, b) => Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lon - b.lon) < 1e-4;

/** good / mid / bad colour for a share (more is better) or a duration in hours (less is better). */
const tone = (v, good, mid, more = true) =>
  (more ? v >= good : v <= good) ? 'good' : (more ? v >= mid : v <= mid) ? 'mid' : 'bad';

/**
 * Every landing site of the mission (plus the point shown in Lunar Sky) with every launch site,
 * ranked by power and communications over the Lunar Sky range. A click on a row shows that landing
 * site in Lunar Sky.
 *  p        – the Lunar Sky settings (point, range, step, rise/set mode)
 *  pointName – name of the Lunar Sky point
 *  station  – the launch site Lunar Sky uses now (highlighted)
 */
export default function PowerCommsRanking({ p, pointName, station, onPick }) {
  const landingPoints = useSimStore((s) => s.landingPoints);
  const missionSites = useSimStore((s) => s.missionSites);
  const { data: lunarSites } = useLunarSites();
  const startMs = Date.parse(p.start + ':00Z');
  const mode = p.mode === 'custom' ? p.thr : p.mode;

  // the mission's landing points, and the Lunar Sky point if it is not one of them
  const points = useMemo(() => {
    const list = landingPoints.flatMap((pt, slot) =>
      pt ? [{ key: `slot${slot}`, label: landingLabel(pt, slot, lunarSites), lat: pt.latDeg, lon: pt.lonDeg }] : []);
    if (!list.some((pt) => same(pt, p))) list.push({ key: 'lunar-sky', label: pointName, lat: p.lat, lon: p.lon });
    return list;
  }, [landingPoints, lunarSites, p, pointName]);

  const { byKey, pending, failed } = useSkyForPoints(points, { start: startMs, days: p.days, step: p.step });

  const rows = useMemo(() => {
    const withData = points.filter((pt) => byKey[pt.key]).map((pt) => ({ ...pt, samples: byKey[pt.key] }));
    return rankPairs(withData, LAUNCH_SITES, mode);
  }, [points, byKey, mode]);

  const endMs = startMs + p.days * 86_400_000;

  return (
    <div className="ranking">
      <p className="muted small top">
        {fmtUtc(startMs)} → {fmtUtc(endMs)} ({p.days} {p.days === 1 ? 'day' : 'days'}). Best first: most time with
        sunlight <b>and</b> a direct line to the launch site.
        {pending > 0 && <span className="loading"> · Loading {pending} landing site{pending > 1 ? 's' : ''}…</span>}
        {failed > 0 && pending > 0 && <span className="err"> · {failed} could not be loaded (moon-sky server?)</span>}
      </p>
      {rows.length > 0 && (
        <div className="table-scroll">
          <table className="sites-table rank-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Landing site</th>
                <th>Launch site</th>
                <th title="Share of the range with the Sun up AND a straight line to the launch site">Sun + direct link</th>
                <th title="Share of the range with the Sun above the landing site's horizon (solar power)">Sunlit</th>
                <th title="Longest stretch without the Sun: how long the batteries must last">Longest night</th>
                <th title="Share of the range with Earth above the landing site's horizon">Earth in sky</th>
                <th title="Earth in the sky AND the Moon above the launch site's horizon (Earth's rotation counted)">Direct link</th>
                <th title="Earth in the sky but the launch site turned away: a relay satellite in Earth orbit is needed">Relay in Earth orbit</th>
                <th title="Longest stretch without a straight line to the launch site">Longest without link</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const active = same(r.point, p) && r.station.name === station?.name;
                const inMission = missionSites.includes(r.station.id);
                return (
                  <tr key={r.key} className={active ? 'active' : undefined}
                    onClick={() => onPick({ lat: r.point.lat, lon: r.point.lon })}
                    title="Show this landing site in Lunar Sky">
                    <td>{i + 1}</td>
                    <td>{r.point.label}</td>
                    <td>{r.station.name}{inMission && <span className="tag" title="In the mission panel">mission</span>}</td>
                    <td className={tone(r.sunAndDirect, 0.3, 0.15)}><b>{pct(r.sunAndDirect)}</b></td>
                    <td className={tone(r.sunlit, 0.5, 0.3)}>{pct(r.sunlit)}</td>
                    <td className={tone(r.longestNightH, 48, 240, false)}>{hours(r.longestNightH)}</td>
                    <td className={tone(r.earthInSky, 0.9, 0.4)}>{pct(r.earthInSky)}</td>
                    <td className={tone(r.direct, 0.45, 0.2)}>{pct(r.direct)}</td>
                    <td className={r.relay > 0 ? 'mid' : 'good'}>{pct(r.relay)}</td>
                    <td className={tone(r.longestNoLinkH, 16, 72, false)}>{hours(r.longestNoLinkH)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
