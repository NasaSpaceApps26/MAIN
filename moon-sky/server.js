// Small API server (zero dependencies) – a proxy between the React frontend and JPL Horizons.
// Run: node server.js   (default port 3001)
//
// GET /api/sites
// GET /api/sky?lat=0.6741&lon=23.473&start=2026-11-14T00:00Z&days=30&step=10m&at=2026-11-20T12:00Z&mode=center
//     or     ?site=apollo11&start=...

import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fetchSky } from './lib/horizons.js';
import { analyzeSky } from './lib/analysis.js';

const PORT = process.env.PORT || 3001;
const SITES = JSON.parse(readFileSync(new URL('./lib/sites.json', import.meta.url)));
const MAX_ROWS = 50_000;          // Horizons limit is ~90k lines, keep a safety margin
const CACHE_TTL = 6 * 3600_000;   // ephemerides don't change – cache for 6 h
const cache = new Map();

function stepToMinutes(step) {
  const m = String(step).trim().match(/^(\d+)\s*([mhd])$/i);
  if (!m) return null;
  return +m[1] * { m: 1, h: 60, d: 1440 }[m[2].toLowerCase()];
}

function send(res, code, body) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(body));
}

async function handleSky(q) {
  let lat = parseFloat(q.get('lat'));
  let lon = parseFloat(q.get('lon'));
  const siteId = q.get('site');
  if (siteId) {
    const s = SITES.find((x) => x.id === siteId);
    if (!s) throw Object.assign(new Error(`Unknown site: ${siteId}`), { code: 404 });
    ({ lat, lon } = s);
  }
  const altKm = parseFloat(q.get('alt') ?? '0') || 0;
  const step = q.get('step') ?? '10m';
  const days = parseFloat(q.get('days') ?? '30');
  const start = new Date(q.get('start') ?? Date.now());
  start.setUTCSeconds(0, 0);

  if (!(lat >= -90 && lat <= 90)) throw Object.assign(new Error('lat must be in [-90, 90]'), { code: 400 });
  if (!(lon >= -180 && lon <= 360)) throw Object.assign(new Error('lon must be in [-180, 360]'), { code: 400 });
  if (Number.isNaN(start.getTime())) throw Object.assign(new Error('Invalid start'), { code: 400 });
  const stepMin = stepToMinutes(step);
  if (!stepMin) throw Object.assign(new Error("step must look like '10m', '1h', '1d'"), { code: 400 });
  if (!(days > 0 && (days * 1440) / stepMin <= MAX_ROWS)) {
    throw Object.assign(new Error(`Too many samples: reduce days or increase step (max ${MAX_ROWS})`), { code: 400 });
  }
  if (lon > 180) lon -= 360;

  const stop = new Date(start.getTime() + days * 86400_000);
  const key = [lat, lon, altKm, start.getTime(), stop.getTime(), step].join('|');

  // The cache holds the promise, so identical requests that arrive while one is still
  // loading wait for it instead of asking Horizons again. Failures are not cached.
  let entry = cache.get(key);
  if (!entry || Date.now() - entry.time > CACHE_TTL) {
    entry = { time: Date.now(), sky: fetchSky({ lat, lon, altKm, start, stop, step }) };
    cache.set(key, entry);
    entry.sky.catch(() => cache.get(key) === entry && cache.delete(key));
  }
  const sky = await entry.sky;

  const at = q.get('at') ? new Date(q.get('at')).getTime() : start.getTime();
  const modeParam = q.get('mode') ?? 'center';
  const mode = Number.isFinite(+modeParam) ? +modeParam : modeParam;

  return {
    site: { lat, lon, altKm, id: siteId ?? null },
    range: { start: start.getTime(), stop: stop.getTime(), step },
    samples: sky,                        // { sun: [{t,az,el}], earth: [...] }
    analysis: analyzeSky(sky, at, { mode }),
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'OPTIONS') return send(res, 204, {});
  try {
    if (url.pathname === '/api/health') return send(res, 200, { status: 'ok' });
    if (url.pathname === '/api/sites') return send(res, 200, SITES);
    if (url.pathname === '/api/sky') return send(res, 200, await handleSky(url.searchParams));
    return send(res, 404, { error: 'Not found' });
  } catch (e) {
    console.error(e);
    if (e.upstreamBusy) {
      return send(res, 503, { error: 'JPL Horizons is busy or unreachable right now – try again in a moment.' });
    }
    send(res, e.code && e.code < 500 ? e.code : 502, { error: e.message });
  }
});

server.listen(PORT, () => console.log(`Moon-sky API: http://localhost:${PORT}  (try /api/sky?site=apollo11)`));
