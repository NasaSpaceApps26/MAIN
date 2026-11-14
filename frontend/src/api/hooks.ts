import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from './endpoints'
import type { AnalysisParams, EphemerisParams, TrajectoryParams } from './types'

export const useHealth = () =>
  useQuery({ queryKey: ['health'], queryFn: api.health, refetchInterval: 30_000 })

export const useBodies = () =>
  useQuery({ queryKey: ['bodies'], queryFn: api.bodies, staleTime: Infinity })

export const useEphemeris = (p: EphemerisParams | null) =>
  useQuery({
    queryKey: ['ephemeris', p],
    queryFn: () => api.ephemeris(p!),
    enabled: p !== null,
    staleTime: Infinity,
  })

// One year of positions (+ the Moon's daily orbit), starting at `start` (YYYY-MM-DD).
// keepPreviousData: while the next year downloads, keep showing the current one.
export const useEphemerisYear = (start: string) =>
  useQuery({
    queryKey: ['ephemeris-year', start],
    queryFn: () => api.ephemerisYear(start),
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  })

// Planet orbits: the same for every period, loaded once
export const useOrbits = () =>
  useQuery({ queryKey: ['orbits'], queryFn: api.orbits, staleTime: Infinity })

export const useLunarSites = () =>
  useQuery({ queryKey: ['sites', 'lunar'], queryFn: api.lunarSites, staleTime: Infinity })

export const useDepartureSites = () =>
  useQuery({ queryKey: ['sites', 'departure'], queryFn: api.departureSites, staleTime: Infinity })

export const useSiteAnalysis = (siteId: string | null, p: AnalysisParams) =>
  useQuery({
    queryKey: ['analysis', siteId, p],
    queryFn: () => api.siteAnalysis(siteId!, p),
    enabled: siteId !== null,
  })

export const useTrajectory = (p: TrajectoryParams | null) =>
  useQuery({
    queryKey: ['trajectory', p],
    queryFn: () => api.trajectory(p!),
    enabled: p !== null,
  })
