import { create } from 'zustand'
import { Vector3 } from 'three'
import { apiGet, apiPost } from '../../api/client'
import { siteById, type LaunchSiteId } from '../launchSites/sites'
import { useSimStore } from '../../store/simStore'
import { flightPathOf, phaseSpeed } from './flightPath'
import type { MissionMode, MissionResult, MissionStatus } from './types'

const HOUR = 3_600_000

/**
 * What a flight is computed from: the mission panel's highlighted launch site and landing point,
 * its launch time (the simulation searches a launch window from there, so only the hour counts:
 * the backend rounds it down) and the mission mode.
 */
export type FlightInputs = {
  siteId: LaunchSiteId
  landingLat: number
  landingLon: number
  searchFromMs: number // launch time rounded down to the hour
  mode: MissionMode
}

type MissionState = {
  mode: MissionMode
  inputs: FlightInputs | null // what the flight below was (or is being) computed for
  jobId: string | null
  status: MissionStatus['status'] | 'idle'
  log: string[]
  elapsedS: number
  error: string | null
  result: MissionResult | null
  autoSpeed: boolean // the clock speed follows the flight phase
  setMode: (m: MissionMode) => void
  setAutoSpeed: (on: boolean) => void
  compute: () => Promise<void>
  clear: () => void
}

/** The inputs the mission panel describes right now; null while a launch site or landing point is missing. */
export function plannedInputs(mode = useMissionStore.getState().mode): FlightInputs | null {
  const s = useSimStore.getState()
  const siteId = s.missionSites[s.activeSiteSlot] ?? null
  const landing = s.landingPoints[s.activeLandingSlot] ?? null
  if (!siteId || !landing) return null
  return {
    siteId,
    landingLat: landing.latDeg,
    landingLon: landing.lonDeg,
    searchFromMs: Math.floor(s.launchTimeMs / HOUR) * HOUR,
    mode,
  }
}

export function sameInputs(a: FlightInputs | null, b: FlightInputs | null) {
  if (!a || !b) return false
  return (
    a.siteId === b.siteId &&
    a.mode === b.mode &&
    a.searchFromMs === b.searchFromMs &&
    Math.abs(a.landingLat - b.landingLat) < 1e-4 && // the backend keeps 4 decimals
    Math.abs(a.landingLon - b.landingLon) < 1e-4
  )
}

let poll: ReturnType<typeof setTimeout> | null = null

export const useMissionStore = create<MissionState>()((set, get) => ({
  mode: 'szybki',
  inputs: null,
  jobId: null,
  status: 'idle',
  log: [],
  elapsedS: 0,
  error: null,
  result: null,
  autoSpeed: true,
  setMode: (mode) => set({ mode }),
  setAutoSpeed: (autoSpeed) => set({ autoSpeed }),

  /** Ask the backend for the flight (cached results come back at once), then poll until it is done. */
  compute: async () => {
    if (poll) clearTimeout(poll)
    const inputs = plannedInputs()
    if (!inputs) return
    const site = siteById(inputs.siteId)
    set({ inputs, jobId: null, status: 'queued', log: [], error: null, result: null, elapsedS: 0 })
    try {
      const { id } = await apiPost<{ id: string }>('/mission', {
        launch_time_ms: inputs.searchFromMs,
        launch_lat: site.lat,
        launch_lon: site.lon,
        landing_lat: inputs.landingLat,
        landing_lon: inputs.landingLon,
        mode: inputs.mode,
      })
      if (get().inputs !== inputs) return // another computation replaced this one
      set({ jobId: id })
      const tick = async () => {
        if (get().jobId !== id) return
        try {
          const s = await apiGet<MissionStatus>(`/mission/${id}`)
          if (get().jobId !== id) return
          set({ status: s.status, log: s.log, error: s.error, elapsedS: s.elapsed_s, result: s.result })
          if (s.status === 'queued' || s.status === 'running') poll = setTimeout(tick, 1500)
        } catch (e) {
          set({ status: 'error', error: String(e) })
        }
      }
      await tick()
    } catch (e) {
      if (get().inputs === inputs) set({ status: 'error', error: `Could not reach the backend: ${e}` })
    }
  },
  clear: () => {
    if (poll) clearTimeout(poll)
    set({ inputs: null, jobId: null, status: 'idle', log: [], error: null, result: null })
  },
}))

/**
 * The computed flight for what the mission panel shows now, or null (not computed yet, still
 * computing, or the panel changed since). For use outside React (frame loops, click handlers).
 */
export function currentFlight(): MissionResult | null {
  const { result, inputs, mode } = useMissionStore.getState()
  return result?.trajectory && sameInputs(inputs, plannedInputs(mode)) ? result : null
}

/** The mission panel's flight inputs as one string, so a hook re-renders when any of them changes. */
const plannedKey = (s: ReturnType<typeof useSimStore.getState>) => {
  const landing = s.landingPoints[s.activeLandingSlot]
  return `${s.missionSites[s.activeSiteSlot]}|${landing?.latDeg}|${landing?.lonDeg}|${Math.floor(s.launchTimeMs / HOUR)}`
}

/** The same as a hook: re-renders when the flight or the mission panel changes. */
export function useFlight(): MissionResult | null {
  const result = useMissionStore((s) => s.result)
  const inputs = useMissionStore((s) => s.inputs)
  const mode = useMissionStore((s) => s.mode)
  useSimStore(plannedKey)
  return result?.trajectory && sameInputs(inputs, plannedInputs(mode)) ? result : null
}

/** Status of the flight for what the mission panel shows now ('idle' = never computed or out of date). */
export function useFlightStatus(): MissionState['status'] {
  const status = useMissionStore((s) => s.status)
  const inputs = useMissionStore((s) => s.inputs)
  const mode = useMissionStore((s) => s.mode)
  useSimStore(plannedKey)
  return sameInputs(inputs, plannedInputs(mode)) ? status : 'idle'
}

/** Restored when the flight is over: the slowest speed of the clock in the top bar. */
export const SPEED_AFTER_FLIGHT = 3_600

/**
 * Watch the flight in the space view from `tS` seconds after liftoff: clock there, speed set by
 * the flight phase, playing, camera following the spacecraft.
 */
export function followFlight(tS: number) {
  const flight = currentFlight()
  if (!flight?.trajectory) return false
  const path = flightPathOf(flight.trajectory)
  const sim = useSimStore.getState()
  sim.setSimTime(path.launchMs + tS * 1000)
  const st = path.state(Math.max(tS, 0))
  sim.setTimeScale(tS < 0 ? 10 : phaseSpeed(st.phase, st.moonDistKm))
  useMissionStore.getState().setAutoSpeed(true)
  if (!sim.isPlaying) sim.togglePlay()
  sim.selectBody('rocket')
  return true
}

/**
 * Where the spacecraft is right now in scene units, written every frame by MissionScene and read
 * by the camera. Plain mutable object, so it costs nothing per frame.
 */
export const rocketTracker = {
  active: false, // a computed flight is drawn
  position: new Vector3(),
  viewDir: new Vector3(0, 1, 0), // from the spacecraft toward a good camera spot (above and behind)
  viewDistance: 0.1, // how far from it the camera starts, scene units
  phase: '',
  tS: 0, // seconds from liftoff
}
