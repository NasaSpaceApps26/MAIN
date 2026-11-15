// Ranking of landing site × launch site pairs by power and communications over the Lunar Sky range.
//  power: the Sun above the landing site's horizon (solar panels), and the longest night (batteries)
//  comms: Earth above the landing site's horizon, and – as Earth turns – the Moon above the launch
//         site's horizon: only both together give a straight line between the two sites. Earth in
//         the sky but the launch site turned away = a relay satellite in Earth orbit is needed.
import { moonPosition } from '../launchSites/sky/astro';
import { threshold } from './analysis.js';

const HOUR = 3_600_000;

/** Moon above the launch site's horizon at each time (the same times for every landing site). */
function moonUpAt(times, station) {
  return times.map((t) => moonPosition(t, station.lat, station.lon).el >= 0);
}

/** Share of samples where `ok(i)` holds, and the longest run (ms) where it does not. */
function stats(times, ok) {
  let count = 0, longest = 0, runStart = null;
  for (let i = 0; i < times.length; i++) {
    if (ok(i)) {
      count++;
      if (runStart !== null) { longest = Math.max(longest, times[i] - runStart); runStart = null; }
    } else if (runStart === null) runStart = times[i];
  }
  if (runStart !== null) longest = Math.max(longest, times[times.length - 1] - runStart);
  return { share: times.length ? count / times.length : 0, longestGapH: longest / HOUR };
}

/**
 * points:   [{ key, label, samples: { sun, earth } }] – landing sites with their Sun/Earth samples
 * stations: [{ id, name, lat, lon }]                  – launch sites (ground stations)
 * Returns one row per pair, best first: most time with BOTH sunlight and a direct line, then most
 * time with a direct line, then most sunlight, then the shortest night.
 */
export function rankPairs(points, stations, mode = 'center') {
  const thrSun = threshold('sun', mode), thrEarth = threshold('earth', mode);
  const moonUpCache = new Map(); // station + times → Moon above its horizon
  const rows = [];
  for (const pt of points) {
    const { sun, earth } = pt.samples;
    const n = Math.min(sun.length, earth.length);
    if (!n) continue;
    const times = earth.slice(0, n).map((s) => s.t);
    const sunUp = (i) => sun[i].el >= thrSun;
    const earthUp = (i) => earth[i].el >= thrEarth;
    const power = stats(times, sunUp);
    const earthSky = stats(times, earthUp);
    for (const st of stations) {
      const cacheKey = `${st.id}:${times[0]}:${times[n - 1]}:${n}`;
      if (!moonUpCache.has(cacheKey)) moonUpCache.set(cacheKey, moonUpAt(times, st));
      const moonUp = moonUpCache.get(cacheKey);
      const direct = (i) => earthUp(i) && moonUp[i];
      const link = stats(times, direct);
      const relay = stats(times, (i) => earthUp(i) && !moonUp[i]);
      const both = stats(times, (i) => sunUp(i) && direct(i));
      rows.push({
        key: `${pt.key}|${st.id}`,
        point: pt,
        station: st,
        sunlit: power.share,
        longestNightH: power.longestGapH,
        earthInSky: earthSky.share,
        direct: link.share,
        relay: relay.share,
        longestNoLinkH: link.longestGapH,
        sunAndDirect: both.share,
      });
    }
  }
  return rows.sort((a, b) =>
    b.sunAndDirect - a.sunAndDirect || b.direct - a.direct || b.sunlit - a.sunlit || a.longestNightH - b.longestNightH);
}
