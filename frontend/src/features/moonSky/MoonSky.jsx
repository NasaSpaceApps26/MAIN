import { useEffect, useMemo, useRef, useState } from 'react';
import { useSimStore } from '../../store/simStore';
import { useMissionStore } from '../mission/missionStore';
import { PauseIcon, PlayIcon, RestartIcon } from '../../components/icons/Icons';
import { useMoonSky, useLandingSites } from './useMoonSky.js';
import Controls from './components/Controls.jsx';
import SiteSelect from './components/SiteSelect.jsx';
import MoonMap from './components/MoonMap.jsx';
import ElevationChart from './components/ElevationChart.jsx';
import SkyDome from './components/SkyDome.jsx';
import SkyDome3D from './components/SkyDome3D.jsx';
import Metrics from './components/Metrics.jsx';
import Windows from './components/Windows.jsx';
import { fmtUtc } from './format.js';
import { linkAt, linkSegments } from './link.js';
import { siteById } from '../launchSites/sites';
import './moonSky.css';

import { CLOCK_SPEEDS as SPEEDS } from '../../components/TopBar/clockSpeeds';
import { LaunchSitesTable } from '../mission/LaunchSitesTable';
import PowerCommsRanking from './components/PowerCommsRanking.jsx';

/** ms → 'YYYY-MM-DDTHH:MM' (UTC), rounded down to the full hour – the range-start format. */
const toStartInput = (ms) => new Date(Math.floor(ms / 3600_000) * 3600_000).toISOString().slice(0, 16);

const DEFAULTS = {
  lat: 0.6741, lon: 23.473, alt: 0,
  days: 30, step: '10m',
  mode: 'center', thr: 5, t: 0,
};
const STEPS = ['10m', '30m', '1h'];
const START_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

// Settings live in the page URL – the link can be copied and shared.
function readParams() {
  const q = new URLSearchParams(window.location.search);
  const num = (k) => (q.has(k) && Number.isFinite(+q.get(k)) ? +q.get(k) : DEFAULTS[k]);
  const pick = (k, list) => (list.includes(q.get(k)) ? q.get(k) : DEFAULTS[k]);
  const fromUrl = START_RE.test(q.get('start') ?? '');
  // no range in the URL → start the range at the mission clock's current time
  const start = fromUrl ? q.get('start') : toStartInput(useSimStore.getState().simTimeMs);
  // the landing point is shared with the mission panel (the mission store also starts from the URL)
  const { lat, lon } = useMissionStore.getState().landing;
  return {
    lat, lon, alt: num('alt'), start, fromUrl,
    days: num('days'), step: pick('step', STEPS), mode: 'center', thr: DEFAULTS.thr, t: num('t'),
  };
}

/**
 * The launch site whose ground station talks to the lander: the one highlighted in the mission panel,
 * else the one of the computed flight. Same object while nothing changes (it keys memos).
 */
function useLaunchStation() {
  const siteId = useSimStore((s) => s.missionSites[s.activeSiteSlot] ?? null);
  const launch = useMissionStore((s) => s.launch);
  const launchName = useMissionStore((s) => s.launchName);
  return useMemo(() => {
    const site = siteId ? siteById(siteId) : null;
    return site ? { name: site.name, lat: site.lat, lon: site.lon } : { name: launchName, lat: launch.lat, lon: launch.lon };
  }, [siteId, launch, launchName]);
}

