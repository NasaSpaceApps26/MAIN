/** What POST /api/mission + GET /api/mission/{id} return (backend/app/services/mission.py). */

export type MissionMode = 'szybki' | 'oszczedny'

export type MissionEvent = {
  name: string
  t_s: number // seconds from liftoff
  alt_earth_km: number
  alt_moon_km: number
  mass_kg: number
}

/** Columns, one value per sample. Positions are geocentric, ecliptic J2000, km. */
export type MissionTrajectory = {
  launch_ms: number
  phases: string[]
  t_s: number[] // seconds from liftoff
  phase: number[] // index into `phases`
  alt_earth_km: number[]
  alt_moon_km: number[]
  speed_km_s: number[]
  mass_kg: number[]
  r: [number[], number[], number[]] // spacecraft
  moon: [number[], number[], number[]] // Moon's centre
  site: [number[], number[], number[]] // landing site, relative to the Moon's centre
}

export type MissionResult = {
  mode: MissionMode
  verdict: string
  landed: boolean
  failure: [string, string] | null
  launch: { lat: number; lon: number }
  landing: { lat: number; lon: number }
  summary: [string, string][]
  report: string
  events: MissionEvent[]
  trajectory: MissionTrajectory | null
}

export type MissionStatus = {
  id: string
  status: 'queued' | 'running' | 'done' | 'error'
  log: string[]
  error: string | null
  elapsed_s: number
  result: MissionResult | null
}
