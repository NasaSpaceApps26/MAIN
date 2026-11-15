import { useMemo } from 'react';
import { useLunarSites } from '../../../api/hooks';
import { moonHeight } from '../../../components/SolarSystem/EarthMoon/moonTerrain';
import { useSimStore } from '../../../store/simStore';
import { PRIMARY_SLOT, landingLabel } from '../../mission/landing';
import { formatDuration } from '../analysis.js';
import { fmtUtc } from '../format.js';
import { rankPairs } from '../ranking.js';
import { useSkyForPoints } from '../useMoonSky.js';

const MOON_RADIUS_KM = 1737.4;
const DEG = Math.PI / 180;

const pct = (x) => `${Math.round(x * 100)}%`;
const hours = (h) => formatDuration(Math.round(h * 60));

/** good / mid / bad colour for a share (more is better) or a duration in hours (less is better). */
const tone = (v, good, mid, more = true) =>
  (more ? v >= good : v <= good) ? 'good' : (more ? v >= mid : v <= mid) ? 'mid' : 'bad';

/** Great-circle distance between two points on the Moon, km. */
function kmOnMoon(a, b) {
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * MOON_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Height with its sign: "+1,250 m" above, "−1,238 m" below the Moon's reference sphere (radius
 * 1737.4 km, the zero of the LOLA heights). The maria are low (−), the highlands high (+).
 */
function signedHeight(m) {
  const v = Math.round(m);
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('en-US')} m`;
}

/**
 * The mission's landings side by side: the primary one (A, where the rocket flies) and the
 * alternatives (B, C…, picked in the mission panel), ranked by the same power and comms numbers as
 * the ranking above, over the same Lunar Sky range, for the link to the mission's launch site.
 * Only Sun and Earth data are fetched here; an alternative's site model and photo load only when it
 * is shown in the Sky card at the top (its A–D buttons).
 *  p       – the Lunar Sky settings (range, step, rise/set mode)
 *  station – the launch site whose ground station talks to the lander (as in the Data card)
 */
export default function LandingComparison({ p, station }) {
  const landingPoints = useSimStore((s) => s.landingPoints);
  const { data: lunarSites } = useLunarSites();
  const startMs = Date.parse(p.start + ':00Z');
  const endMs = startMs + p.days * 86_400_000;
  const mode = p.mode === 'custom' ? p.thr : p.mode;

  const points = useMemo(() => landingPoints.flatMap((pt, slot) => (pt ? [{
    key: `slot${slot}`,
    slot,
    label: landingLabel(pt, slot, lunarSites),
    lat: pt.latDeg,
    lon: pt.lonDeg,
    elevationM: pt.elevationM,
  }] : [])), [landingPoints, lunarSites]);

  const { byKey, pending, failed } = useSkyForPoints(points, { start: startMs, days: p.days, step: p.step });

  const rows = useMemo(() => {
    if (!station) return [];
    const withData = points.filter((pt) => byKey[pt.key]).map((pt) => ({ ...pt, samples: byKey[pt.key] }));
    return rankPairs(withData, [{ id: station.name, ...station }], mode);
  }, [points, byKey, station, mode]);

  const primary = points.find((pt) => pt.slot === PRIMARY_SLOT) ?? null;
  const alternatives = points.length - (primary ? 1 : 0);

  return (
    <div className="ranking">
      <p className="muted small top">
        {fmtUtc(startMs)} → {fmtUtc(endMs)} ({p.days} {p.days === 1 ? 'day' : 'days'}), link to{' '}
        <b>{station?.name ?? 'the launch site'}</b>. Best first: most time with sunlight <b>and</b> a direct line.
        {pending > 0 && <span className="loading"> · Loading {pending} landing{pending > 1 ? 's' : ''}…</span>}
        {failed > 0 && pending > 0 && <span className="err"> · {failed} could not be loaded (moon-sky server?)</span>}
      </p>
      {alternatives === 0 && (
        <p className="muted small top">
          Add alternative landings (B, C…) with ＋ in the mission panel (step 3) and pick them on the Moon: they
          are compared with landing A here. No rocket flies to them.
        </p>
      )}
      {rows.length > 0 && (
        <div className="table-scroll">
          <table className="sites-table rank-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Landing</th>
                <th title="Great-circle distance from landing A">From A</th>
                <th title="Height above (+) or below (−) the Moon's mean radius of 1,737.4 km (the zero of the LOLA heights): the maria lie low (−), the highlands high (+)">Height</th>
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
                const pt = r.point;
                const isA = pt.slot === PRIMARY_SLOT;
                const elevation = moonHeight(pt.lat, pt.lon) || pt.elevationM;
                return (
                  <tr key={pt.key} className={isA ? 'active' : undefined}
                    onClick={() => useSimStore.getState().setActiveLandingSlot(pt.slot)}
                    title="Highlight this landing in the mission panel (to move it)">
                    <td>{i + 1}</td>
                    <td>{pt.label}{isA && <span className="tag" title="The rocket flies here">primary</span>}</td>
                    <td>{isA || !primary ? '—' : `${Math.round(kmOnMoon(primary, pt)).toLocaleString('en-US')} km`}</td>
                    <td>{Number.isFinite(elevation) ? signedHeight(elevation) : '—'}</td>
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
