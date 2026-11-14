import { useMemo, useRef } from 'react';

const W = 1000, H = 280, PL = 44, PR = 14, PT = 14, PB = 30;
const DAY = 86400_000;

function linePath(samples, x, y) {
  const k = Math.max(1, Math.floor(samples.length / 1500));
  let d = '';
  for (let i = 0; i < samples.length; i += k) {
    const s = samples[i];
    d += `${i === 0 ? 'M' : 'L'}${x(s.t).toFixed(1)},${y(s.el).toFixed(1)}`;
  }
  return d;
}

export default function ElevationChart({ samples, a, onSeek }) {
  const ref = useRef(null);

  const geo = useMemo(() => {
    const t0 = samples.sun[0].t, t1 = samples.sun.at(-1).t;
    let lo = Infinity, hi = -Infinity;
    for (const s of [...samples.sun, ...samples.earth]) { lo = Math.min(lo, s.el); hi = Math.max(hi, s.el); }
    lo = Math.max(-90, Math.floor((lo - 3) / 10) * 10);
    hi = Math.min(90, Math.ceil((hi + 3) / 10) * 10);
    const x = (t) => PL + ((t - t0) / (t1 - t0)) * (W - PL - PR);
    const y = (el) => PT + ((hi - el) / (hi - lo)) * (H - PT - PB);
    const span = hi - lo;
    const ys = span > 90 ? 30 : span > 40 ? 15 : span > 15 ? 5 : 2;
    const yTicks = [];
    for (let v = Math.ceil(lo / ys) * ys; v <= hi; v += ys) yTicks.push(v);
    const nd = Math.max(1, Math.ceil((t1 - t0) / DAY / 8));
    const xTicks = [];
    for (let t = Math.ceil(t0 / DAY) * DAY; t <= t1; t += nd * DAY) xTicks.push(t);
    return {
      t0, t1, x, y, yTicks, xTicks,
      sun: linePath(samples.sun, x, y), earth: linePath(samples.earth, x, y),
    };
  }, [samples]);

  const { t0, t1, x, y } = geo;

  const seek = (e) => {
    const r = ref.current.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    onSeek(t0 + ((px - PL) / (W - PL - PR)) * (t1 - t0));
  };

  const thr = a.sun.threshold;

  return (
    <div className="chart">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); seek(e); }}
        onPointerMove={(e) => e.buttons & 1 && seek(e)}>
        {a.both.windows.map((w, i) => (
          <rect key={i} x={x(w.start)} width={Math.max(1, x(w.end) - x(w.start))}
            y={PT} height={H - PT - PB} className="both-band" />
        ))}
        {geo.yTicks.map((v) => (
          <g key={v}>
            <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} className={v === 0 ? 'grid main' : 'grid'} />
            <text x={PL - 6} y={y(v) + 4} textAnchor="end" className="axis">{v}°</text>
          </g>
        ))}
        {geo.xTicks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={PT} y2={H - PB} className="grid" />
            <text x={x(t)} y={H - 10} textAnchor="middle" className="axis">
              {new Date(t).toISOString().slice(5, 10)}
            </text>
          </g>
        ))}
        {thr !== 0 && (
          <line x1={PL} x2={W - PR} y1={y(thr)} y2={y(thr)} className="thr" />
        )}
        <path d={geo.sun} className="ln sun" />
        <path d={geo.earth} className="ln earth" />
        <line x1={x(a.at)} x2={x(a.at)} y1={PT} y2={H - PB} className="now" />
        <circle cx={x(a.at)} cy={y(a.sun.el)} r={5} className="pt sun" />
        <circle cx={x(a.at)} cy={y(a.earth.el)} r={5} className="pt earth" />
      </svg>
      <div className="maplegend">
        <span><i className="dot sun" /> Sun</span>
        <span><i className="dot earth" /> Earth</span>
        <span><i className="dot both" /> both above horizon</span>
        {thr !== 0 && <span className="muted">--- threshold {thr.toFixed(2)}°</span>}
        <span className="muted">click or drag on the chart</span>
      </div>
    </div>
  );
}
