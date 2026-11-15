/**
 * Point on a body's surface for a latitude/longitude, in the body's own (unrotated) frame.
 *  - +Y is the north pole
 *  - longitude 0 points to +X, longitude 90°E to -Z
 * This matches how three.js wraps an equirectangular map (like the NASA ones) around a sphere,
 * so a dot lands on the right spot of the texture.
 * Works on flattened bodies too: latitude is measured the way maps give it (geodetic).
 */
export function latLonToLocal(
  latDeg: number,
  lonDeg: number,
  equatorialRadius: number,
  flattening = 0,
): [number, number, number] {
  const lat = (latDeg * Math.PI) / 180
  const lon = (lonDeg * Math.PI) / 180
  const e2 = flattening * (2 - flattening) // how oval the body is (eccentricity squared)
  const n = equatorialRadius / Math.sqrt(1 - e2 * Math.sin(lat) ** 2)
  return [
    n * Math.cos(lat) * Math.cos(lon),
    n * (1 - e2) * Math.sin(lat),
    -n * Math.cos(lat) * Math.sin(lon),
  ]
}
