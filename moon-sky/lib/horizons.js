// JPL Horizons client: fetches azimuth/elevation of a body (Sun, Earth)
// as seen from a point on the Moon's surface.
// Works in Node 18+ (global fetch). Do NOT call it directly from the browser
// (Horizons doesn't send CORS headers) – go through server.js.

export const HORIZONS_URL = 'https://ssd.jpl.nasa.gov/api/horizons.api';

export const BODIES = {
  sun: '10',
  earth: '399',
};

const MONTHS = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

/** Date | string | number -> 'YYYY-MM-DD HH:MM' (UTC), the format Horizons accepts */
export function toHorizonsTime(d) {
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${d}`);
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())} ` +
    `${p(date.getUTCHours())}:${p(date.getUTCMinutes())}`;
}

/**
 * Builds the query URL.
 * lat  – selenographic latitude [deg], + = north
 * lon  – longitude [deg], + = east (give western longitudes as negative)
 * altKm – altitude above the reference sphere [km]
 * step – e.g. '10m', '30m', '1h'
 */
export function buildHorizonsUrl({ body, lat, lon, altKm = 0, start, stop, step = '10m' }) {
  const params = {
    format: 'json',
    COMMAND: body,
    OBJ_DATA: 'NO',
    MAKE_EPHEM: 'YES',
    EPHEM_TYPE: 'OBSERVER',
    CENTER: 'coord@301',          // 301 = Moon
    COORD_TYPE: 'GEODETIC',
    SITE_COORD: `${lon},${lat},${altKm}`, // E-lon, lat, alt(km)
    START_TIME: toHorizonsTime(start),
    STOP_TIME: toHorizonsTime(stop),
    STEP_SIZE: step,
    QUANTITIES: '4',              // azimuth + elevation
    ANG_FORMAT: 'DEG',
    CSV_FORMAT: 'YES',
    TIME_DIGITS: 'MINUTES',
    APPARENT: 'AIRLESS',          // no atmosphere
  };
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(k === 'format' ? v : `'${v}'`)}`)
    .join('&');
  return `${HORIZONS_URL}?${qs}`;
}

/** '2026-Nov-14 00:10' -> ms (UTC) */
export function parseHorizonsDate(s) {
  const m = s.match(/(\d{4})-([A-Za-z]{3})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?/);
  if (!m) return NaN;
  const [, y, mon, d, h, mi, sec] = m;
  const ms = Date.UTC(+y, MONTHS[mon], +d, +h, +mi, 0);
  return ms + (sec ? Math.round(parseFloat(sec) * 1000) : 0);
}

/**
 * Parses the "result" field of a Horizons response (CSV between $$SOE and $$EOE).
 * Returns [{ t: ms, az: deg, el: deg }]
 */
export function parseHorizonsResult(text) {
  const lines = text.split(/\r?\n/);
  const soe = lines.findIndex((l) => l.trim() === '$$SOE');
  const eoe = lines.findIndex((l) => l.trim() === '$$EOE');
  if (soe < 0 || eoe < 0) {
    const snippet = text.slice(0, 800);
    throw new Error(`Horizons returned no ephemeris. Response:\n${snippet}`);
  }

  // Column header = last non-empty line before $$SOE that isn't "*****"
  let header = null;
  for (let i = soe - 1; i >= 0; i--) {
    const l = lines[i].trim();
    if (!l || /^\*+$/.test(l)) continue;
    header = l.split(',').map((s) => s.trim());
    break;
  }
  let azIdx = header ? header.findIndex((h) => /^Azi/i.test(h)) : -1;
  let elIdx = header ? header.findIndex((h) => /^Elev/i.test(h)) : -1;

  const samples = [];
  for (let i = soe + 1; i < eoe; i++) {
    const cols = lines[i].split(',').map((s) => s.trim());
    const t = parseHorizonsDate(cols[0]);
    if (Number.isNaN(t)) continue;

    let az, el;
    if (azIdx >= 0 && elIdx >= 0) {
      az = parseFloat(cols[azIdx]);
      el = parseFloat(cols[elIdx]);
    } else {
      // fallback: the last two numbers in the row
      const nums = cols.slice(1).map(parseFloat).filter((x) => !Number.isNaN(x));
      [az, el] = nums.slice(-2);
    }
    if (Number.isFinite(az) && Number.isFinite(el)) samples.push({ t, az, el });
  }
  return samples;
}

/** Fetches samples for a single body. */
export async function fetchBodySamples(opts, { fetchImpl = fetch } = {}) {
  const url = buildHorizonsUrl(opts);
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Horizons HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`Horizons: ${json.error}`);
  return parseHorizonsResult(json.result);
}

/** Fetches the Sun and the Earth in parallel. */
export async function fetchSky({ lat, lon, altKm = 0, start, stop, step = '10m' }, deps) {
  const base = { lat, lon, altKm, start, stop, step };
  const [sun, earth] = await Promise.all([
    fetchBodySamples({ ...base, body: BODIES.sun }, deps),
    fetchBodySamples({ ...base, body: BODIES.earth }, deps),
  ]);
  return { sun, earth };
}
