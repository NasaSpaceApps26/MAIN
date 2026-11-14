import { useEffect, useRef, useState } from 'react';
import { useSimStore } from '../../store/simStore';
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

// Same speeds as the mission clock in the top bar (simulated seconds per real second).
const SPEEDS = [
  { value: 1, label: '1×' },
  { value: 60, label: '1 min/s' },
  { value: 3600, label: '1 h/s' },
  { value: 86400, label: '1 d/s' },
];

/** ms → 'YYYY-MM-DDTHH:MM' (UTC), rounded down to the full hour – the range-start format. */
const toStartInput = (ms) => new Date(Math.floor(ms / 3600_000) * 3600_000).toISOString().slice(0, 16);

const DEFAULTS = {
  lat: 0.6741, lon: 23.473, alt: 0,
  days: 30, step: '10m',
  mode: 'center', thr: 5, t: 0,
};
const STEPS = ['10m', '30m', '1h'];
const MODES = ['center', 'limb', 'custom'];
const START_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

// Settings live in the page URL – the link can be copied and shared.
function readParams() {
  const q = new URLSearchParams(window.location.search);
  const num = (k) => (q.has(k) && Number.isFinite(+q.get(k)) ? +q.get(k) : DEFAULTS[k]);
  const pick = (k, list) => (list.includes(q.get(k)) ? q.get(k) : DEFAULTS[k]);
  const fromUrl = START_RE.test(q.get('start') ?? '');
  // no range in the URL → start the range at the mission clock's current time
  const start = fromUrl ? q.get('start') : toStartInput(useSimStore.getState().simTimeMs);
  return {
    lat: num('lat'), lon: num('lon'), alt: num('alt'), start, fromUrl,
    days: num('days'), step: pick('step', STEPS), mode: pick('mode', MODES), thr: num('thr'), t: num('t'),
  };
}

/**
 * view   = 'settings' → only the landing settings form
 *          'results'  → everything else (map, data, sky, chart, windows)
 * active = panel is open; while closed the component ignores clock ticks (no re-render every frame).
 * One instance serves both views, so they share the same settings and fetched data.
 *
 * Time is shared with the mission clock in the top bar (simStore): the slider, play button and
 * speed here drive the same clock as the 3D view. If the clock runs outside the fetched range,
 * the range moves to follow it.
 */
export default function MoonSky({ view = 'results', active = true }) {
  const sites = useLandingSites();
  const [p, setP] = useState(readParams);

  const liveTime = useSimStore((s) => (active ? s.simTimeMs : null));
  const lastTime = useRef(useSimStore.getState().simTimeMs);
  if (liveTime != null) lastTime.current = liveTime;
  const simTimeMs = liveTime ?? lastTime.current;
  const playing = useSimStore((s) => s.isPlaying);
  const timeScale = useSimStore((s) => s.timeScale);
  const { setSimTime, togglePlay, setTimeScale } = useSimStore.getState();

  const startMs = Date.parse(p.start + ':00Z');
  const totalMin = p.days * 1440;
  const endMs = startMs + totalMin * 60_000;
  const at = Math.min(Math.max(simTimeMs, startMs), endMs);
  const offset = Math.round((at - startMs) / 60_000);
  const mode = p.mode === 'custom' ? p.thr : p.mode;

  // Changing the range by hand (start / length) pulls the clock into the new range.
  const update = (patch) => {
    const next = { ...p, ...patch };
    setP(next);
    if (patch.start !== undefined || patch.days !== undefined) {
      const s0 = Date.parse(next.start + ':00Z');
      const s1 = s0 + next.days * 86400_000;
      const now = useSimStore.getState().simTimeMs;
      if (patch.start !== undefined || now < s0 || now > s1) setSimTime(Math.min(Math.max(now, s0), s1));
    }
  };

  const { loading, error, retry, samples, analysis } = useMoonSky({
    lat: p.lat, lon: p.lon, altKm: p.alt, start: startMs, days: p.days, step: p.step, at, mode,
  });

  const site = sites.find((s) => Math.abs(s.lat - p.lat) < 1e-4 && Math.abs(s.lon - p.lon) < 1e-4);

  // A shared link (range + t in the URL) sets the mission clock once, on first open.
  // Declared before the follow effect below, so that effect already sees the restored time.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    if (p.fromUrl) setSimTime(startMs + Math.min(p.t, totalMin) * 60_000);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The clock ran outside the fetched range (mission clock playing, or set in the 3D view):
  // move the range so it starts at the clock's current hour.
  useEffect(() => {
    if (!active) return;
    const now = useSimStore.getState().simTimeMs;
    if (now < startMs || now > endMs) setP((prev) => ({ ...prev, start: toStartInput(now) }));
  }, [active, simTimeMs, startMs, endMs]);

  // keep the page URL in sync (not while the clock runs); the #hash holds the open tab
  useEffect(() => {
    if (playing) return;
    const q = new URLSearchParams({
      lat: p.lat, lon: p.lon, alt: p.alt, start: p.start, days: p.days, step: p.step, mode: p.mode,
      ...(p.mode === 'custom' ? { thr: p.thr } : {}), t: offset,
    });
    window.history.replaceState(null, '', '?' + q + window.location.hash);
  }, [p, offset, playing]);

  const seek = (t) => setSimTime(Math.min(Math.max(Math.round(t), startMs), endMs));

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
          {error && (
            <div className="error">
              ⚠️ {error}{' '}
              <button type="button" onClick={retry}>Retry</button>
            </div>
          )}
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

        {error && (
            <div className="error">
              ⚠️ {error}{' '}
              <button type="button" onClick={retry}>Retry</button>
            </div>
          )}

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
          <h2>Elevation over time <small>synced with the mission clock</small></h2>
          <div className="timebar">
            <button type="button" onClick={togglePlay}
              title={playing ? 'Pause (mission clock)' : 'Play (mission clock)'}>{playing ? '⏸' : '▶'}</button>
            <button type="button" onClick={() => { if (playing) togglePlay(); setSimTime(startMs); }}
              title="Back to range start">⏮</button>
            <select value={timeScale} onChange={(e) => setTimeScale(+e.target.value)} title="Clock speed">
              {SPEEDS.map((sp) => <option key={sp.value} value={sp.value}>{sp.label}</option>)}
            </select>
            <input type="range" min={0} max={totalMin} step={10} value={offset}
              onChange={(e) => setSimTime(startMs + +e.target.value * 60_000)} />
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
