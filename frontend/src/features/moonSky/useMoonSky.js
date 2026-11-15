// Fetches samples from the moon-sky API ONCE per (site, range); the analysis for moment `at`
// is computed locally, so the time slider stays smooth without further Horizons requests.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { analyzeSky } from './analysis.js';

const DEBOUNCE_MS = 600;

// Same pattern as VITE_BACKEND_URL: the browser talks to the moon-sky service directly (it sends CORS headers).
const API = import.meta.env.VITE_MOON_SKY_URL ?? 'http://localhost:3001';

export function useMoonSky({ lat, lon, altKm = 0, start, days = 30, step = '10m', at, mode = 'center' }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const startIso = Number.isFinite(start) ? new Date(start).toISOString() : null;

  useEffect(() => {
    if (lat == null || lon == null || !startIso) return;
    const ctrl = new AbortController();
    const qs = new URLSearchParams({ lat, lon, alt: altKm, start: startIso, days, step });
    setLoading(true);
    setError(null);
    // Wait until the settings stop changing (typing a date, clicking around the map,
    // the clock pushing the range forward) – otherwise every step sends a Horizons request.
    const timer = setTimeout(() => fetch(`${API}/api/sky?${qs}`, { signal: ctrl.signal })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        return j;
      })
      .then((j) => { setData(j); setLoading(false); })
      .catch((e) => {
        if (e.name === 'AbortError') return;
        setError(e.message === 'Failed to fetch'
          ? `Cannot reach the moon-sky server at ${API} – is it running (node moon-sky/server.js or docker compose)?`
          : e.message);
        setLoading(false);
      }), DEBOUNCE_MS);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [lat, lon, altKm, startIso, days, step, attempt]);

  const analysis = useMemo(
    () => (data && Number.isFinite(at) ? analyzeSky(data.samples, at, { mode }) : null),
    [data, at, mode]
  );

  return { loading, error, retry, samples: data?.samples ?? null, range: data?.range ?? null, analysis };
}

export function useLandingSites() {
  const [sites, setSites] = useState([]);
  useEffect(() => {
    fetch(`${API}/api/sites`).then((r) => r.json()).then(setSites).catch(() => setSites([]));
  }, []);
  return sites;
}

// Samples already fetched, by point + range: the ranking table asks for several landing sites and
// must not send Horizons the same request again on every re-render.
const skyCache = new Map();

/**
 * Sun and Earth samples for several landing sites over the same range (the ranking table).
 * points = [{ key, lat, lon }]. Fetched one after another (gentle on JPL Horizons), each once.
 * Returns { byKey: { [key]: samples }, pending: how many are still missing, failed: how many could
 * not be fetched in the last attempt }.
 */
export function useSkyForPoints(points, { start, days = 30, step = '10m' }) {
  const [, setTick] = useState(0);
  const [failed, setFailed] = useState(0);
  const startIso = Number.isFinite(start) ? new Date(start).toISOString() : null;
  const keyOf = (p) => `${p.lat},${p.lon},${startIso},${days},${step}`;
  const wanted = points.map((p) => `${p.key}=${keyOf(p)}`).join(';');

  useEffect(() => {
    if (!startIso) return;
    const ctrl = new AbortController();
    const missing = points.filter((p) => !skyCache.has(keyOf(p)));
    if (!missing.length) return;
    const timer = setTimeout(async () => {
      let errors = 0;
      for (const p of missing) {
        const qs = new URLSearchParams({ lat: p.lat, lon: p.lon, alt: 0, start: startIso, days, step });
        try {
          const r = await fetch(`${API}/api/sky?${qs}`, { signal: ctrl.signal });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const j = await r.json();
          skyCache.set(keyOf(p), j.samples);
          setTick((n) => n + 1);
        } catch (e) {
          if (e.name === 'AbortError') return;
          errors++;
        }
      }
      setFailed(errors);
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [wanted]); // `wanted` stands for points + range

  const byKey = {};
  for (const p of points) {
    const s = skyCache.get(keyOf(p));
    if (s) byKey[p.key] = s;
  }
  return { byKey, pending: points.length - Object.keys(byKey).length, failed };
}
