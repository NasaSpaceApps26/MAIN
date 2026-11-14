import { apiGet } from './client'
import type {
  AnalysisParams, Body, EphemerisParams, EphemerisResponse, Health,
  Site, SiteAnalysis, Trajectory, TrajectoryParams,
} from './types'

export const api = {
  health: () => apiGet<Health>('/health'),
  bodies: () => apiGet<Body[]>('/bodies'),
  ephemeris: (p: EphemerisParams) => apiGet<EphemerisResponse>('/ephemeris', p),
  lunarSites: () => apiGet<Site[]>('/sites/lunar'),
  departureSites: () => apiGet<Site[]>('/sites/departure'),
  siteAnalysis: (siteId: string, p: AnalysisParams) =>
    apiGet<SiteAnalysis>(`/sites/lunar/${siteId}/analysis`, p),
  trajectory: (p: TrajectoryParams) => apiGet<Trajectory>('/trajectory', p),
}
