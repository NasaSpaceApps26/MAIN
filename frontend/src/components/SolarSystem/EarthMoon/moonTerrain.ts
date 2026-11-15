import { useEffect, useSyncExternalStore } from 'react'
import { Vector3, type BufferGeometry } from 'three'
import { BASE } from '../../../api/client'
import { useSimStore } from '../../../store/simStore'
import { moonReliefScale } from '../scale'

export const MOON_RADIUS_M = 1_737_400
export type MoonPoint = {
  latDeg: number
  lonDeg: number
  elevationM: number
  datasetId: string
}
type Metadata = {
  dataset_id: string
  width: number
  height: number
  minimum_elevation_m: number
  maximum_elevation_m: number
  reference_radius_m: number
  encoding: string
}
type State = {
  phase: 'idle' | 'loading' | 'ready' | 'error'
  progress: number
  error?: string
}
let state: State = { phase: 'idle', progress: 0 }
let meta: Metadata | null = null
let pixels: Uint16Array | null = null
let northPole = 0
let southPole = 0
let pending: Promise<void> | null = null
const listeners = new Set<() => void>()
const publish = (next: State) => {
  state = next
  listeners.forEach((listener) => listener())
}
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export const terrainReady = () => state.phase === 'ready'
export const terrainDataset = () => meta?.dataset_id ?? 'not-loaded'
export const terrainMinimum = () => meta?.minimum_elevation_m ?? 0
export const terrainMaximum = () => meta?.maximum_elevation_m ?? 0
/** How many times taller the terrain is DRAWN than in reality (follows the planet size buttons) */
export const terrainExaggeration = () => moonReliefScale(useSimStore.getState().planetSize)
/** Biggest drawn height or depth, as a fraction of the Moon's radius */
export const terrainRelief = () =>
  Math.max(Math.abs(terrainMinimum()), Math.abs(terrainMaximum())) * terrainExaggeration() / MOON_RADIUS_M

