import { useState } from 'react';

// Equirectangular map: 1° = 2 px, lon −180…180, lat 90…−90
const W = 720, H = 360;
const X = (lon) => (lon + 180) * 2;
const Y = (lat) => (90 - lat) * 2;

function toCoord(e) {
  const r = e.currentTarget.getBoundingClientRect();
  const lon = ((e.clientX - r.left) / r.width) * W / 2 - 180;
  const lat = 90 - ((e.clientY - r.top) / r.height) * H / 2;
  const clamp = (v, a) => Math.max(-a, Math.min(a, v));
  return { lat: +clamp(lat, 90).toFixed(2), lon: +clamp(lon, 180).toFixed(2) };
}

export default function MoonMap({ lat, lon, sites, siteId, onPick }) {
  const [hover, setHover] = useState(null);

  return (
    <div className="moonmap">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Moon map"
        onClick={(e) => onPick(toCoord(e))}
        onMouseMove={(e) => setHover(toCoord(e))}
        onMouseLeave={() => setHover(null)}>
        <rect width={W} height={H} className="far" />
        <rect x={X(-90)} width={X(90) - X(-90)} height={H} className="near" />

        {[-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150].map((l) => (
          <line key={'m' + l} x1={X(l)} x2={X(l)} y1={0} y2={H} className={l === 0 ? 'grid main' : 'grid'} />
        ))}
        {[-60, -30, 0, 30, 60].map((l) => (
          <line key={'p' + l} y1={Y(l)} y2={Y(l)} x1={0} x2={W} className={l === 0 ? 'grid main' : 'grid'} />
        ))}
        {[-120, -60, 0, 60, 120].map((l) => (
          <text key={'tl' + l} x={X(l) + 3} y={H - 5} className="axis">{l}°</text>
        ))}
        {[-60, -30, 30, 60].map((l) => (
          <text key={'tp' + l} x={4} y={Y(l) - 3} className="axis">{l}°</text>
        ))}
        <text x={X(0)} y={16} className="side" textAnchor="middle">near side (visible from Earth)</text>
        <text x={X(-135)} y={16} className="side" textAnchor="middle">far side</text>
        <text x={X(135)} y={16} className="side" textAnchor="middle">far side</text>

        {sites.map((s) => (
          <g key={s.id} className={s.id === siteId ? 'site active' : 'site'}
            onClick={(e) => { e.stopPropagation(); onPick({ lat: s.lat, lon: s.lon }); }}>
            <circle cx={X(s.lon)} cy={Y(s.lat)} r={4.5} />
            <title>{`${s.name} (${s.year}) – ${s.lat}°, ${s.lon}°`}</title>
          </g>
        ))}

        <g className="cursor" pointerEvents="none">
          <circle cx={X(lon)} cy={Y(lat)} r={9} />
          <line x1={X(lon) - 14} x2={X(lon) + 14} y1={Y(lat)} y2={Y(lat)} />
          <line y1={Y(lat) - 14} y2={Y(lat) + 14} x1={X(lon)} x2={X(lon)} />
        </g>
      </svg>
      <div className="maplegend">
        <span><i className="dot site" /> landing sites</span>
        <span><i className="dot cur" /> selected location</span>
        <span className="muted">{hover ? `cursor: ${hover.lat}°, ${hover.lon}°` : ' '}</span>
      </div>
    </div>
  );
}
