import { create } from 'zustand'
import { Vector3 } from 'three'
import { apiGet, apiPost } from '../../api/client'
import { LAUNCH_SITES } from '../launchSites/sites'
import { useSimStore } from '../../store/simStore'
import type { MissionMode, MissionResult, MissionStatus } from './types'

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
  jobId: string | null
  status: MissionStatus['status'] | 'idle'
  log: string[]
  elapsedS: number
  error: string | null
  result: MissionResult | null
  autoSpeed: boolean // the clock speed follows the flight phase
  setLaunch: (c: Coord, name: string) => void
  setLanding: (c: Coord) => void
  setMode: (m: MissionMode) => void
  setAutoSpeed: (on: boolean) => void
  compute: () => Promise<void>
  clear: () => void
}

let poll: ReturnType<typeof setTimeout> | null = null

export const useMissionStore = create<MissionState>()((set, get) => ({
  launch: { lat: LAUNCH_SITES[0].lat, lon: LAUNCH_SITES[0].lon },
  launchName: LAUNCH_SITES[0].name,
  landing: landingFromUrl(),
  mode: 'szybki',
  jobId: null,
  status: 'idle',
  log: [],
  elapsedS: 0,
  error: null,
  result: null,
  autoSpeed: true,
  setLaunch: (launch, launchName) => set({ launch, launchName }),
  setLanding: (landing) => {
    const l = get().landing
    if (Math.abs(l.lat - landing.lat) > 1e-6 || Math.abs(l.lon - landing.lon) > 1e-6) set({ landing })
  },
  setMode: (mode) => set({ mode }),
  setAutoSpeed: (autoSpeed) => set({ autoSpeed }),

  /** Ask the backend for the flight (cached results come back at once), then poll until it is done. */
  compute: async () => {
    if (poll) clearTimeout(poll)
    const { launch, landing, mode } = get()
    set({ status: 'queued', log: [], error: null, result: null, elapsedS: 0 })
    try {
      const { id } = await apiPost<{ id: string }>('/mission', {
        launch_time_ms: useSimStore.getState().simTimeMs,
        launch_lat: launch.lat,
        launch_lon: launch.lon,
        landing_lat: landing.lat,
        landing_lon: landing.lon,
        mode,
      })
      set({ jobId: id })
      const tick = async () => {
        if (get().jobId !== id) return // another computation replaced this one
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
      set({ status: 'error', error: `Could not reach the backend: ${e}` })
    }
  },
  clear: () => {
    if (poll) clearTimeout(poll)
    set({ jobId: null, status: 'idle', log: [], error: null, result: null })
  },
}))

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
