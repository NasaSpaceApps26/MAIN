import { useEffect, useRef, useState, type PointerEvent } from 'react'
import type { Site } from '../../api/types'
import { moonHeight, useMoonTerrain } from '../../components/SolarSystem/EarthMoon/moonTerrain'
import { M_PER_DEG, offsetLatLon, slopeAt } from './terrainMath'
import styles from './ReliefMap.module.css'

const N = 256 // the map is drawn N × N pixels and scaled to the box
const MIN_SPAN_KM = 15 // the height grid is ~1.9 km, closer than this shows nothing new
const MAX_SPAN_KM = 600
const Z_EXAGGERATION = 3 // shading only: lunar relief looks flat at true scale
const DEG = Math.PI / 180
// light from the north-west, 45° up (the usual hillshade convention)
const LIGHT = { east: -Math.SQRT1_2 * Math.SQRT1_2, north: Math.SQRT1_2 * Math.SQRT1_2, up: Math.SQRT1_2 }

export type MapLayer = 'relief' | 'slope'

type View = { lat: number; lon: number; spanKm: number }

type Mark = { lat: number; lon: number; label: string }

type Props = {
  lat: number // the landing point being looked at (yellow cross)
  lon: number
  others?: Mark[] // the mission's other landing points (orange)
  sites?: Site[] // named lunar sites, drawn when they are in view
  onPick: (lat: number, lon: number) => void // a click (not a drag) on the map
}

/** Map pixel → latitude/longitude, for a view centred on (lat, lon). */
function pixelToLatLon(view: View, px: number, py: number) {
  const kmPerPx = view.spanKm / N
  return offsetLatLon(view.lat, view.lon, (N / 2 - py) * kmPerPx, (px - N / 2) * kmPerPx)
}

/** Latitude/longitude → map pixel (inverse of pixelToLatLon). */
function latLonToPixel(view: View, lat: number, lon: number) {
  const kmPerPx = view.spanKm / N
  const dLon = ((lon - view.lon + 540) % 360) - 180
  const northKm = ((lat - view.lat) * M_PER_DEG) / 1000
  const eastKm = (dLon * M_PER_DEG * Math.max(0.02, Math.cos(lat * DEG))) / 1000
  return { x: N / 2 + eastKm / kmPerPx, y: N / 2 - northKm / kmPerPx }
}

/** Colour for a slope: green = easy for a lander, red = too steep. */
function slopeColour(deg: number): [number, number, number] {
  if (deg < 5) return [61, 220, 132]
  if (deg < 10) return [200, 225, 70]
  if (deg < 15) return [255, 160, 60]
  return [255, 80, 70]
}

/** Draws the heights of the view into the canvas: hillshaded relief, or slope classes. */
function draw(canvas: HTMLCanvasElement, view: View, layer: MapLayer) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  // heights with a one-pixel border, so every pixel has neighbours for its slope
  const W = N + 2
  const h = new Float32Array(W * W)
  let lo = Infinity
  let hi = -Infinity
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const p = pixelToLatLon(view, x - 1 + 0.5, y - 1 + 0.5)
      const v = moonHeight(p.lat, p.lon)
      h[y * W + x] = v
      lo = Math.min(lo, v)
      hi = Math.max(hi, v)
    }
  }
  const pxM = (view.spanKm * 1000) / N
  const img = ctx.createImageData(N, N)
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = (y + 1) * W + (x + 1)
      const dEast = (h[i + 1] - h[i - 1]) / (2 * pxM)
      const dNorth = (h[i - W] - h[i + W]) / (2 * pxM)
      // lit by the light: surface normal · light direction (heights exaggerated for the shading)
      const ex = -dEast * Z_EXAGGERATION
      const ey = -dNorth * Z_EXAGGERATION
      const shade = Math.max(0, (ex * LIGHT.east + ey * LIGHT.north + LIGHT.up) / Math.hypot(ex, ey, 1))
      let r: number, g: number, b: number
      if (layer === 'slope') {
        const [sr, sg, sb] = slopeColour(Math.atan(Math.hypot(dEast, dNorth)) / DEG)
        const k = 0.45 + 0.55 * shade
        r = sr * k
        g = sg * k
        b = sb * k
      } else {
        // grey hillshade, a little bluer in the lows and warmer on the highs
        const t = hi > lo ? (h[i] - lo) / (hi - lo) : 0.5
        const grey = 40 + 200 * shade
        r = grey * (0.86 + 0.2 * t)
        g = grey * (0.9 + 0.1 * t)
        b = grey * (1.02 - 0.12 * t)
      }
      const o = (y * N + x) * 4
      img.data[o] = r
      img.data[o + 1] = g
      img.data[o + 2] = b
      img.data[o + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
}

/** A round length for the scale bar, about a quarter of the map. */
function scaleBarKm(spanKm: number) {
  const target = spanKm / 4
  return [1, 2, 5, 10, 20, 50, 100, 200].reduce((best, v) => (Math.abs(v - target) < Math.abs(best - target) ? v : best))
}

/**
 * Top-down map of the area around the landing point, from the LOLA heights the app already loads.
 * Drag to move, mouse wheel or ± to zoom, click to move the landing point there.
 * Relief: hillshade (lit from the north-west). Slope: green < 5°, yellow < 10°, orange < 15°, red steeper.
 */
