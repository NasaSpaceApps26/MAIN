/**
 * Special places on the Moon (blue dots): notable craters, basins, mountains, caves and where
 * rovers ended up. Coordinates: selenographic latitude / longitude in degrees, east positive.
 * Sources (checked 2026-11-15):
 *  - craters, mountains, maria, rilles: IAU/USGS Gazetteer of Planetary Nomenclature (feature centre and
 *    diameter), https://planetarynames.wr.usgs.gov/ (same names layer as Moon Trek and LROC QuickMap)
 *  - pits: LROC Pits Atlas, https://lroc.im-ldi.com/atlases/pits/list
 *  - Lunokhod 1 and 2: LROC, Wagner et al. 2016, https://lroc.im-ldi.com/images/938
 *  - South Pole–Aitken: no IAU entry; the centre is approximate, from the literature.
 */
export type MoonFeatureKind = 'crater' | 'basin' | 'mountain' | 'cave' | 'feature' | 'rover'

export type MoonFeature = {
  id: string
  name: string
  kind: MoonFeatureKind
  latDeg: number
  lonDeg: number
  /** size / height, shown under the name */
  detail: string
  /** One line: why it is special. */
  note: string
}

export const FEATURE_KIND_LABEL: Record<MoonFeatureKind, string> = {
  crater: 'crater',
  basin: 'impact basin',
  mountain: 'mountain',
  cave: 'pit / lava tube',
  feature: 'surface feature',
  rover: 'rover',
}

/** Prefix for a landing point's siteId when it was taken from one of these features. */
export const FEATURE_PREFIX = 'feature:'

export const MOON_FEATURES: MoonFeature[] = [
  // craters
  { id: 'tycho', name: 'Tycho', kind: 'crater', latDeg: -43.296, lonDeg: -11.215, detail: '85 km wide',
    note: 'Young (~108 million years) crater whose bright rays stretch across the near side.' },
  { id: 'copernicus', name: 'Copernicus', kind: 'crater', latDeg: 9.621, lonDeg: -20.079, detail: '96 km wide',
    note: '"Monarch of the Moon": terraced walls and central peaks, visible with binoculars.' },
  { id: 'aristarchus', name: 'Aristarchus', kind: 'crater', latDeg: 23.73, lonDeg: -47.49, detail: '40 km wide',
    note: 'The brightest large feature on the Moon, visible even on the night side in earthshine.' },
  { id: 'plato', name: 'Plato', kind: 'crater', latDeg: 51.619, lonDeg: -9.382, detail: '101 km wide',
    note: 'Crater with a flat, dark floor flooded by lava, like a lake.' },
  { id: 'clavius', name: 'Clavius', kind: 'crater', latDeg: -58.623, lonDeg: -14.727, detail: '231 km wide',
    note: 'One of the largest near-side craters; SOFIA found water molecules here in 2020.' },
  { id: 'shackleton', name: 'Shackleton', kind: 'crater', latDeg: -89.67, lonDeg: 129.78, detail: '21 km wide',
    note: 'At the south pole: rim almost always sunlit, floor never sunlit and holding ice. Artemis target area.' },
  { id: 'giordano-bruno', name: 'Giordano Bruno', kind: 'crater', latDeg: 35.969, lonDeg: 102.893, detail: '22 km wide',
    note: 'One of the youngest large craters (~4 million years), on the far side.' },
  { id: 'tsiolkovskiy', name: 'Tsiolkovskiy', kind: 'crater', latDeg: -20.379, lonDeg: 128.972, detail: '184 km wide',
    note: 'Rare far-side crater with a dark lava floor and a big central peak.' },
  // basins
  { id: 'orientale', name: 'Mare Orientale', kind: 'basin', latDeg: -19.866, lonDeg: -94.67, detail: 'basin ~930 km, mare 294 km',
    note: 'The best-preserved multi-ring "bullseye" basin, on the western edge of the near side.' },
  { id: 'spa', name: 'South Pole–Aitken basin', kind: 'basin', latDeg: -53.0, lonDeg: -169.0, detail: '~2500 km wide (centre approximate)',
    note: 'The largest and oldest known impact basin on the Moon; Chang\'e 6 brought samples from it.' },
  // mountains
  { id: 'mons-huygens', name: 'Mons Huygens', kind: 'mountain', latDeg: 19.919, lonDeg: -2.857, detail: '~5.5 km high',
    note: 'The highest peak of the Montes Apenninus range.' },
  { id: 'mons-hadley', name: 'Mons Hadley', kind: 'mountain', latDeg: 26.695, lonDeg: 4.118, detail: '~4.5 km high',
    note: 'The mountain that towered over the Apollo 15 crew at Hadley–Apennine.' },
  { id: 'mons-piton', name: 'Mons Piton', kind: 'mountain', latDeg: 40.717, lonDeg: -0.923, detail: '~2.3 km high',
    note: 'A lone peak in Mare Imbrium, all that sticks out of the old basin ring.' },
  { id: 'mons-rumker', name: 'Mons Rümker', kind: 'mountain', latDeg: 40.761, lonDeg: -58.377, detail: '~73 km wide',
    note: 'Plateau of volcanic domes; Chang\'e 5 landed in this region.' },
  // caves and other features
  { id: 'marius-pit', name: 'Marius Hills pit', kind: 'cave', latDeg: 14.0917, lonDeg: -56.7701, detail: '~90 m wide, ~50 m inner opening',
    note: 'A skylight into a lava tube: a possible shelter for future bases.' },
  { id: 'tranquillitatis-pit', name: 'Mare Tranquillitatis pit', kind: 'cave', latDeg: 8.3355, lonDeg: 33.222, detail: '~145 m wide, ~100 m inner opening',
    note: 'Pit with an overhang leading into a cave; stays near room temperature.' },
  { id: 'reiner-gamma', name: 'Reiner Gamma', kind: 'feature', latDeg: 7.385, lonDeg: -58.958, detail: '~73 km long',
    note: 'A bright "lunar swirl" tied to a local magnetic field.' },
  { id: 'vallis-schroteri', name: 'Vallis Schröteri', kind: 'feature', latDeg: 26.156, lonDeg: -51.581, detail: '~185 km long',
    note: 'The largest sinuous rille: a channel carved by flowing lava.' },
  { id: 'rupes-recta', name: 'Rupes Recta', kind: 'feature', latDeg: -21.675, lonDeg: -7.702, detail: '~116 km long',
    note: '"The Straight Wall": a long, straight fault in the crust.' },
  { id: 'ina', name: 'Ina', kind: 'feature', latDeg: 18.659, lonDeg: 5.304, detail: '~3 km wide',
    note: 'A strange D-shaped depression that may be very recent volcanism.' },
  // rovers (where they stopped)
  { id: 'lunokhod-1', name: 'Lunokhod 1 (final position)', kind: 'rover', latDeg: 38.315, lonDeg: -35.0081, detail: 'USSR, 1970–71',
    note: 'First rover on another world; LRO found it in 2010 and its reflector is used for laser ranging.' },
  { id: 'lunokhod-2', name: 'Lunokhod 2 (final position)', kind: 'rover', latDeg: 25.8323, lonDeg: 30.9222, detail: 'USSR, 1973',
    note: 'Drove about 39 km from Luna 21; its laser reflector is still used today.' },
]

/** The feature a landing point's siteId refers to, if any. */
export function moonFeatureById(siteId: string) {
  if (!siteId.startsWith(FEATURE_PREFIX)) return undefined
  const id = siteId.slice(FEATURE_PREFIX.length)
  return MOON_FEATURES.find((f) => f.id === id)
}
