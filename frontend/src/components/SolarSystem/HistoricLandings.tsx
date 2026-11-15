import { MoonSpots, type MoonSpot } from './MoonSpotDot'
import { HISTORIC_LANDINGS, HISTORIC_PREFIX } from './moonLandingsData'
import { FEATURE_KIND_LABEL, FEATURE_PREFIX, MOON_FEATURES } from './moonFeaturesData'

const RED = '#ff2020'
const BLUE = '#2f8cff'

const LANDING_SPOTS: MoonSpot[] = HISTORIC_LANDINGS.map((l) => ({
  siteId: HISTORIC_PREFIX + l.id,
  name: l.name,
  latDeg: l.latDeg,
  lonDeg: l.lonDeg,
  tag: String(l.year),
  subtitle: l.agency + (l.crewed ? ' · crewed' : ''),
  note: l.note,
}))

const FEATURE_SPOTS: MoonSpot[] = MOON_FEATURES.map((f) => ({
  siteId: FEATURE_PREFIX + f.id,
  name: f.name,
  latDeg: f.latDeg,
  lonDeg: f.lonDeg,
  tag: FEATURE_KIND_LABEL[f.kind],
  subtitle: f.detail,
  note: f.note,
}))

type Props = { equatorialRadius: number; flattening: number }

/** Red dots: where notable missions landed on the Moon. */
export function HistoricLandings(props: Props) {
  return <MoonSpots spots={LANDING_SPOTS} colour={RED} {...props} />
}

/** Blue dots: special places on the Moon (craters, mountains, rovers...). */
export function MoonFeatures(props: Props) {
  return <MoonSpots spots={FEATURE_SPOTS} colour={BLUE} {...props} />
}