/**
 * view   = 'settings' → the landing settings form and the Moon map to pick the site
 *          'results'  → everything else (sky, data, chart, windows)
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
  const [skyView, setSkyView] = useState('3d'); // sky card: two 3D views, or the flat top-down projection

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

  // Link to Earth from the mission's launch site (its ground station), as Earth turns under the Moon
  const station = useLaunchStation();
  const segments = useMemo(
    () => (samples && station ? linkSegments(samples.earth, station, mode) : null),
    [samples, station, mode],
  );
  const link = segments && station ? linkAt(segments, station, at) : null;

  // keep the mission's landing point and this form in step, both ways
  useEffect(() => useMissionStore.getState().setLanding({ lat: p.lat, lon: p.lon }), [p.lat, p.lon]);
  useEffect(() => useMissionStore.subscribe(({ landing: l }) => setP((prev) =>
    Math.abs(prev.lat - l.lat) > 1e-6 || Math.abs(prev.lon - l.lon) > 1e-6 ? { ...prev, lat: l.lat, lon: l.lon } : prev,
  )), []);

  // the named site at this point (same tolerance as the mission panel's labels, mission/landing.ts)
  const site = sites.find((s) => Math.abs(s.lat - p.lat) < 0.05 && Math.abs(s.lon - p.lon) < 0.05);

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
      lat: p.lat, lon: p.lon, alt: p.alt, start: p.start, days: p.days, step: p.step, t: offset,
    });
    window.history.replaceState(null, '', '?' + q + window.location.hash);
  }, [p, offset, playing]);

  const seek = (t) => setSimTime(Math.min(Math.max(Math.round(t), startMs), endMs));

  const header = (
    <header>
      <h1>{view === 'settings' ? 'Landing settings' : 'Lunar Sky Calculator'}</h1>
      <p className="sub">
        {site ? <b>{site.name}</b> : <b>Selected point</b>}
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
              {error}{' '}
              <button type="button" onClick={retry}>Retry</button>
            </div>
          )}
          <section className="card">
            <Controls p={p} onChange={update}>
              <MoonMap lat={p.lat} lon={p.lon} sites={sites} siteId={site?.id}
                onPick={(c) => update(c)} />
              <SiteSelect sites={sites} siteId={site?.id} onChange={update} />
            </Controls>
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
              {error}{' '}
              <button type="button" onClick={retry}>Retry</button>
            </div>
          )}

        <section className="card">
          <h2 className="sky-head">
            <span>Sky</span>
            <span className="seg" role="group" aria-label="Sky view">
              {['3d', '2d'].map((v) => (
                <button key={v} type="button" className={skyView === v ? 'on' : ''} aria-pressed={skyView === v}
                  onClick={() => setSkyView(v)}>{v.toUpperCase()}</button>
              ))}
            </span>
          </h2>
          {skyView === '3d' ? (
            <div className="sky-pair">
              <SkyDome3D samples={samples} a={analysis} mode="outside" />
              <SkyDome3D samples={samples} a={analysis} mode="inside" />
            </div>
          ) : (
            <SkyDome samples={samples} a={analysis} />
          )}
        </section>

        <section className="card">
          <h2>Data</h2>
          {analysis ? <Metrics a={analysis} link={link} /> : <p className="muted">{loading ? 'Loading…' : 'No data'}</p>}
        </section>

        <section className="card">
          <h2>Launch sites</h2>
          <LaunchSitesTable samples={samples} />
        </section>

        <section className="card">
          <h2>Power &amp; comms ranking</h2>
          <PowerCommsRanking p={p} pointName={site ? site.name : 'Selected point'} station={station}
            onPick={(c) => update(c)} />
        </section>

        <section className="card">
          <h2>Elevation over time</h2>
          <div className="timebar">
            <button type="button" onClick={togglePlay}
              title={playing ? 'Pause (mission clock)' : 'Play (mission clock)'}
              aria-label={playing ? 'Pause (mission clock)' : 'Play (mission clock)'}>
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button type="button" onClick={() => { if (playing) togglePlay(); setSimTime(startMs); }}
              title="Back to range start" aria-label="Back to range start"><RestartIcon /></button>
            <select value={timeScale} onChange={(e) => setTimeScale(+e.target.value)} title="Clock speed (same as the top bar)">
              {!SPEEDS.some((sp) => sp.value === timeScale) && <option value={timeScale}>auto (flight)</option>}
              {SPEEDS.map((sp) => <option key={sp.value} value={sp.value}>{sp.label}</option>)}
            </select>
            <input type="range" min={0} max={totalMin} step={10} value={offset}
              onChange={(e) => setSimTime(startMs + +e.target.value * 60_000)} />
            <span className="time" title="Mission clock (same as the top bar)">{fmtUtc(simTimeMs)}</span>
          </div>
          {samples && analysis && (
            <ElevationChart samples={samples} a={analysis} onSeek={seek} link={segments} station={station} />
          )}
        </section>

        {analysis && (
          <section className="card">
            <h2>Visibility windows</h2>
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
