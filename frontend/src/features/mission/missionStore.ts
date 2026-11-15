import { create } from 'zustand'
import { Vector3 } from 'three'
import { apiGet, apiPost } from '../../api/client'
import { LAUNCH_SITES, siteById, type LaunchSiteId } from '../launchSites/sites'
import { useSimStore } from '../../store/simStore'
import { PROFILES } from '../launchSites/launch/profiles'
import { overviewRequests } from './flightCamera'
import { PRIMARY_SLOT } from './landing'
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

type Coord = { lat: number; lon: number }

/** Landing site from the page URL (?lat=&lon=, written by the Landing settings), else Apollo 11. */
function landingFromUrl(): Coord {
  const q = new URLSearchParams(window.location.search)
  const lat = Number(q.get('lat'))
  const lon = Number(q.get('lon'))
  return q.has('lat') && q.has('lon') && Number.isFinite(lat) && Number.isFinite(lon)
    ? { lat, lon }
    : { lat: 0.6741, lon: 23.473 }
}

type MissionState = {
  launch: Coord // launch point on Earth
  launchName: string
  landing: Coord // landing point on the Moon (selenographic)
  mode: MissionMode
  inputs: FlightInputs | null // what the flight below was (or is being) computed for
  jobId: string | null
  status: MissionStatus['status'] | 'idle'
  log: string[]
  elapsedS: number
  error: string | null
  result: MissionResult | null
  // the flight was just computed: the rocket in the launch site window lifts off on its own
  // (LaunchPanel takes it), or the clock just starts if that window is closed
  launchPending: boolean
  setLaunch: (c: Coord, name: string) => void
  setLanding: (c: Coord) => void
  setMode: (m: MissionMode) => void
  compute: () => Promise<void>
  clear: () => void
  takeLaunch: () => boolean
}

/** Real seconds from the launch site's countdown starting to liftoff. */
export const COUNTDOWN_S = PROFILES.saturnV.countdown

/**
 * Starts the computed flight on the mission clock: the clock at the start of the countdown
 * (liftoff COUNTDOWN_S seconds later) and the camera on the spacecraft. The speed is never touched:
 * the flight runs at whatever speed is picked in the top bar.
 *
 * `play: false` when the launch site window is about to run the clock itself (LaunchTimeSync, in
 * real time with the countdown and the 3D liftoff): the clock waits for it, so it does not run
 * ahead at the top bar's speed in between.
 */
export function startFlightClock(
  result: MissionResult | null = useMissionStore.getState().result,
  { play = true }: { play?: boolean } = {},
) {
  if (!result?.trajectory) return
  const sim = useSimStore.getState()
  if (!play && sim.isPlaying) sim.togglePlay()
  sim.setSimTime(result.trajectory.launch_ms - COUNTDOWN_S * 1000)
  if (play && !sim.isPlaying) sim.togglePlay()
  sim.selectBody('rocket')
}

/** The flight is computed: open the launch site's 3D model, whose rocket then lifts off by itself. */
function onComputed(result: MissionResult, siteId: LaunchSiteId | null) {
  if (!result.trajectory) return
  const sim = useSimStore.getState()
  if (sim.isPlaying) sim.togglePlay() // the launch site window starts the clock with the countdown
  sim.setSimTime(result.trajectory.launch_ms - COUNTDOWN_S * 1000)
  if (siteId) {
    useMissionStore.setState({ launchPending: true })
    sim.openLaunchSite(siteId)
  } else startFlightClock(result)
}

/**
 * The inputs the mission panel describes right now; null while a launch site or the primary landing
 * is missing. The rocket always flies to the primary landing (A); B, C… are only compared.
 */
export function plannedInputs(mode = useMissionStore.getState().mode): FlightInputs | null {
  const s = useSimStore.getState()
  const siteId = s.missionSites[s.activeSiteSlot] ?? null
  const landing = s.landingPoints[PRIMARY_SLOT] ?? null
  if (!siteId || !landing) return null
  return {
    siteId,
    landingLat: landing.latDeg,
    landingLon: landing.lonDeg,
    searchFromMs: Math.floor(s.launchTimeMs / HOUR) * HOUR,
    mode,
  }
}

/**
 * Is a flight computed for `a` still the one for `b`? Same site, landing point and mode. The launch
 * time is not compared: it follows the mission clock (simStore), which moves on as the flight plays.
 */
