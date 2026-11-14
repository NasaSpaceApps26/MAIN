export type Health = { status: string }

export type Body = {
  id: string
  name: string
  horizons_id: string
  radius_km: number
  rotation_period_h: number
  color: string
  texture: string | null
}

export type EphemerisSample = { t_ms: number; x_km: number; y_km: number; z_km: number }
export type EphemerisResponse = {
  body_id: string
  center: string
  frame: string
  samples: EphemerisSample[]
}
export type EphemerisParams = {
  body: string
  start: string
  stop: string
  step?: string
  center?: string
}

export type Site = {
  id: string
  name: string
  lat_deg: number
  lon_deg: number
  elevation_m: number | null
  notes: string | null
}

export type TimeValue = { t_ms: number; value: number }
export type SiteAnalysis = {
  site_id: string
  slope_deg: number | null
  illumination_fraction: number | null
  earth_visibility_fraction: number | null
  sun_elevation_deg: TimeValue[]
  earth_elevation_deg: TimeValue[]
}
export type AnalysisParams = { start: string; stop: string }

export type TrajectoryPoint = { t_ms: number; x_km: number; y_km: number; z_km: number }
export type Trajectory = { illustrative: boolean; method: string; points: TrajectoryPoint[] }
export type TrajectoryParams = { departure: string; site: string; launch: string }

// ---------- Solar system: positions for one year + orbits ----------

// Position and velocity relative to the Sun at one moment (one per day)
export type StateSample = {
  t_ms: number
  x_km: number
  y_km: number
  z_km: number
  vx_km_s: number
  vy_km_s: number
  vz_km_s: number
}

// Orbital elements at one moment (names follow the Horizons table)
export type OrbitalElements = {
  t_ms: number
  center: string // "500@10" = around the Sun, "500@399" = around Earth
  ec: number
  a_km: number
  in_deg: number
  om_deg: number
  w_deg: number
  ma_deg: number
  ta_deg: number
  pr_s: number
}

export type BodyEphemeris = {
  body_id: string
  samples: StateSample[]
    daily_orbits: OrbitalElements[] | null // the orbit for every day (null in years downloaded before this change)
}

// GET /api/ephemeris/year
export type EphemerisYear = {
  start: string
  stop: string
  step: string
  center: string
  frame: string
  bodies: Record<string, BodyEphemeris>
}

// GET /api/orbits: fixed planet orbits, by body id
export type PlanetOrbits = Record<string, OrbitalElements>
