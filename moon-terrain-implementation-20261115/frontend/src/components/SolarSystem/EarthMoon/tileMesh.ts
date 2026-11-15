import { BufferAttribute, BufferGeometry, Vector3 } from 'three'
import { latLonToLocal } from '../sitePosition'
import { clampToCap, toLatLon, type TileBounds, type TileSource } from './tileSources'
import { MOON_RADIUS_M, moonNormal, moonPosition } from './moonTerrain'

export function buildTileGeometry(source: TileSource, drawn: TileBounds, flattening: number) {
  const lunar = source.id !== 'earth'
  const segments = lunar ? 32 : 16
  const n = segments + 1
  const border: number[] = []
  if (lunar) {
    for (let j = 0; j < n; j++) border.push(j)
    for (let i = 1; i < n; i++) border.push(i * n + segments)
    for (let j = segments - 1; j >= 0; j--) border.push(segments * n + j)
    for (let i = segments - 1; i > 0; i--) border.push(i * n)
  }
  const count = n * n + border.length
  const positions = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  const mapXY = new Float64Array(count * 2)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const [x, y] = clampToCap(
        source,
        drawn.left + j / segments * (drawn.right - drawn.left),
        drawn.bottom + i / segments * (drawn.top - drawn.bottom),
      )
      const [lat, lon] = toLatLon(source, x, y)
      const k = i * n + j
      positions.set(lunar ? moonPosition(lat, lon) : latLonToLocal(lat, lon, 1, flattening), k * 3)
      const a = lat * Math.PI / 180, b = lon * Math.PI / 180
      normals.set(lunar ? moonNormal(lat, lon) : [Math.cos(a) * Math.cos(b), Math.sin(a), -Math.cos(a) * Math.sin(b)], k * 3)
      mapXY.set([x, y], k * 2)
    }
  }
  const indices: number[] = []
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * n + j, b = a + 1, c = a + n, d = c + 1
      indices.push(a, b, d, a, d, c)
    }
  }
  const topTriangles = indices.length / 3
  if (lunar) {
    const first = new Vector3().fromArray(positions, 0)
    const last = new Vector3().fromArray(positions, (n * n - 1) * 3)
    const spanM = first.distanceTo(last) * MOON_RADIUS_M
    const depth = Math.min(12000, Math.max(2, spanM * 0.04)) / MOON_RADIUS_M
    for (let i = 0; i < border.length; i++) {
      const original = border[i], k = n * n + i
      const p = new Vector3().fromArray(positions, original * 3)
      p.setLength(Math.max(0.9, p.length() - depth))
      positions.set(p.toArray(), k * 3)
      normals.set(normals.subarray(original * 3, original * 3 + 3), k * 3)
      mapXY.set(mapXY.subarray(original * 2, original * 2 + 2), k * 2)
      const next = (i + 1) % border.length
      indices.push(original, k, n * n + next, original, n * n + next, border[next])
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(count * 2), 2))
  geometry.setIndex(indices)
  geometry.userData.mapXY = mapXY
  geometry.userData.surfaceTriangles = topTriangles
  geometry.computeBoundingSphere()
  return geometry
}
export function setImageArea(geometry: BufferGeometry, image: TileBounds) {
  const mapXY = geometry.userData.mapXY as Float64Array
  const uv = geometry.getAttribute('uv') as BufferAttribute
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i,
      (mapXY[i * 2] - image.left) / (image.right - image.left),
      (mapXY[i * 2 + 1] - image.bottom) / (image.top - image.bottom),
    )
  }
  uv.needsUpdate = true
}
