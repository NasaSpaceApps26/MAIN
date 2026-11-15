import { useEffect, useRef, useState } from 'react';
import { TILE_SOURCES, baseMapUrl, tileUrl } from '../../../components/SolarSystem/EarthMoon/tileSources';

// Equirectangular map: 1° = 2 map units, lon −180…180, lat 90…−90. The view can be zoomed into.
const W = 720, H = 360;
const MAX_ZOOM = 32;
const MOON = TILE_SOURCES.moon;
const BASE_PX_PER_DEG = 4096 / 360; // the base photo (backend /surface/moon/base.jpg)
const TILE_LAT_LIMIT = MOON.clipPolewardOf; // the lat/lon tiles stop here (polar maps beyond)
const MAX_TILES = 64; // never ask for more tiles than this at once

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Keeps the view (zoom + centre in map units) inside the map. */
function clampView({ zoom, cx, cy }) {
  const z = clamp(zoom, 1, MAX_ZOOM);
  const hw = W / 2 / z, hh = H / 2 / z;
  return { zoom: z, cx: clamp(cx, hw, W - hw), cy: clamp(cy, hh, H - hh) };
}

const FULL = { zoom: 1, cx: W / 2, cy: H / 2 };

/**
 * Lunar photo map to pick the landing site: the high-resolution LROC mosaic from the backend (the
 * same imagery as the 3D Moon), sharper tiles once zoomed in. Wheel or +/− zooms, drag pans,
 * click picks a point.
 * `others`: the mission's other landings as lettered dots, [{ key, letter, label, lat, lon, note? }].
 */
