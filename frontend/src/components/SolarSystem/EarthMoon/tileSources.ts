import { BASE } from '../../../api/client'

export type TileSource = {
  id: 'earth' | 'moon' | 'moon_south' | 'moon_north'
  projection: 'latlon' | 'polar'
  pole?: 'north' | 'south'
  tilePx: number
  level0Span: number
  origin: [number, number]
  minLevel: number
  maxLevel: number
  baseMapCoversMinLevel: boolean
  radiusM: number
  clipPolewardOf?: number
  capRadius?: number
}

export const CAP_LAT = 60

const POLAR_START_LAT = 78
const MOON_RADIUS_M = 1_737_400
const EARTH_RADIUS_M = 6_378_137
const DEG = Math.PI / 180

function polarDistance(
  absLatDeg: number,
  radiusM: number,
) {
  return (
    2 *
    radiusM *
    Math.tan(Math.PI / 4 - (absLatDeg * DEG) / 2)
  )
}

const moonPolar = (
  pole: 'north' | 'south',
): TileSource => ({
  id: pole === 'north' ? 'moon_north' : 'moon_south',
  projection: 'polar',
  pole,
  tilePx: 256,
  level0Span: 2_191_860,
  origin: [-1_095_930, 1_095_930],
  minLevel: 3,
  maxLevel: 14,
  baseMapCoversMinLevel: false,
  radiusM: MOON_RADIUS_M,
  capRadius: polarDistance(
    POLAR_START_LAT,
    MOON_RADIUS_M,
  ),
})

export const TILE_SOURCES: Record<
  TileSource['id'],
  TileSource
> = {
  moon: {
    id: 'moon',
    projection: 'latlon',
    tilePx: 256,
    level0Span: 180,
    origin: [-180, 90],
    minLevel: 3,
    maxLevel: 15,
    baseMapCoversMinLevel: true,
    radiusM: MOON_RADIUS_M,
    clipPolewardOf: POLAR_START_LAT,
  },
  moon_south: moonPolar('south'),
  moon_north: moonPolar('north'),
  earth: {
    id: 'earth',
    projection: 'latlon',
    tilePx: 512,
    level0Span: 288,
    origin: [-180, 90],
    minLevel: 3,
    maxLevel: 7,
    baseMapCoversMinLevel: true,
    radiusM: EARTH_RADIUS_M,
    clipPolewardOf: 80,
  },
}

export const BASE_MAP_WIDTH = 4096

export function metresPerPixel(
  source: TileSource,
  z: number,
) {
  const perPixel =
    source.level0Span / 2 ** z / source.tilePx

  return source.projection === 'latlon'
    ? perPixel * DEG * source.radiusM
    : perPixel
}

export const BODY_SOURCES: Record<
  'earth' | 'moon',
  TileSource[]
> = {
  earth: [TILE_SOURCES.earth],
  moon: [
    TILE_SOURCES.moon,
    TILE_SOURCES.moon_south,
    TILE_SOURCES.moon_north,
  ],
}

export type TileBounds = {
  left: number
  right: number
  bottom: number
  top: number
}

// Version 8 invalidates lunar images generated with the old grid.
const mapVersion = (source: TileSource) =>
  source.id === 'earth' ? 6 : 8

export const baseMapUrl = (source: TileSource) =>
  `${BASE}/surface/${source.id}/base.jpg?v=${mapVersion(source)}`

export const capUrl = (
  source: TileSource,
  pole: 'north' | 'south',
) =>
  `${BASE}/surface/${source.id}/caps/${pole}.jpg?v=${mapVersion(source)}`

export const tileUrl = (
  source: TileSource,
  z: number,
  row: number,
  col: number,
) =>
  `${BASE}/surface/${source.id}/${z}/${row}/${col}?v=${mapVersion(source)}`

export function tileGrid(
  source: TileSource,
  z: number,
) {
  if (source.projection === 'polar') {
    return {
      cols: 2 ** (z + 1),
      rows: 2 ** z,
    }
  }

  const span = source.level0Span / 2 ** z

  return {
    cols: Math.round(360 / span),
    rows: Math.round(180 / span),
  }
}

export function tileBounds(
  source: TileSource,
  z: number,
  row: number,
  col: number,
): TileBounds {
  const span = source.level0Span / 2 ** z
  const left = source.origin[0] + col * span
  const top = source.origin[1] - row * span

  return {
    left,
    right: left + span,
    bottom: top - span,
    top,
  }
}

export function drawnBounds(
  source: TileSource,
  b: TileBounds,
): TileBounds | null {
  if (source.clipPolewardOf !== undefined) {
    const limit = source.clipPolewardOf

    if (
      b.bottom >= limit ||
      b.top <= -limit
    ) {
      return null
    }

    return {
      ...b,
      top: Math.min(b.top, limit),
      bottom: Math.max(b.bottom, -limit),
    }
  }

  if (source.capRadius !== undefined) {
    const x = Math.max(
      b.left,
      Math.min(0, b.right),
    )
    const y = Math.max(
      b.bottom,
      Math.min(0, b.top),
    )

    if (
      Math.hypot(x, y) >= source.capRadius
    ) {
      return null
    }
  }

  return b
}

export function clampToCap(
  source: TileSource,
  x: number,
  y: number,
): [number, number] {
  const r = Math.hypot(x, y)

  if (
    source.capRadius === undefined ||
    r <= source.capRadius
  ) {
    return [x, y]
  }

  return [
    (x * source.capRadius) / r,
    (y * source.capRadius) / r,
  ]
}

export function toLatLon(
  source: TileSource,
  x: number,
  y: number,
): [number, number] {
  if (source.projection === 'latlon') {
    return [y, x]
  }

  const fromPole =
    (2 *
      Math.atan(
        Math.hypot(x, y) /
          (2 * source.radiusM),
      )) /
    DEG

  if (source.pole === 'north') {
    return [
      90 - fromPole,
      Math.atan2(x, -y) / DEG,
    ]
  }

  return [
    fromPole - 90,
    Math.atan2(x, y) / DEG,
  ]
}