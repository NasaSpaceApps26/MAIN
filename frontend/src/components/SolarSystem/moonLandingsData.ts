/**
 * Notable soft landings on the Moon (crewed and robotic).
 * Coordinates: selenographic latitude / longitude in degrees, east positive.
 * Sources (checked 2026-11-15):
 *  - LROC, Wagner et al. 2016, "Coordinates of Lunar Anthropogenic Targets" (Apollo, Surveyor, Luna, Chang'e 3):
 *    https://lroc.im-ldi.com/images/938
 *  - IAU/USGS Gazetteer of Planetary Nomenclature, named landing sites (Statio Tranquillitatis, Tianhe,
 *    Tianchuan, Tianjiang, Shiv Shakti, Guang Han Gong): https://planetarynames.wr.usgs.gov/
 *  - Luna 9, SLIM, Blue Ghost M1: https://en.wikipedia.org/wiki/List_of_artificial_objects_on_the_Moon
 *  - IM-1: NASA/LROC, https://www.nasa.gov/missions/lro/nasas-lro-images-intuitive-machines-odysseus-lander/
 */
export type HistoricLanding = {
  id: string
  name: string
  year: number
  agency: string
  latDeg: number
  lonDeg: number
  crewed?: boolean
  /** One line: why this landing matters. */
  note: string
}

/** Prefix for a landing point's siteId when it was taken from one of these landings. */
export const HISTORIC_PREFIX = 'historic:'