export default function MoonMap({ lat, lon, sites, siteId, onPick, others = [] }) {
  const [hover, setHover] = useState(null);
  const [view, setView] = useState(FULL);
  const [widthPx, setWidthPx] = useState(W);
  const svgRef = useRef(null);
  const drag = useRef(null); // { x, y, cx, cy, moved } while the mouse button is down

  // map units ↔ drawing units of the current view
  const k = view.zoom;
  const ox = view.cx - W / 2 / k, oy = view.cy - H / 2 / k;
  const X = (lo) => ((lo + 180) * 2 - ox) * k;
  const Y = (la) => ((90 - la) * 2 - oy) * k;

  /** Pointer event → map units (0…W, 0…H) under it. */
  const mapPoint = (e) => {
    const r = svgRef.current.getBoundingClientRect();
    return { mx: ox + ((e.clientX - r.left) / r.width) * W / k, my: oy + ((e.clientY - r.top) / r.height) * H / k };
  };
  const toCoord = (e) => {
    const { mx, my } = mapPoint(e);
    return { lat: +clamp(90 - my / 2, -90, 90).toFixed(2), lon: +clamp(mx / 2 - 180, -180, 180).toFixed(2) };
  };

  // the drawn width decides how sharp the imagery must be
  useEffect(() => {
    const el = svgRef.current;
    const ro = new ResizeObserver(([entry]) => setWidthPx(entry.contentRect.width || W));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // wheel zoom around the cursor (a native listener: React's wheel listener cannot stop page scroll)
  useEffect(() => {
    const el = svgRef.current;
    const onWheel = (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
      setView((v) => {
        const zoom = clamp(v.zoom * Math.exp(-e.deltaY * 0.0015), 1, MAX_ZOOM);
        // keep the point under the cursor where it is
        const mx = v.cx - W / 2 / v.zoom + fx * W / v.zoom, my = v.cy - H / 2 / v.zoom + fy * H / v.zoom;
        return clampView({ zoom, cx: mx - (fx - 0.5) * W / zoom, cy: my - (fy - 0.5) * H / zoom });
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const zoomBy = (f) => setView((v) => clampView({ ...v, zoom: v.zoom * f }));

  // Sharper tiles once the base photo is not sharp enough for the zoomed view
  const needPxPerDeg = (widthPx * (window.devicePixelRatio || 1) * k) / 360;
  const tiles = [];
  if (needPxPerDeg > BASE_PX_PER_DEG * 1.2) {
    const z = clamp(Math.ceil(Math.log2((needPxPerDeg * MOON.level0Span) / MOON.tilePx)), MOON.minLevel + 1, MOON.maxLevel);
    const span = MOON.level0Span / 2 ** z; // degrees per tile
    const lon0 = ox / 2 - 180, lon1 = lon0 + W / 2 / k;
    const lat1 = 90 - oy / 2, lat0 = lat1 - H / 2 / k;
    const c0 = Math.max(0, Math.floor((lon0 + 180) / span)), c1 = Math.min(360 / span - 1, Math.floor((lon1 + 180) / span));
    const r0 = Math.max(0, Math.floor((90 - lat1) / span)), r1 = Math.min(180 / span - 1, Math.floor((90 - lat0) / span));
    if ((c1 - c0 + 1) * (r1 - r0 + 1) <= MAX_TILES) {
      for (let row = r0; row <= r1; row++) {
        const top = 90 - row * span;
        if (top - span >= TILE_LAT_LIMIT || top <= -TILE_LAT_LIMIT) continue; // polar: base photo only
        for (let col = c0; col <= c1; col++) {
          tiles.push({ key: `${z}/${row}/${col}`, href: tileUrl(MOON, z, row, col), lon: -180 + col * span, lat: top, span });
        }
      }
    }
  }

  const gridStep = k >= 8 ? 5 : k >= 3 ? 10 : 30;
  const meridians = [], parallels = [];
  for (let l = -180 + gridStep; l < 180; l += gridStep) meridians.push(l);
  for (let l = -90 + gridStep; l < 90; l += gridStep) parallels.push(l);
  const inX = (x) => x > -1 && x < W + 1, inY = (y) => y > -1 && y < H + 1;

  return (
    <div className="moonmap">
      <div className="map-frame">
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Moon map"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            drag.current = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy, moved: false };
          }}
          onPointerMove={(e) => {
            setHover(toCoord(e));
            const d = drag.current;
            if (!d) return;
            const dx = e.clientX - d.x, dy = e.clientY - d.y;
            if (!d.moved && Math.hypot(dx, dy) < 4) return;
            if (!d.moved) { d.moved = true; e.currentTarget.setPointerCapture(e.pointerId); }
            const r = svgRef.current.getBoundingClientRect();
            setView((v) => clampView({ ...v, cx: d.cx - (dx / r.width) * W / v.zoom, cy: d.cy - (dy / r.height) * H / v.zoom }));
          }}
          onPointerUp={(e) => {
            const d = drag.current;
            drag.current = null;
            // a click on a named site picks it (its own handler); on an alternative's dot, nothing
            if (d && !d.moved && !e.target.closest('.site, .alt')) onPick(toCoord(e));
          }}
          onPointerLeave={() => setHover(null)}>
          <defs>
            <clipPath id="moonmap-tiles">
              <rect x={0} width={W} y={Y(TILE_LAT_LIMIT)} height={Y(-TILE_LAT_LIMIT) - Y(TILE_LAT_LIMIT)} />
            </clipPath>
          </defs>
          <rect width={W} height={H} className="far" />
          <image href={baseMapUrl(MOON)} x={X(-180)} y={Y(90)} width={X(180) - X(-180)} height={Y(-90) - Y(90)}
            preserveAspectRatio="none" />
          <g clipPath="url(#moonmap-tiles)">
            {tiles.map((t) => (
              <image key={t.key} href={t.href} x={X(t.lon)} y={Y(t.lat)} width={X(t.lon + t.span) - X(t.lon)}
                height={Y(t.lat - t.span) - Y(t.lat)} preserveAspectRatio="none" />
            ))}
          </g>
          {/* the far side (never seen from Earth) a little darker */}
          <rect x={X(-180)} y={0} width={Math.max(0, X(-90) - X(-180))} height={H} className="far-shade" />
          <rect x={X(90)} y={0} width={Math.max(0, X(180) - X(90))} height={H} className="far-shade" />

          {meridians.map((l) => inX(X(l)) && (
            <line key={'m' + l} x1={X(l)} x2={X(l)} y1={0} y2={H} className={l === 0 || Math.abs(l) === 90 ? 'grid main' : 'grid'} />
          ))}
          {parallels.map((l) => inY(Y(l)) && (
            <line key={'p' + l} y1={Y(l)} y2={Y(l)} x1={0} x2={W} className={l === 0 ? 'grid main' : 'grid'} />
          ))}
          {meridians.filter((l) => l % (gridStep * 2) === 0 && inX(X(l))).map((l) => (
            <text key={'tl' + l} x={X(l) + 3} y={H - 5} className="axis">{l}°</text>
          ))}
          {parallels.filter((l) => l % (gridStep * 2) === 0 && inY(Y(l))).map((l) => (
            <text key={'tp' + l} x={4} y={Y(l) - 3} className="axis">{l}°</text>
          ))}
          {k === 1 && (
            <>
              <text x={X(0)} y={16} className="side" textAnchor="middle">near side (visible from Earth)</text>
              <text x={X(-135)} y={16} className="side" textAnchor="middle">far side</text>
              <text x={X(135)} y={16} className="side" textAnchor="middle">far side</text>
            </>
          )}

          {sites.map((s) => (
            <g key={s.id} className={s.id === siteId ? 'site active' : 'site'}
              onClick={(e) => { e.stopPropagation(); onPick({ lat: s.lat, lon: s.lon }); }}>
              <circle cx={X(s.lon)} cy={Y(s.lat)} r={4.5} />
              <title>{`${s.name} (${s.year}) – ${s.lat}°, ${s.lon}°`}</title>
            </g>
          ))}

          {others.map((o) => (
            <g key={o.key} className="alt">
              <circle cx={X(o.lon)} cy={Y(o.lat)} r={5.5} />
              <text x={X(o.lon) + 8} y={Y(o.lat) + 4}>{o.letter}</text>
              <title>{`${o.label} – ${o.lat.toFixed(4)}°, ${o.lon.toFixed(4)}°${o.note ? ` (${o.note})` : ''}`}</title>
            </g>
          ))}

          <g className="cursor" pointerEvents="none">
            <circle cx={X(lon)} cy={Y(lat)} r={9} />
            <line x1={X(lon) - 14} x2={X(lon) + 14} y1={Y(lat)} y2={Y(lat)} />
            <line y1={Y(lat) - 14} y2={Y(lat) + 14} x1={X(lon)} x2={X(lon)} />
          </g>
        </svg>
        <div className="map-zoom">
          <button type="button" onClick={() => zoomBy(2)} disabled={k >= MAX_ZOOM} title="Zoom in (or mouse wheel)" aria-label="Zoom in">+</button>
          <button type="button" onClick={() => zoomBy(0.5)} disabled={k <= 1} title="Zoom out" aria-label="Zoom out">−</button>
          <button type="button" onClick={() => setView(clampView({ zoom: Math.max(k, 6), cx: (lon + 180) * 2, cy: (90 - lat) * 2 }))}
            title="Zoom to the selected location" aria-label="Zoom to the selected location">◎</button>
          <button type="button" onClick={() => setView(FULL)} disabled={k <= 1} title="Whole Moon" aria-label="Whole Moon">⤢</button>
        </div>
      </div>
      <div className="maplegend">
        <span><i className="dot site" /> landing sites</span>
        <span><i className="dot cur" /> selected location</span>
        {others.length > 0 && <span><i className="dot alt" /> the mission's other landings</span>}
        <span className="muted">{hover ? `cursor: ${hover.lat}°, ${hover.lon}°` : 'wheel to zoom · drag to pan'}</span>
      </div>
    </div>
  );
}
