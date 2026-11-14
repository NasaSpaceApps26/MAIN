/**
 * Where the Sun and the Moon are in the sky of a place on Earth at a given moment.
 * Low-precision formulas from the Astronomical Almanac: about 0.01° for the Sun and a few tenths of
 * a degree for the Moon, plenty for drawing the sky.
 */

const RAD = Math.PI / 180

/** Direction in the sky: azimuth from north toward east, elevation above the horizon (degrees). */
export type SkyPosition = { az: number; el: number }

/** Days since the J2000.0 epoch (2000-01-01 12:00 TT). */
const daysSinceJ2000 = (timeMs: number) => timeMs / 86_400_000 + 2440587.5 - 2451545.0

const sinD = (deg: number) => Math.sin(deg * RAD)
const cosD = (deg: number) => Math.cos(deg * RAD)

/** Right ascension and declination (degrees) from ecliptic longitude and latitude. */
function toEquatorial(lambda: number, beta: number, n: number) {
  const eps = 23.439 - 0.0000004 * n
  const x = cosD(beta) * cosD(lambda)
  const y = cosD(eps) * cosD(beta) * sinD(lambda) - sinD(eps) * sinD(beta)
  const z = sinD(eps) * cosD(beta) * sinD(lambda) + cosD(eps) * sinD(beta)
  return { ra: Math.atan2(y, x) / RAD, dec: Math.asin(z) / RAD }
}

/** Azimuth and elevation of a body with the given RA / declination, seen from lat / lon (east +). */
function toHorizontal(ra: number, dec: number, n: number, lat: number, lon: number): SkyPosition {
  const gmst = 280.46061837 + 360.98564736629 * n // sidereal time at Greenwich, degrees
  const h = (gmst + lon - ra) * RAD // hour angle
  const phi = lat * RAD
  const d = dec * RAD
  const el = Math.asin(Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(h))
  const az = Math.atan2(
    -Math.sin(h) * Math.cos(d),
    Math.sin(d) * Math.cos(phi) - Math.cos(d) * Math.sin(phi) * Math.cos(h),
  )
  return { az: (((az / RAD) % 360) + 360) % 360, el: el / RAD }
}

export function sunPosition(timeMs: number, lat: number, lon: number): SkyPosition {
  const n = daysSinceJ2000(timeMs)
  const L = 280.46 + 0.9856474 * n // mean longitude
  const g = 357.528 + 0.9856003 * n // mean anomaly
  const lambda = L + 1.915 * sinD(g) + 0.02 * sinD(2 * g)
  const { ra, dec } = toEquatorial(lambda, 0, n)
  return toHorizontal(ra, dec, n, lat, lon)
}

export function moonPosition(timeMs: number, lat: number, lon: number): SkyPosition {
  const n = daysSinceJ2000(timeMs)
  const T = n / 36525
  const lambda =
    218.32 +
    481267.881 * T +
    6.29 * sinD(135.0 + 477198.87 * T) -
    1.27 * sinD(259.3 - 413335.36 * T) +
    0.66 * sinD(235.7 + 890534.22 * T) +
    0.21 * sinD(269.9 + 954397.74 * T) -
    0.19 * sinD(357.5 + 35999.05 * T) -
    0.11 * sinD(186.5 + 966404.03 * T)
  const beta =
    5.13 * sinD(93.3 + 483202.02 * T) +
    0.28 * sinD(228.2 + 960400.89 * T) -
    0.28 * sinD(318.3 + 6003.15 * T) -
    0.17 * sinD(217.6 - 407332.21 * T)
  const { ra, dec } = toEquatorial(lambda, beta, n)
  const p = toHorizontal(ra, dec, n, lat, lon)
  // the Moon is close: seen from the ground it sits up to ~1° lower than from Earth's centre
  return { az: p.az, el: p.el - 0.95 * cosD(p.el) }
}
