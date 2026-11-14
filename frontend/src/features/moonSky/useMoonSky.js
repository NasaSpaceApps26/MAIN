// Fetches samples from the moon-sky API ONCE per (site, range); the analysis for moment `at`
// is computed locally, so the time slider stays smooth without further Horizons requests.
import { useEffect, useMemo, useState } from 'react';
import { analyzeSky } from './analysis.js';

// Same pattern as VITE_BACKEND_URL: the browser talks to the moon-sky service directly (it sends CORS headers).
const API = import.meta.env.VITE_MOON_SKY_URL ?? 'http://localhost:3001';

export function useMoonSky({ lat, lon, altKm = 0, start, days = 30, step = '10m', at, mode = 'center' }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const startIso = Number.isFinite(start) ? new Date(start).toISOString() : null;

  useEffect(() => {
    if (lat == null || lon == null || !startIso) return;
    const ctrl = new AbortController();
    const qs = new URLSearchParams({ lat, lon, alt: altKm, start: startIso, days, step });
    setLoading(true);
    setError(null);
    fetch(`${API}/api/sky?${qs}`, { signal: ctrl.signal })
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
      });
    return () => ctrl.abort();
  }, [lat, lon, altKm, startIso, days, step]);

  const analysis = useMemo(
    () => (data && Number.isFinite(at) ? analyzeSky(data.samples, at, { mode }) : null),
    [data, at, mode]
  );

  return { loading, error, samples: data?.samples ?? null, range: data?.range ?? null, analysis };
}

export function useLandingSites() {
  const [sites, setSites] = useState([]);
  useEffect(() => {
    fetch(`${API}/api/sites`).then((r) => r.json()).then(setSites).catch(() => setSites([]));
  }, []);
  return sites;
}
