// Radio link between the landing site on the Moon and the launch site on Earth (the mission's
// ground station). A straight line needs BOTH: Earth above the landing site's horizon, and the Moon
// above the launch site's horizon. Earth turns once a day, so for about half of every day the launch
// site faces away from the Moon: then the signal must go through a relay satellite in Earth orbit.
import { moonPosition } from '../launchSites/sky/astro';
import { threshold } from './analysis.js';

/**
 * Link state at each moment:
 *  'direct' – straight line from the launch site to the landing site
 *  'relay'  – Earth is in the lunar sky, but the launch site is on the far side of Earth: a relay
 *             satellite in Earth orbit is needed
 *  'none'   – Earth is below the landing site's horizon: no link to Earth (lunar relay needed)
 */
export const LINK_LABEL = {
  direct: 'direct line from the launch site',
  relay: 'relay satellite in Earth orbit needed',
  none: 'Earth below the horizon (lunar relay needed)',
};

/**
 * The link over the whole range as segments [{ state, start, end }], from the lunar samples (Earth's
 * elevation at the landing site) and the Moon's elevation at the launch site at the same moments.
 */
export function linkSegments(earthSamples, station, mode = 'center') {
  const thr = threshold('earth', mode);
  const out = [];
  for (const s of earthSamples) {
    const state = s.el < thr ? 'none' : moonPosition(s.t, station.lat, station.lon).el >= 0 ? 'direct' : 'relay';
    const last = out[out.length - 1];
    if (last) last.end = s.t;
    if (!last || last.state !== state) out.push({ state, start: s.t, end: s.t });
  }
  return out;
}

/**
 * The link at moment `at`: its state, the Moon's elevation seen from the launch site, when the
 * current state ends and when the next direct line starts (null = not within the range).
 */
export function linkAt(segments, station, at) {
  if (!segments.length) return null;
  let i = segments.findIndex((s) => s.start <= at && at < s.end);
  if (i < 0) i = at < segments[0].start ? 0 : segments.length - 1;
  const seg = segments[i];
  const last = i === segments.length - 1;
  const nextDirect = segments.find((s) => s.state === 'direct' && s.start > at) ?? null;
  return {
    station,
    state: seg.state,
    moonEl: moonPosition(at, station.lat, station.lon).el,
    endsAt: last ? null : seg.end,
    nextDirect: nextDirect?.start ?? null,
  };
}
