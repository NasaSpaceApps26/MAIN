// Copy of moon-sky/lib/analysis.js (the frontend Docker build context only sees frontend/).
// Keep both files in sync when changing the calculations.
// Pure computation logic – no dependencies, runs in Node and in the browser (React).
// Input: sample arrays [{ t: ms, az: deg, el: deg }] sorted by time.

const MIN = 60_000;

/** Angular radius of the disc as seen from the Moon [deg] – used for the "upper limb" threshold. */
export const ANGULAR_RADIUS = { sun: 0.267, earth: 0.95 };

/**
 * Elevation threshold treated as "above the horizon".
 *  'center' – disc centre at 0°
 *  'limb'   – upper limb of the disc at 0° (earlier rise / later set)
 *  number   – custom threshold, e.g. 5 (terrain/antenna mask)
 */
export function threshold(body, mode = 'center') {
  if (typeof mode === 'number') return mode;
  return mode === 'limb' ? -ANGULAR_RADIUS[body] : 0;
}

const lerp = (a, b, f) => a + (b - a) * f;

function lerpAngle(a, b, f) {
  let d = ((b - a + 540) % 360) - 180; // shortest path across 0/360
  return (a + d * f + 360) % 360;
}

/** Index of the last sample with t <= tMs (binary search). */
function indexAt(samples, tMs) {
  let lo = 0, hi = samples.length - 1;
  if (tMs <= samples[0].t) return 0;
  if (tMs >= samples[hi].t) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= tMs) lo = mid; else hi = mid;
  }
  return lo;
}

/** Position at any moment (linear interpolation). */
export function positionAt(samples, tMs) {
  if (!samples.length) return null;
  const i = indexAt(samples, tMs);
  const a = samples[i], b = samples[Math.min(i + 1, samples.length - 1)];
  if (a === b || b.t === a.t) return { t: tMs, az: a.az, el: a.el };
  const f = Math.min(Math.max((tMs - a.t) / (b.t - a.t), 0), 1);
  return { t: tMs, az: lerpAngle(a.az, b.az, f), el: lerp(a.el, b.el, f) };
}

/** Moments when the elevation crosses the threshold: [{ t, type: 'rise'|'set' }] */
export function findCrossings(samples, thr = 0) {
  const out = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i];
    const da = a.el - thr, db = b.el - thr;
    if ((da < 0 && db >= 0) || (da >= 0 && db < 0)) {
      const f = da / (da - db);
      out.push({ t: Math.round(lerp(a.t, b.t, f)), type: db >= 0 ? 'rise' : 'set' });
    }
  }
  return out;
}

/**
 * Visibility windows (body above the threshold).
 * startKnown/endKnown = false when the window is cut off by the edges of the data range.
 */
export function visibilityWindows(samples, thr = 0) {
  if (!samples.length) return [];
  const crossings = findCrossings(samples, thr);
  const windows = [];
  let open = samples[0].el >= thr ? { start: samples[0].t, startKnown: false } : null;
  for (const c of crossings) {
    if (c.type === 'rise') open = { start: c.t, startKnown: true };
    else if (open) { windows.push({ ...open, end: c.t, endKnown: true }); open = null; }
  }
  if (open) windows.push({ ...open, end: samples[samples.length - 1].t, endKnown: false });
  return windows.map((w) => ({ ...w, durationMin: Math.round((w.end - w.start) / MIN) }));
}

/** Intersection of two window lists (e.g. Sun ∩ Earth). */
export function intersectWindows(a, b) {
  const out = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i].start, b[j].start);
    const end = Math.min(a[i].end, b[j].end);
    if (end > start) {
      out.push({
        start, end,
        startKnown: start === a[i].start ? a[i].startKnown : b[j].startKnown,
        endKnown: end === a[i].end ? a[i].endKnown : b[j].endKnown,
        durationMin: Math.round((end - start) / MIN),
      });
    }
    if (a[i].end < b[j].end) i++; else j++;
  }
  return out;
}

function maxElevationIn(samples, start, end) {
  let best = null;
  for (const s of samples) {
    if (s.t < start || s.t > end) continue;
    if (!best || s.el > best.el) best = s;
  }
  return best;
}

/** Full analysis of one body at moment atMs. */
export function analyzeBody(samples, atMs, thr = 0) {
  if (!samples?.length) return null;
  const pos = positionAt(samples, atMs);
  const crossings = findCrossings(samples, thr);
  const windows = visibilityWindows(samples, thr);
  const rangeStart = samples[0].t, rangeEnd = samples[samples.length - 1].t;

  const nextRise = crossings.find((c) => c.type === 'rise' && c.t > atMs)?.t ?? null;
  const nextSet = crossings.find((c) => c.type === 'set' && c.t > atMs)?.t ?? null;
  const prevRise = [...crossings].reverse().find((c) => c.type === 'rise' && c.t <= atMs)?.t ?? null;
  const prevSet = [...crossings].reverse().find((c) => c.type === 'set' && c.t <= atMs)?.t ?? null;

  const isUp = pos.el >= thr;
  const currentWindow = isUp ? windows.find((w) => w.start <= atMs && atMs <= w.end) ?? null : null;
  const upMin = windows.reduce((s, w) => s + w.durationMin, 0);
  const peak = currentWindow ? maxElevationIn(samples, currentWindow.start, currentWindow.end) : null;

  return {
    az: pos.az,
    el: pos.el,
    isUp,
    threshold: thr,
    nextRise,
    nextSet,
    prevRise,
    prevSet,
    // null = the event does not occur within the fetched range
    minutesToSet: isUp && nextSet ? Math.round((nextSet - atMs) / MIN) : null,
    minutesToRise: !isUp && nextRise ? Math.round((nextRise - atMs) / MIN) : null,
    currentWindow,
    currentPeak: peak ? { t: peak.t, el: peak.el, az: peak.az } : null,
    windows,
    fractionUp: (upMin * MIN) / Math.max(rangeEnd - rangeStart, 1),
    range: { start: rangeStart, end: rangeEnd },
  };
}

/**
 * Main entry point: sky analysis at moment atMs.
 * sky = { sun: samples[], earth: samples[] }
 * opts.mode = 'center' | 'limb' | number (threshold in degrees)
 */
export function analyzeSky(sky, atMs, opts = {}) {
  const mode = opts.mode ?? 'center';
  const sun = analyzeBody(sky.sun, atMs, threshold('sun', mode));
  const earth = analyzeBody(sky.earth, atMs, threshold('earth', mode));
  const bothWindows = sun && earth ? intersectWindows(sun.windows, earth.windows) : [];
  const currentBoth = bothWindows.find((w) => w.start <= atMs && atMs <= w.end) ?? null;
  return {
    at: atMs,
    sun,
    earth,
    both: {
      isUp: !!currentBoth,
      windows: bothWindows,
      minutesToEnd: currentBoth?.endKnown ? Math.round((currentBoth.end - atMs) / MIN) : null,
    },
  };
}

/** UI helper: 1234 min -> "20 h 34 min", 4000 min -> "2 d 18 h". */
export function formatDuration(minutes) {
  if (minutes == null) return '—';
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}