export function sameInputs(a: FlightInputs | null, b: FlightInputs | null) {
  if (!a || !b) return false
  return (
    a.siteId === b.siteId &&
    a.mode === b.mode &&
    Math.abs(a.landingLat - b.landingLat) < 1e-4 && // the backend keeps 4 decimals
    Math.abs(a.landingLon - b.landingLon) < 1e-4
  )
}

let poll: ReturnType<typeof setTimeout> | null = null

export const useMissionStore = create<MissionState>()((set, get) => ({
  launch: { lat: LAUNCH_SITES[0].lat, lon: LAUNCH_SITES[0].lon },
  launchName: LAUNCH_SITES[0].name,
  landing: landingFromUrl(),
  mode: 'szybki',
  inputs: null,
  jobId: null,
  status: 'idle',
  log: [],
  elapsedS: 0,
  error: null,
  result: null,
  launchPending: false,
  setLaunch: (launch, launchName) => set({ launch, launchName }),
  setLanding: (landing) => {
    const l = get().landing
    if (Math.abs(l.lat - landing.lat) > 1e-6 || Math.abs(l.lon - landing.lon) > 1e-6) set({ landing })
  },
  setMode: (mode) => set({ mode }),

  /** Ask the backend for the flight (cached results come back at once), then poll until it is done. */
  compute: async () => {
    if (poll) clearTimeout(poll)
    // the highlighted launch site and landing point of the mission panel (see plannedInputs)
    const inputs = plannedInputs()
    if (!inputs) return
    const siteId = inputs.siteId // whose 3D model shows the liftoff
    const site = siteById(siteId)
    set({ inputs, jobId: null, status: 'queued', log: [], error: null, result: null, elapsedS: 0, launchPending: false })
    try {
      const { id } = await apiPost<{ id: string }>('/mission', {
        launch_time_ms: useSimStore.getState().launchTimeMs, // the launch window is searched from here, 3 days ahead
        launch_lat: site.lat,
        launch_lon: site.lon,
        landing_lat: inputs.landingLat,
        landing_lon: inputs.landingLon,
        mode: inputs.mode,
      })
      if (get().inputs !== inputs) return // another computation replaced this one
      set({ jobId: id })
      const tick = async () => {
        if (get().jobId !== id) return // another computation replaced this one
        try {
          const s = await apiGet<MissionStatus>(`/mission/${id}`)
          if (get().jobId !== id) return
          set({ status: s.status, log: s.log, error: s.error, elapsedS: s.elapsed_s, result: s.result })
          if (s.status === 'queued' || s.status === 'running') poll = setTimeout(tick, 1500)
          else if (s.status === 'done' && s.result) onComputed(s.result, siteId)
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
    set({ inputs: null, jobId: null, status: 'idle', log: [], error: null, result: null, launchPending: false })
  },
  /** The launch site window takes the pending liftoff: true once, then false until the next flight. */
  takeLaunch: () => {
    if (!get().launchPending) return false
    set({ launchPending: false })
    return true
  },
}))

// The launch site window was closed before the computed flight's rocket lifted off: the flight
// still starts, in space
useSimStore.subscribe((s, prev) => {
  if (prev.launchSiteId && !s.launchSiteId && useMissionStore.getState().takeLaunch()) startFlightClock()
})

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
  const landing = s.landingPoints[PRIMARY_SLOT]
  return `${s.missionSites[s.activeSiteSlot]}|${landing?.latDeg}|${landing?.lonDeg}`
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

/**
 * The camera pulls back smoothly from where it is (close to the rocket) to the view of Earth and
 * the Moon that shows the whole flight (flightCamera.ts, run by MissionScene), then travels with Earth.
 */
export function showFlightOverview() {
  useSimStore.getState().selectBody(null) // the pull-back moves the camera itself; it selects Earth when done
  overviewRequests.request++
}

/**
 * Watch the flight in the space view from `tS` seconds after liftoff: clock there and playing at
 * the speed picked in the top bar (never changed here), camera pulling back from the rocket to the
 * Earth–Moon overview.
 */
export function followFlight(tS: number) {
  const flight = currentFlight()
  if (!flight?.trajectory) return false
  const sim = useSimStore.getState()
  sim.setSimTime(flight.trajectory.launch_ms + tS * 1000)
  if (!sim.isPlaying) sim.togglePlay()
  showFlightOverview()
  return true
}

/**
 * Where the spacecraft is right now in scene units, written every frame by MissionScene and read
 * by the camera. Plain mutable object, so it costs nothing per frame.
 */
export const rocketTracker = {
  active: false,
  position: new Vector3(),
  phase: '',
  tS: 0, // seconds from liftoff
}