export function loadMoonTerrain(): Promise<void> {
  if (terrainReady()) return Promise.resolve()
  if (pending) return pending
  publish({ phase: 'loading', progress: 0 })
  pending = (async () => {
    try {
      const root = `${BASE}/terrain/moon/v1`
      const response = await fetch(`${root}/metadata.json`)
      if (!response.ok) throw new Error(`Elevation metadata HTTP ${response.status}`)
      const info = await response.json() as Metadata
      if (
        info.width !== 5760 || info.height !== 2880 ||
        info.reference_radius_m !== MOON_RADIUS_M ||
        info.encoding !== 'uint16-normalized-little-endian' ||
        !Number.isFinite(info.minimum_elevation_m) ||
        !Number.isFinite(info.maximum_elevation_m) ||
        info.maximum_elevation_m < info.minimum_elevation_m
      ) throw new Error('Unexpected elevation metadata')
      const data = await fetch(`${root}/heights.bin`)
      if (!data.ok) throw new Error(`Elevation data HTTP ${data.status}`)
      const expected = info.width * info.height * 2
      let buffer: ArrayBuffer
      if (data.body) {
        const result = new Uint8Array(expected)
        const reader = data.body.getReader()
        let offset = 0
        let lastUpdate = 0
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (offset + value.length > expected) {
            await reader.cancel()
            throw new Error('Elevation payload is too large')
          }
          result.set(value, offset)
          offset += value.length
          if (performance.now() - lastUpdate > 100) {
            publish({ phase: 'loading', progress: offset / expected })
            lastUpdate = performance.now()
          }
        }
        if (offset !== expected) throw new Error('Incomplete elevation payload')
        buffer = result.buffer
      } else {
        buffer = await data.arrayBuffer()
        if (buffer.byteLength !== expected) throw new Error('Incomplete elevation payload')
      }
      let grid = new Uint16Array(buffer)
      if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) {
        const view = new DataView(buffer)
        grid = new Uint16Array(expected / 2)
        for (let i = 0; i < grid.length; i++) grid[i] = view.getUint16(i * 2, true)
      }
      meta = info
      pixels = grid
      let north = 0, south = 0
      for (let col = 0; col < info.width; col++) {
        north += grid[col]
        south += grid[(info.height - 1) * info.width + col]
      }
      northPole = decode(north / info.width)
      southPole = decode(south / info.width)
      publish({ phase: 'ready', progress: 1 })
    } catch (error) {
      publish({
        phase: 'error', progress: 0,
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      pending = null
    }
  })()
  return pending
}
export function useMoonTerrain(enabled = true) {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => state)
  useEffect(() => { if (enabled) void loadMoonTerrain() }, [enabled])
  return snapshot
}
function decode(value: number) {
  if (!meta) return 0
  return meta.minimum_elevation_m +
    value / 65535 * (meta.maximum_elevation_m - meta.minimum_elevation_m)
}
export function moonHeight(latDeg: number, lonDeg: number): number {
  if (!meta || !pixels) return 0
  const { width: w, height: h } = meta
  const lat = Math.max(-90, Math.min(90, latDeg))
  const lon = ((lonDeg + 180) % 360 + 360) % 360
  const x = lon / 360 * w - 0.5
  const y = Math.max(0, Math.min(h - 1, (90 - lat) / 180 * h - 0.5))
  const ix = Math.floor(x), iy = Math.floor(y)
  const x0 = ((ix % w) + w) % w, x1 = (x0 + 1) % w
  const y1 = Math.min(h - 1, iy + 1)
  const fx = x - ix, fy = y - iy
  const top = pixels[iy * w + x0] * (1 - fx) + pixels[iy * w + x1] * fx
  const bottom = pixels[y1 * w + x0] * (1 - fx) + pixels[y1 * w + x1] * fx
  let value = decode(top * (1 - fy) + bottom * fy)
  const firstLatitude = 90 - 90 / h
  if (lat > firstLatitude) {
    const t = (lat - firstLatitude) / (90 - firstLatitude)
    value = value * (1 - t) + northPole * t
  } else if (lat < -firstLatitude) {
    const t = (-lat - firstLatitude) / (90 - firstLatitude)
    value = value * (1 - t) + southPole * t
  }
  return value
}
// moonHeight stays the REAL height (readouts, picked points). Only the drawn shape is stretched.
export function moonUnitRadius(lat: number, lon: number) {
  return 1 + moonHeight(lat, lon) * terrainExaggeration() / MOON_RADIUS_M
}
export function moonPosition(lat: number, lon: number, radius = 1, liftM = 0): [number, number, number] {
  const a = lat * Math.PI / 180, b = lon * Math.PI / 180
  const r = radius * (1 + (moonHeight(lat, lon) * terrainExaggeration() + liftM) / MOON_RADIUS_M)
  return [r * Math.cos(a) * Math.cos(b), r * Math.sin(a), -r * Math.cos(a) * Math.sin(b)]
}
const v1 = new Vector3(), v2 = new Vector3(), v3 = new Vector3(), v4 = new Vector3()
export function moonNormal(lat: number, lon: number): [number, number, number] {
  if (Math.abs(lat) > 89.999) return [0, Math.sign(lat), 0]
  const d = 0.005
  v1.fromArray(moonPosition(Math.min(90, lat + d), lon))
  v2.fromArray(moonPosition(Math.max(-90, lat - d), lon))
  v3.fromArray(moonPosition(lat, lon + d))
  v4.fromArray(moonPosition(lat, lon - d))
  v3.sub(v4).cross(v1.sub(v2)).normalize()
  return [v3.x, v3.y, v3.z]
}
/** Lowest real height (m) in each BLOCK × BLOCK patch of DEM pixels, built once on first use. */
const BLOCK = 4
let lowGrid: Float32Array | null = null
let lowGridOf: Uint16Array | null = null
function lowestGrid() {
  if (lowGrid && lowGridOf === pixels) return lowGrid
  if (!meta || !pixels) return null
  const cols = meta.width / BLOCK, rows = meta.height / BLOCK
  const grid = new Float32Array(cols * rows)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let low = 65535
      for (let y = r * BLOCK; y < (r + 1) * BLOCK; y++) {
        const row = y * meta.width
        for (let x = c * BLOCK; x < (c + 1) * BLOCK; x++) low = Math.min(low, pixels[row + x])
      }
      grid[r * cols + c] = decode(low)
    }
  }
  lowGrid = grid
  lowGridOf = pixels
  return grid
}

