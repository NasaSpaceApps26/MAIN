import { useMemo } from 'react';

// Azimuthal projection: centre = zenith, edge = horizon, N at the top, E on the right.
const C = 160, R = 135;
const pt = (az, el) => {
  const r = (R * (90 - Math.max(el, 0))) / 90;
  const a = (az * Math.PI) / 180;
  return [C + r * Math.sin(a), C - r * Math.cos(a)];
};

function track(samples) {
  const k = Math.max(1, Math.floor(samples.length / 600));
  let d = '', pen = false;
  for (let i = 0; i < samples.length; i += k) {
    const s = samples[i];
    if (s.el < 0) { pen = false; continue; }
    const [x, y] = pt(s.az, s.el);
    d += `${pen ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    pen = true;
  }
  return d;
}

function Body({ b, cls, label }) {
  const [x, y] = pt(b.az, b.el);
  return (
    <g className={`body ${cls} ${b.isUp ? '' : 'below'}`}>
      <circle cx={x} cy={y} r={cls === 'earth' ? 10 : 9} />
      <text x={x} y={y - 15} textAnchor="middle">{label}{b.isUp ? '' : ' (below hor.)'}</text>
    </g>
  );
}

export default function SkyDome({ samples, a }) {
  const tracks = useMemo(
    () => (samples ? { sun: track(samples.sun), earth: track(samples.earth) } : null),
    [samples]
  );

  return (
    <div className="dome">
      <svg viewBox="0 0 320 320">
        <circle cx={C} cy={C} r={R} className="sky" />
        {[30, 60].map((el) => <circle key={el} cx={C} cy={C} r={(R * (90 - el)) / 90} className="grid" />)}
        <line x1={C - R} x2={C + R} y1={C} y2={C} className="grid" />
        <line y1={C - R} y2={C + R} x1={C} x2={C} className="grid" />
        <text x={C + 3} y={C - (R * 60) / 90 - 3} className="axis">30°</text>
        <text x={C + 3} y={C - (R * 30) / 90 - 3} className="axis">60°</text>
        <text x={C} y={C - R - 6} textAnchor="middle" className="card-dir">N</text>
        <text x={C} y={C + R + 16} textAnchor="middle" className="card-dir">S</text>
        <text x={C + R + 8} y={C + 5} className="card-dir">E</text>
        <text x={C - R - 18} y={C + 5} className="card-dir">W</text>
        {tracks && <path d={tracks.sun} className="track sun" />}
        {tracks && <path d={tracks.earth} className="track earth" />}
        {a && <Body b={a.sun} cls="sun" label="Sun" />}
        {a && <Body b={a.earth} cls="earth" label="Earth" />}
      </svg>
    </div>
  );
}
