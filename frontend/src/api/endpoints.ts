import { apiGet } from './client'
import type {
  AnalysisParams, Body, EphemerisParams, EphemerisResponse, EphemerisYear, Health,
  PlanetOrbits, Site, SiteAnalysis, Trajectory, TrajectoryParams,
} from './types'

export const api = {
  health: () => apiGet<Health>('/health'),
  bodies: () => apiGet<Body[]>('/bodies'),
  ephemeris: (p: EphemerisParams) => apiGet<EphemerisResponse>('/ephemeris', p),
  ephemerisYear: (start: string) => apiGet<EphemerisYear>('/ephemeris/year', { start }),
  orbits: () => apiGet<PlanetOrbits>('/orbits'),
  lunarSites: () => apiGet<Site[]>('/sites/lunar'),
  departureSites: () => apiGet<Site[]>('/sites/departure'),
  siteAnalysis: (siteId: string, p: AnalysisParams) =>
    apiGet<SiteAnalysis>(`/sites/lunar/${siteId}/analysis`, p),
  trajectory: (p: TrajectoryParams) => apiGet<Trajectory>('/trajectory', p),
}
