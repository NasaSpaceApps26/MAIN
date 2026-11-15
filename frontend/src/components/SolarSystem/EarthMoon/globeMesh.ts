import { deformMoonGeometry } from './moonTerrain'
import { BufferAttribute, BufferGeometry } from 'three'
import { latLonToLocal } from '../sitePosition'

const LON_SEGMENTS = 256
const BAND_ROWS = 64
const CAP_ROWS = 48
const DEG = Math.PI / 180

export function buildBandGeometry(flattening: number, capLat: number, lunar = false) {
  const lats = Array.from(
    { length: BAND_ROWS + 1 },
    (_, i) => -capLat + (2 * capLat * i) / BAND_ROWS,
  )

  return buildGrid(lats, flattening, (lat, lon) => [(lon + 180) / 360, (lat + 90) / 180], lunar)
}

export function buildCapGeometry(flattening: number, capLat: number, pole: 'north' | 'south', lunar = false) {

  const edge = Math.tan((45 - capLat / 2) * DEG)
  const fromMiddle = (lat: number) => Math.tan((45 - Math.abs(lat) / 2) * DEG) / edge

  const lats: number[] = []
  for (let i = 0; i <= CAP_ROWS; i++) {
    const absLat = 90 - (2 * Math.atan((i / CAP_ROWS) * edge)) / DEG
    lats.push(pole === 'north' ? absLat : -absLat)
  }
  lats.sort((a, b) => a - b)
  return buildGrid(lats, flattening, (lat, lon) => {

    const r = fromMiddle(lat)
    const x = r * Math.sin(lon * DEG)
    const y = (pole === 'north' ? -r : r) * Math.cos(lon * DEG)
    return [0.5 + x / 2, 0.5 + y / 2]
  }, lunar)
}

function buildGrid(
  lats: number[],
  flattening: number,
  uvOf: (lat: number, lon: number) => [number, number],
  lunar = false,
) {
  const n = LON_SEGMENTS + 1
  const count = lats.length * n
  const positions = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  const uvs = new Float32Array(count * 2)

  lats.forEach((lat, i) => {
    const cosLat = Math.cos(lat * DEG)
    for (let j = 0; j < n; j++) {
      const lon = -180 + (360 * j) / LON_SEGMENTS
      const k = i * n + j
      positions.set(latLonToLocal(lat, lon, 1, flattening), k * 3)

      normals.set(
        [cosLat * Math.cos(lon * DEG), Math.sin(lat * DEG), -cosLat * Math.sin(lon * DEG)],
        k * 3,
      )
      uvs.set(uvOf(lat, lon), k * 2)
    }
  })

  const indices: number[] = []
  for (let i = 0; i < lats.length - 1; i++) {
    for (let j = 0; j < LON_SEGMENTS; j++) {
      const sw = i * n + j
      const se = sw + 1
      const nw = sw + n
      const ne = nw + 1
      indices.push(sw, se, ne, sw, ne, nw)
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  if (lunar) deformMoonGeometry(geometry)
  return geometry
}