export const HISTORIC_LANDINGS: HistoricLanding[] = [
  { id: 'luna-9', name: 'Luna 9', year: 1966, agency: 'USSR', latDeg: 7.08, lonDeg: -64.37,
    note: 'First soft landing on another world and first photos from the lunar surface.' },
  { id: 'surveyor-1', name: 'Surveyor 1', year: 1966, agency: 'NASA', latDeg: -2.4745, lonDeg: -43.3398,
    note: 'First US soft landing; showed the regolith could hold up a spacecraft.' },
  { id: 'surveyor-3', name: 'Surveyor 3', year: 1967, agency: 'NASA', latDeg: -3.0162, lonDeg: -23.418,
    note: 'First lunar soil digging; Apollo 12 later landed beside it and brought its camera home.' },
  { id: 'surveyor-5', name: 'Surveyor 5', year: 1967, agency: 'NASA', latDeg: 1.4551, lonDeg: 23.1943,
    note: 'First chemical analysis of lunar soil, near the future Apollo 11 site.' },
  { id: 'surveyor-6', name: 'Surveyor 6', year: 1967, agency: 'NASA', latDeg: 0.4742, lonDeg: -1.4275,
    note: 'First lift-off from the Moon: fired its engines and "hopped" 2.5 m.' },
  { id: 'surveyor-7', name: 'Surveyor 7', year: 1968, agency: 'NASA', latDeg: -40.9812, lonDeg: -11.5127,
    note: 'Landed in the rugged highlands by Tycho crater, far from the mare plains.' },
  { id: 'apollo-11', name: 'Apollo 11', year: 1969, agency: 'NASA', latDeg: 0.67416, lonDeg: 23.47314, crewed: true,
    note: 'First humans on the Moon: Armstrong and Aldrin at Tranquility Base.' },
  { id: 'apollo-12', name: 'Apollo 12', year: 1969, agency: 'NASA', latDeg: -3.0128, lonDeg: -23.4219, crewed: true,
    note: 'First precision landing, within walking distance of Surveyor 3.' },
  { id: 'luna-16', name: 'Luna 16', year: 1970, agency: 'USSR', latDeg: -0.5137, lonDeg: 56.3638,
    note: 'First robotic sample return from the Moon.' },
  { id: 'luna-17', name: 'Luna 17 / Lunokhod 1', year: 1970, agency: 'USSR', latDeg: 38.2376, lonDeg: -35.0016,
    note: 'First remote-controlled rover on another world; drove over 10 km.' },
  { id: 'apollo-14', name: 'Apollo 14', year: 1971, agency: 'NASA', latDeg: -3.64589, lonDeg: -17.47194, crewed: true,
    note: 'First landing in the highlands (Fra Mauro), the original target of Apollo 13.' },
  { id: 'apollo-15', name: 'Apollo 15', year: 1971, agency: 'NASA', latDeg: 26.13239, lonDeg: 3.6333, crewed: true,
    note: 'First Lunar Roving Vehicle; found the "Genesis Rock" at Hadley Rille.' },
  { id: 'luna-20', name: 'Luna 20', year: 1972, agency: 'USSR', latDeg: 3.7863, lonDeg: 56.6242,
    note: 'Returned samples from the rough highlands next to Mare Fecunditatis.' },
  { id: 'apollo-16', name: 'Apollo 16', year: 1972, agency: 'NASA', latDeg: -8.9734, lonDeg: 15.5011, crewed: true,
    note: 'Only Apollo landing in the central highlands (Descartes).' },
  { id: 'apollo-17', name: 'Apollo 17', year: 1972, agency: 'NASA', latDeg: 20.1911, lonDeg: 30.7723, crewed: true,
    note: 'Last crewed landing so far; first scientist (geologist) on the Moon.' },
  { id: 'luna-21', name: 'Luna 21 / Lunokhod 2', year: 1973, agency: 'USSR', latDeg: 25.9994, lonDeg: 30.4076,
    note: 'Rover that drove about 39 km, a record that stood for 41 years.' },
  { id: 'luna-24', name: 'Luna 24', year: 1976, agency: 'USSR', latDeg: 12.7142, lonDeg: 62.2129,
    note: 'Last lunar landing for 37 years; drilled a 2 m core in Mare Crisium.' },
  { id: 'change-3', name: "Chang'e 3 / Yutu", year: 2013, agency: 'CNSA', latDeg: 44.1214, lonDeg: -19.5117,
    note: 'First soft landing since 1976 and the first by China.' },
  { id: 'change-4', name: "Chang'e 4 / Yutu-2", year: 2019, agency: 'CNSA', latDeg: -45.45, lonDeg: 177.6,
    note: 'First landing on the far side of the Moon (Von Kármán crater).' },
  { id: 'change-5', name: "Chang'e 5", year: 2020, agency: 'CNSA', latDeg: 43.06, lonDeg: -51.92,
    note: 'First sample return since 1976; the youngest lunar rocks collected so far.' },
  { id: 'chandrayaan-3', name: 'Chandrayaan-3', year: 2023, agency: 'ISRO', latDeg: -69.3734, lonDeg: 32.3198,
    note: 'India’s first landing and the first near the lunar south pole.' },
  { id: 'slim', name: 'SLIM', year: 2024, agency: 'JAXA', latDeg: -13.316, lonDeg: 25.251,
    note: 'Japan’s first landing; pinpoint touchdown within about 100 m of the target.' },
  { id: 'im-1', name: 'IM-1 Odysseus', year: 2024, agency: 'Intuitive Machines / NASA CLPS', latDeg: -80.13, lonDeg: 1.44,
    note: 'First commercial lunar landing and first US landing since Apollo 17, at 80°S.' },
  { id: 'change-6', name: "Chang'e 6", year: 2024, agency: 'CNSA', latDeg: -41.63, lonDeg: -153.98,
    note: 'First sample return from the far side (South Pole–Aitken basin).' },
  { id: 'blue-ghost-1', name: 'Blue Ghost M1', year: 2025, agency: 'Firefly / NASA CLPS', latDeg: 18.56, lonDeg: 61.81,
    note: 'First fully successful commercial landing, upright in Mare Crisium.' },
]

/** The historic landing a landing point's siteId refers to, if any. */
export function historicLandingById(siteId: string) {
  if (!siteId.startsWith(HISTORIC_PREFIX)) return undefined
  const id = siteId.slice(HISTORIC_PREFIX.length)
  return HISTORIC_LANDINGS.find((l) => l.id === id)
}