export function ReliefMap({ lat, lon, others = [], sites = [], onPick }: Props) {
  const terrain = useMoonTerrain(true)
  const canvas = useRef<HTMLCanvasElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>({ lat, lon, spanKm: 120 })
  const [layer, setLayer] = useState<MapLayer>('relief')
  const [hover, setHover] = useState<{ lat: number; lon: number; el: number; slope: number } | null>(null)
  const drag = useRef<{ x: number; y: number; moved: boolean; view: View } | null>(null)
  const ready = terrain.phase === 'ready'

  useEffect(() => {
    if (ready && canvas.current) draw(canvas.current, view, layer)
  }, [ready, view, layer])

  // Mouse wheel zoom (a native listener: React's wheel events can't stop the window from scrolling)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const k = e.deltaY > 0 ? 1.25 : 0.8
      setView((v) => ({ ...v, spanKm: Math.min(MAX_SPAN_KM, Math.max(MIN_SPAN_KM, v.spanKm * k)) }))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  /** Pointer position → map pixel. */
  const toPixel = (e: PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * N, y: ((e.clientY - r.top) / r.height) * N }
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, moved: false, view }
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (d) {
      const dx = e.clientX - d.x
      const dy = e.clientY - d.y
      if (Math.hypot(dx, dy) > 3) d.moved = true
      if (d.moved) {
        const kmPerCssPx = d.view.spanKm / e.currentTarget.getBoundingClientRect().width
        const c = offsetLatLon(d.view.lat, d.view.lon, dy * kmPerCssPx, -dx * kmPerCssPx)
        setView({ ...d.view, lat: c.lat, lon: c.lon })
      }
    }
    if (!ready) return
    const p = toPixel(e)
    const ll = pixelToLatLon(view, p.x, p.y)
    setHover({ lat: ll.lat, lon: ll.lon, el: moonHeight(ll.lat, ll.lon), slope: slopeAt(ll.lat, ll.lon).slopeDeg })
  }

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = null
    if (!d || d.moved || !ready) return
    const p = toPixel(e)
    const ll = pixelToLatLon(view, p.x, p.y)
    onPick(ll.lat, ll.lon)
  }

  const zoom = (k: number) =>
    setView((v) => ({ ...v, spanKm: Math.min(MAX_SPAN_KM, Math.max(MIN_SPAN_KM, v.spanKm * k)) }))

  const landing = latLonToPixel(view, lat, lon)
  const barKm = scaleBarKm(view.spanKm)
  const barPx = (barKm / view.spanKm) * N
  const inView = (p: { x: number; y: number }) => p.x >= 0 && p.x <= N && p.y >= 0 && p.y <= N

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <span className={styles.seg} role="group" aria-label="Map layer">
          {(['relief', 'slope'] as const).map((l) => (
            <button key={l} type="button" aria-pressed={layer === l} className={layer === l ? styles.on : ''}
              onClick={() => setLayer(l)}>
              {l === 'relief' ? 'Relief' : 'Slope'}
            </button>
          ))}
        </span>
        <span className={styles.seg}>
          <button type="button" onClick={() => zoom(0.8)} aria-label="Zoom in">＋</button>
          <button type="button" onClick={() => zoom(1.25)} aria-label="Zoom out">－</button>
          <button type="button" onClick={() => setView((v) => ({ ...v, lat, lon }))} title="Centre on the landing point">◎</button>
        </span>
      </div>

      <div
        ref={box}
        className={styles.map}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)}
      >
        <canvas ref={canvas} width={N} height={N} className={styles.canvas} />
        <svg viewBox={`0 0 ${N} ${N}`} className={styles.overlay} aria-hidden>
          {sites.map((s) => {
            const p = latLonToPixel(view, s.lat_deg, s.lon_deg)
            return inView(p) ? (
              <g key={s.id}>
                <circle cx={p.x} cy={p.y} r={2.5} className={styles.site} />
                <text x={p.x + 4} y={p.y + 3} className={styles.siteLabel}>{s.name}</text>
              </g>
            ) : null
          })}
          {others.map((m, i) => {
            const p = latLonToPixel(view, m.lat, m.lon)
            return inView(p) ? (
              <g key={i} className={styles.other}>
                <circle cx={p.x} cy={p.y} r={4.5} />
                <text x={p.x + 7} y={p.y + 3}>{m.label}</text>
              </g>
            ) : null
          })}
          {inView(landing) && (
            <g className={styles.landing}>
              <circle cx={landing.x} cy={landing.y} r={6} />
              <line x1={landing.x - 10} x2={landing.x + 10} y1={landing.y} y2={landing.y} />
              <line x1={landing.x} x2={landing.x} y1={landing.y - 10} y2={landing.y + 10} />
            </g>
          )}
          <g className={styles.scale}>
            <line x1={8} x2={8 + barPx} y1={N - 10} y2={N - 10} />
            <text x={8} y={N - 14}>{barKm} km</text>
          </g>
          <text x={N - 8} y={14} textAnchor="end" className={styles.north}>N ↑</text>
        </svg>
        {!ready && (
          <div className={styles.loading}>
            {terrain.phase === 'error' ? 'Moon terrain could not load.' : `Loading Moon terrain… ${Math.round(terrain.progress * 100)}%`}
          </div>
        )}
      </div>

      <div className={styles.legend}>
        {hover ? (
          <span>
            {hover.lat.toFixed(3)}°, {hover.lon.toFixed(3)}° · {Math.round(hover.el)} m · slope {hover.slope.toFixed(1)}°
          </span>
        ) : (
          <span>{Math.round(view.spanKm)} km across · drag to move · click to land there</span>
        )}
        {layer === 'slope' && (
          <span className={styles.keys}>
            <i style={{ background: 'rgb(61,220,132)' }} />&lt;5°
            <i style={{ background: 'rgb(200,225,70)' }} />&lt;10°
            <i style={{ background: 'rgb(255,160,60)' }} />&lt;15°
            <i style={{ background: 'rgb(255,80,70)' }} />steeper
          </span>
        )}
      </div>
    </div>
  )
}