/**
 * Lowest real height (m) within ±halfLat × ±halfLon degrees of a point (whole DEM blocks, so no pit
 * is missed). Used for the backup globe, so its coarse triangles stay UNDER the detailed tiles.
 */
function lowestHeight(lat: number, lon: number, halfLat: number, halfLon: number) {
  const grid = lowestGrid()
  if (!grid || !meta) return moonHeight(lat, lon)
  const cols = meta.width / BLOCK, rows = meta.height / BLOCK
  const top = Math.max(0, Math.floor((90 - lat - halfLat) / 180 * rows))
  const bottom = Math.min(rows - 1, Math.floor((90 - lat + halfLat) / 180 * rows))
  const wholeRow = halfLon >= 180 || bottom === rows - 1 && lat - halfLat <= -89 || top === 0 && lat + halfLat >= 89
  const left = Math.floor(((lon - halfLon + 180) / 360) * cols)
  const right = Math.floor(((lon + halfLon + 180) / 360) * cols)
  let lowest = Infinity
  for (let r = top; r <= bottom; r++) {
    const row = r * cols
    if (wholeRow) {
      for (let c = 0; c < cols; c++) lowest = Math.min(lowest, grid[row + c])
    } else {
      for (let c = left; c <= right; c++) lowest = Math.min(lowest, grid[row + ((c % cols) + cols) % cols])
    }
  }
  return lowest
}

/**
 * Shapes the backup globe (a coarse grid, see globeMesh.ts) to the terrain. Each vertex takes the
 * LOWEST height around it (`halfLatOf(i)` / `halfLonDeg`: the grid spacing there), so every triangle
 * lies just under the real surface: the detailed tiles always cover it, but where a tile is missing
 * the step down to the backup globe is small instead of a cliff. Shading uses the real slope.
 */
export function deformMoonBackup(
  geometry: BufferGeometry, halfLatOf: (vertex: number) => number, halfLonDeg: number,
) {
  const positions = geometry.getAttribute('position')
  const normals = geometry.getAttribute('normal')
  const exaggeration = terrainExaggeration()
  for (let i = 0; i < positions.count; i++) {
    const lat = Math.asin(Math.max(-1, Math.min(1, normals.getY(i)))) * 180 / Math.PI
    const lon = Math.atan2(-normals.getZ(i), normals.getX(i)) * 180 / Math.PI
    // away from the equator a degree of longitude is shorter: widen the window to cover the same ground
    const halfLon = halfLonDeg / Math.max(0.02, Math.cos(lat * Math.PI / 180))
    const r = 1 + lowestHeight(lat, lon, halfLatOf(i), halfLon) * exaggeration / MOON_RADIUS_M
    const a = lat * Math.PI / 180, b = lon * Math.PI / 180
    positions.setXYZ(i, r * Math.cos(a) * Math.cos(b), r * Math.sin(a), -r * Math.cos(a) * Math.sin(b))
    normals.setXYZ(i, ...moonNormal(lat, lon))
  }
  positions.needsUpdate = true
  normals.needsUpdate = true
  geometry.computeBoundingSphere()
}

export function deformMoonGeometry(geometry: BufferGeometry) {
  const positions = geometry.getAttribute('position')
  const normals = geometry.getAttribute('normal')
  for (let i = 0; i < positions.count; i++) {
    const lat = Math.asin(Math.max(-1, Math.min(1, normals.getY(i)))) * 180 / Math.PI
    const lon = Math.atan2(-normals.getZ(i), normals.getX(i)) * 180 / Math.PI
    const p = moonPosition(lat, lon), n = moonNormal(lat, lon)
    positions.setXYZ(i, ...p)
    normals.setXYZ(i, ...n)
  }
  positions.needsUpdate = true
  normals.needsUpdate = true
  geometry.computeBoundingSphere()
}
