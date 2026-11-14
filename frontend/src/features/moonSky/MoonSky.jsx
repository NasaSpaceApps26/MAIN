import { useEffect, useState } from 'react';
import { useMoonSky, useLandingSites } from './useMoonSky.js';
import Controls from './components/Controls.jsx';
import SiteSelect from './components/SiteSelect.jsx';
import MoonMap from './components/MoonMap.jsx';
import ElevationChart from './components/ElevationChart.jsx';
import SkyDome from './components/SkyDome.jsx';
import Metrics from './components/Metrics.jsx';
import Windows from './components/Windows.jsx';
import { fmtUtc } from './format.js';
import './moonSky.css';

const DEFAULTS = {
  lat: 0.6741, lon: 23.473, alt: 0,
  start: '2026-11-14T00:00', days: 30, step: '10m',
  mode: 'center', thr: 5, t: 0,
};
const STEPS = ['10m', '30m', '1h'];
const MODES = ['center', 'limb', 'custom'];

// Settings live in the page URL – the link can be copied and shared.
function readParams() {
  const q = new URLSearchParams(window.location.search);
  const num = (k) => (q.has(k) && Number.isFinite(+q.get(k)) ? +q.get(k) : DEFAULTS[k]);
  const pick = (k, list) => (list.includes(q.get(k)) ? q.get(k) : DEFAULTS[k]);
  const start = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(q.get('start') ?? '') ? q.get('start') : DEFAULTS.start;
  return {
    lat: num('lat'), lon: num('lon'), alt: num('alt'), start,
    days: num('days'), step: pick('step', STEPS), mode: pick('mode', MODES), thr: num('thr'), t: num('t'),
  };
}

/**
 * view = 'settings' → only the landing settings form
 * view = 'results'  → everything else (map, data, sky, chart, windows)
 * One instance serves both views, so they share the same settings and fetched data.
 */
export default function MoonSky({ view = 'results' }) {
  const sites = useLandingSites();
  const [p, setP] = useState(readParams);
  const [offsetMin, setOffsetMin] = useState(p.t);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(60); // simulated minutes per frame

  const update = (patch) => setP((prev) => ({ ...prev, ...patch }));

  const startMs = Date.parse(p.start + ':00Z');
  const totalMin = p.days * 1440;
  const offset = Math.min(offsetMin, totalMin);
  const at = startMs + offset * 60_000;
  const mode = p.mode === 'custom' ? p.thr : p.mode;

  const { loading, error, samples, analysis } = useMoonSky({
    lat: p.lat, lon: p.lon, altKm: p.alt, start: startMs, days: p.days, step: p.step, at, mode,
  });

  const site = sites.find((s) => Math.abs(s.lat - p.lat) < 1e-4 && Math.abs(s.lon - p.lon) < 1e-4);

  // animation
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setOffsetMin((o) => Math.min(o + speed, totalMin)), 50);
    return () => clearInterval(id);
  }, [playing, speed, totalMin]);
  useEffect(() => { if (playing && offset >= totalMin) setPlaying(false); }, [playing, offset, totalMin]);

  // keep the page URL in sync (not while animating); the #hash holds the active tab
  useEffect(() => {
    if (playing) return;
    const q = new URLSearchParams({
      lat: p.lat, lon: p.lon, alt: p.alt, start: p.start, days: p.days, step: p.step, mode: p.mode,
      ...(p.mode === 'custom' ? { thr: p.thr } : {}), t: offset,
    });
    window.history.replaceState(null, '', '?' + q + window.location.hash);
  }, [p, offset, playing]);

  const seek = (t) => setOffsetMin(Math.max(0, Math.min(totalMin, Math.round((t - startMs) / 60_000))));

  const header = (
    <header>
      <h1>{view === 'settings' ? 'Landing settings' : 'Lunar Sky Calculator'}</h1>
      <p className="sub">
        {site ? <b>{site.name}</b> : <b>Custom location</b>}
        {' · '}{p.lat.toFixed(4)}°, {p.lon.toFixed(4)}°{' · '}{fmtUtc(at)}
        {loading && <span className="loading"> · Loading data…</span>}
      </p>
    </header>
  );

  if (view === 'settings') {
    return (
      <div className="moon-sky">
        <div className="app">
          {header}
          {error && <div className="error">⚠️ {error}</div>}
          <section className="card">
            <Controls p={p} onChange={update} />
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="moon-sky">
      <div className="app">
        {header}

        {error && <div className="error">⚠️ {error}</div>}

        <div className="grid">
          <section className="card">
            <h2>Moon map <small>pick a landing site or click the map</small></h2>
            <SiteSelect sites={sites} siteId={site?.id} onChange={update} />
            <MoonMap lat={p.lat} lon={p.lon} sites={sites} siteId={site?.id}
              onPick={(c) => update(c)} />
          </section>

          <section className="card">
            <h2>Sky <small>top-down view</small></h2>
            <SkyDome samples={samples} a={analysis} />
          </section>
        </div>

        <section className="card">
          <h2>Data</h2>
          {analysis ? <Metrics a={analysis} /> : <p className="muted">{loading ? 'Loading…' : 'No data'}</p>}
        </section>

        <section className="card">
          <h2>Elevation over time</h2>
          <div className="timebar">
            <button type="button" onClick={() => { if (offset >= totalMin) setOffsetMin(0); setPlaying((v) => !v); }}
              title={playing ? 'Pause' : 'Play'}>{playing ? '⏸' : '▶'}</button>
            <button type="button" onClick={() => { setPlaying(false); setOffsetMin(0); }} title="Back to start">⏮</button>
            <select value={speed} onChange={(e) => setSpeed(+e.target.value)} title="Animation speed">
              <option value={10}>10 min / frame</option>
              <option value={60}>1 h / frame</option>
              <option value={360}>6 h / frame</option>
            </select>
            <input type="range" min={0} max={totalMin} step={10} value={offset}
              onChange={(e) => setOffsetMin(+e.target.value)} />
            <span className="time">{fmtUtc(at)}</span>
          </div>
          {samples && analysis && (
            <ElevationChart samples={samples} a={analysis} onSeek={seek} />
          )}
        </section>

        {analysis && (
          <section className="card">
            <h2>Visibility windows <small>click a row to jump to it</small></h2>
            <Windows a={analysis} onSeek={seek} />
          </section>
        )}

        <footer className="muted">
          Data: JPL Horizons (flat horizon, no terrain mask). All times in UTC.
        </footer>
      </div>
    </div>
  );
}
