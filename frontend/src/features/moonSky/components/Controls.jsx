import { useEffect, useState } from 'react';
import { nowUtcInput } from '../format.js';

const STEP_MIN = { '10m': 10, '30m': 30, '1h': 60 };

/**
 * Landing settings form. `children` (the Moon map and site list) come first, then the coordinates
 * and the time settings. Typed coordinates take effect on Enter or when the field is left; the map,
 * the site list and the time settings apply as soon as they change.
 */
export default function Controls({ p, onChange, children }) {
  const [draft, setDraft] = useState({ lat: p.lat, lon: p.lon, alt: p.alt });
  const [err, setErr] = useState(null);

  // when the location changes from outside (map, list) – refresh the fields
  useEffect(() => { setDraft({ lat: p.lat, lon: p.lon, alt: p.alt }); setErr(null); }, [p.lat, p.lon, p.alt]);

  const commit = () => {
    const lat = +draft.lat, lon = +draft.lon, alt = +draft.alt;
    if (draft.lat === '' || !(lat >= -90 && lat <= 90)) return setErr('Latitude must be between −90 and 90°');
    if (draft.lon === '' || !(lon >= -180 && lon <= 180)) return setErr('Longitude must be between −180 and 180°');
    if (!Number.isFinite(alt) || alt < -10 || alt > 20) return setErr('Altitude must be between −10 and 20 km');
    setErr(null);
    if (lat !== p.lat || lon !== p.lon || alt !== p.alt) onChange({ lat, lon, alt });
  };
  const submit = (e) => { e.preventDefault(); commit(); };

  const field = (k) => ({
    value: draft[k],
    onChange: (e) => { setDraft({ ...draft, [k]: e.target.value }); setErr(null); },
    onBlur: commit,
    onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } },
  });

  return (
    <form className="controls" onSubmit={submit}>
      {children}

      <div className="row3">
        <label>Latitude [°]<input type="number" step="any" {...field('lat')} /></label>
        <label>Longitude [°]<input type="number" step="any" {...field('lon')} /></label>
        <label>Altitude [km]<input type="number" step="any" {...field('alt')} /></label>
      </div>
      <p className="hint">Latitude: + north. Longitude: + east, − west. Enter or leaving the field sets it.</p>

      <hr />

      <label>
        Range start (UTC)
        <div className="inline">
          <input type="datetime-local" value={p.start}
            onChange={(e) => e.target.value && onChange({ start: e.target.value.slice(0, 16) })} />
          <button type="button" onClick={() => onChange({ start: nowUtcInput() })}>Now</button>
        </div>
      </label>

      <div className="row2">
        <label>
          Time interval
          <select value={p.days} onChange={(e) => onChange({ days: +e.target.value })}>
            {[1, 3, 7, 14, 30, 60].map((d) => <option key={d} value={d}>{d} {d === 1 ? 'day' : 'days'}</option>)}
          </select>
        </label>
        <label>
          Data step
          <select value={p.step} onChange={(e) => onChange({ step: e.target.value })}>
            {Object.keys(STEP_MIN).map((s) => <option key={s} value={s}>{s.replace('m', ' min').replace('h', ' h')}</option>)}
          </select>
        </label>
      </div>

      {err && <p className="field-error">{err}</p>}
    </form>
  );
}
