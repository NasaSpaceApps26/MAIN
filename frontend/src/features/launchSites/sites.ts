export type LaunchSiteId = 'ksc' | 'ccsfs' | 'vandenberg' | 'wallops'

/** Pad in a site's model whose rocket can be launched from the window. */
export type LaunchPad = {
  id: string
  name: string
  rocket: string // what stands on it
}

export type LaunchSite = {
  id: LaunchSiteId
  name: string
  lat: number // geodetic latitude, degrees
  lon: number // east longitude, degrees
  description: string
  features: string[] // what the 3D model shows
  pads: LaunchPad[]
}

/** NASA launch sites. */
export const LAUNCH_SITES: readonly LaunchSite[] = [
  {
    id: 'ksc',
    name: 'Kennedy Space Center',
    lat: 28.6082,
    lon: -80.6041,
    description:
      "NASA's spaceport on Merritt Island, Florida. Saturn V, Space Shuttle and Artemis rockets were stacked in the Vehicle Assembly Building and carried to Launch Complex 39 by the crawler.",
    features: [
      'Vehicle Assembly Building',
      'Launch Control Center',
      'Crawlerway with a crawler-transporter and mobile launcher',
      'LC-39A with a Saturn V on its mobile launcher and red launch umbilical tower',
      'LC-39B with a second Saturn V, lightning towers and water tower',
      'Turning basin',
    ],
    pads: [
      { id: '39a', name: 'LC-39A', rocket: 'Saturn V' },
      { id: '39b', name: 'LC-39B', rocket: 'Saturn V' },
    ],
  },
  {
    id: 'ccsfs',
    name: 'Cape Canaveral Space Force Station',
    lat: 28.4889,
    lon: -80.5778,
    description:
      'U.S. Space Force station on the cape south of Kennedy. Explorer 1, the first U.S. satellite, and the Mercury and Gemini crews launched from here. Today its pads line the Atlantic coast.',
    features: [
      'SLC-41 with its Vertical Integration Facility and rail track',
      'SLC-40 with service tower and four lightning towers',
      'SLC-37 with its mobile service tower',
      'Cape Canaveral Lighthouse',
    ],
    pads: [
      { id: 'slc41', name: 'SLC-41', rocket: 'Saturn V' },
      { id: 'slc40', name: 'SLC-40', rocket: 'Saturn V' },
      { id: 'slc37', name: 'SLC-37', rocket: 'Saturn V' },
    ],
  },
  {
    id: 'vandenberg',
    name: 'Vandenberg Space Force Base',
    lat: 34.742,
    lon: -120.5724,
    description:
      'On the California coast. Rockets fly south over the Pacific, so it is used for polar and Sun-synchronous orbits, which cannot be reached safely from Florida.',
    features: [
      'Coastal hills and cliffs above the Pacific',
      'SLC-4E pad with hangar and lightning towers',
      'Landing Zone 4',
      'SLC-6 with its mobile service tower',
    ],
    pads: [
      { id: 'slc4e', name: 'SLC-4E', rocket: 'Saturn V' },
      { id: 'slc6', name: 'SLC-6', rocket: 'Saturn V' },
    ],
  },
  {
    id: 'wallops',
    name: 'Wallops Flight Facility',
    lat: 37.8433,
    lon: -75.4781,
    description:
      "NASA Goddard's launch range on Virginia's Eastern Shore, flying sounding rockets since 1945. Orbital rockets launch from the Mid-Atlantic Regional Spaceport pads on Wallops Island.",
    features: [
      'Wallops Island barrier beach and marsh',
      'Pad 0A and Pad 0B',
      'Launch Complex 2 for small rockets',
      'Rail launchers for sounding rockets',
      'Radar domes, causeway and the main base runway',
    ],
    pads: [
      { id: '0a', name: 'Pad 0A', rocket: 'Saturn V' },
      { id: '0b', name: 'Pad 0B', rocket: 'Saturn V' },
      { id: 'lc2', name: 'Launch Complex 2', rocket: 'Saturn V' },
    ],
  },
]

export const siteById = (id: LaunchSiteId) => LAUNCH_SITES.find((s) => s.id === id)!

/** Sites closer than this to the clicked one are shown together (their dots overlap on the globe). */
export const NEARBY_KM = 50
const EARTH_RADIUS_KM = 6371
const DEG = Math.PI / 180

/** Great-circle distance in km (haversine). */
export function distanceKm(a: LaunchSite, b: LaunchSite) {
  const dLat = (b.lat - a.lat) * DEG
  const dLon = (b.lon - a.lon) * DEG
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h))
}

/** The site plus every site within NEARBY_KM of it, north to south. */
export function nearbySites(id: LaunchSiteId) {
  const site = siteById(id)
  return LAUNCH_SITES.filter((s) => distanceKm(site, s) <= NEARBY_KM).sort((a, b) => b.lat - a.lat)
}

export const formatCoord = (v: number) => v.toFixed(3).replace('-', '−')
