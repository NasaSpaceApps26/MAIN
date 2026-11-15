import type { MoonPoint } from '../components/SolarSystem/EarthMoon/moonTerrain'
import { create } from 'zustand'
import type { RocketId } from '../features/mission/flightPlan'
import type { LaunchSiteId } from '../features/launchSites/sites'

/** What the camera is above: shown in the corner of the 3D view (see SurfaceReadout) */
export type SurfaceReadout = {
  bodyName: string
  altitudeKm: number // above the REAL body, in real km (the size buttons are taken out)
  latDeg: number // the point straight below the camera
  lonDeg: number
  elevationM?: number
  terrainAvailable?: boolean
  mapLevel?: number // Earth/Moon: level of the map tiles drawn below (Moon Trek's zoom level)
  metresPerPixel?: number // how sharp that level is
}

/** The camera positions of the buttons in the top-right corner (see CameraViews) */
export type CameraView = 'top' | 'angled' | 'earthMoon'

/** A landing point on the Moon. siteId = the named lunar site it was taken from, null = a point of your own. */
export type LandingPoint = MoonPoint & { siteId: string | null }

const APOLLO_11_LAUNCH = Date.UTC(1969, 6, 16, 13, 32)
export const MAX_LANDING_POINTS = 4 // landing A (primary) and up to three alternatives: B, C, D

type SimState = {
  simTimeMs: number
  isPlaying: boolean
  timeScale: number // simulated seconds per real second
  selectedBodyId: string | null
  planetSize: number // how many times bigger planets are drawn. The choices are SIZE_OPTIONS in SolarSystem/scale.ts
  shadows: boolean // false: every body is lit evenly, no night side
  showPoints: boolean // false: hides every site dot (Earth launch sites, Moon sites, historic landings)
  departureSiteId: string | null
  readout: SurfaceReadout | null
  launchSiteId: LaunchSiteId | null // launch site whose 3D model window is open
  // --- mission (MissionPanel at the bottom, MissionResults window) ---
  missionSites: (LaunchSiteId | null)[] // launch sites to compare, one slot each (always at least one slot)
  activeSiteSlot: number // the slot a click on a red dot fills
  landingPoints: (LandingPoint | null)[] // landing points to compare, one slot each (always at least one slot)
  activeLandingSlot: number // the slot a pick on the Moon fills
  rocketId: RocketId
  launchTimeMs: number // planned liftoff, UTC ms
  pickingLanding: boolean // "Pick on Moon" mode: the next click on the Moon sets the active landing point
  resultsOpen: boolean // the mission results window
  drawerOpen: boolean // the drawer on the left (Landing settings / Lunar Sky) is open: the mission panel folds away
  cameraRequest: { view: CameraView; n: number } | null // n goes up on every click, so the same button works twice
  requestCameraView: (view: CameraView) => void
  setSimTime: (t: number) => void
  advance: (realDeltaSec: number) => void
  togglePlay: () => void
  setTimeScale: (s: number) => void
  selectBody: (id: string | null) => void
  setPlanetSize: (size: number) => void
  setShadows: (on: boolean) => void
  setShowPoints: (on: boolean) => void
  setDepartureSite: (id: string | null) => void
  setReadout: (readout: SurfaceReadout | null) => void
  openLaunchSite: (id: LaunchSiteId | null) => void
  setMissionSiteAt: (slot: number, id: LaunchSiteId | null) => void
  chooseLaunchSite: (id: LaunchSiteId) => void
  addMissionSiteSlot: () => void
  removeMissionSiteSlot: (slot: number) => void
  setActiveSiteSlot: (slot: number) => void
  setLandingPoint: (point: LandingPoint | null) => void
  setLandingPointAt: (slot: number, point: LandingPoint | null) => void
  addLandingSlot: () => void
  removeLandingSlot: (slot: number) => void
  setActiveLandingSlot: (slot: number) => void
  setRocket: (id: RocketId) => void
  setLaunchTime: (t: number) => void
  setPickingLanding: (on: boolean) => void
  setResultsOpen: (open: boolean) => void
  setDrawerOpen: (open: boolean) => void
  clearMission: () => void
}

type MissionFields = Pick<SimState, 'missionSites' | 'landingPoints'>

/** A rocket may only launch once the mission has a launch site and a landing point. */
export const missionReady = (s: MissionFields) =>
  s.missionSites.some((id) => id !== null) && s.landingPoints.some((p) => p !== null)

/** Removes one slot from a list of slots; the last slot is emptied instead, so one always stays. */
function withoutSlot<T>(slots: (T | null)[], active: number, slot: number) {
  if (slots.length <= 1) return { slots: [null], active: 0 }
  const rest = slots.filter((_, i) => i !== slot)
  return { slots: rest, active: Math.min(active > slot ? active - 1 : active, rest.length - 1) }
}

/** UTC ms rounded down to the whole minute. */
const toMinute = (t: number) => Math.floor(t / 60_000) * 60_000

export const useSimStore = create<SimState>()((set, get) => ({
  simTimeMs: APOLLO_11_LAUNCH,
  isPlaying: false,
  timeScale: 43_200, // 12 h per second (the speeds in the top bar: components/TopBar/clockSpeeds.ts)
  selectedBodyId: null,
  planetSize: 250, // the standard size
  shadows: true,
  showPoints: true,
  departureSiteId: null,
  readout: null,
  launchSiteId: null,
  missionSites: [null],
  activeSiteSlot: 0,
  landingPoints: [null],
  activeLandingSlot: 0,
  rocketId: 'saturnV',
  launchTimeMs: APOLLO_11_LAUNCH,
  pickingLanding: false,
  resultsOpen: false,
  drawerOpen: false,
  cameraRequest: null,
  requestCameraView: (view) =>
    set((s) => ({ cameraRequest: { view, n: (s.cameraRequest?.n ?? 0) + 1 } })),
  // One clock everywhere (top bar, Lunar Sky, mission panel): while it stands still, the planned
  // launch time is the clock's time (whole minutes), so Compute launches from where the clock is
  setSimTime: (t) => set((s) => (s.isPlaying ? { simTimeMs: t } : { simTimeMs: t, launchTimeMs: toMinute(t) })),
  advance: (dt) => {
    const { isPlaying, simTimeMs, timeScale } = get()
    if (isPlaying) set({ simTimeMs: simTimeMs + dt * 1000 * timeScale })
  },
  togglePlay: () =>
    set((s) => (s.isPlaying ? { isPlaying: false, launchTimeMs: toMinute(s.simTimeMs) } : { isPlaying: true })),
  setTimeScale: (s) => set({ timeScale: s }),
  selectBody: (id) => set({ selectedBodyId: id }),
  setPlanetSize: (size) => set({ planetSize: size }),
  setShadows: (on) => set({ shadows: on }),
  setShowPoints: (on) => set({ showPoints: on }),
  setDepartureSite: (id) => set({ departureSiteId: id }),
  setReadout: (readout) => set({ readout }),
  openLaunchSite: (id) => set({ launchSiteId: id }),

  // --- launch sites ---
  // Choosing a site also opens its 3D model (LaunchSiteViewer, on the right)
  setMissionSiteAt: (slot, id) =>
    set((s) => ({
      missionSites: s.missionSites.map((old, i) => (i === slot ? id : old)),
      activeSiteSlot: slot,
      ...(id ? { launchSiteId: id } : {}),
    })),
  // A red dot on Earth: fills the active slot, or jumps to the slot that already holds that site
  chooseLaunchSite: (id) =>
    set((s) => {
      const existing = s.missionSites.indexOf(id)
      if (existing !== -1) return { activeSiteSlot: existing, launchSiteId: id }
      return { missionSites: s.missionSites.map((old, i) => (i === s.activeSiteSlot ? id : old)), launchSiteId: id }
    }),
  addMissionSiteSlot: () =>
    set((s) => ({ missionSites: [...s.missionSites, null], activeSiteSlot: s.missionSites.length })),
  removeMissionSiteSlot: (slot) =>
    set((s) => {
      const { slots, active } = withoutSlot(s.missionSites, s.activeSiteSlot, slot)
      return { missionSites: slots, activeSiteSlot: active }
    }),
  // highlighting a filled slot shows that site's model too
  setActiveSiteSlot: (slot) =>
    set((s) => {
      const id = s.missionSites[slot] ?? null
      return { activeSiteSlot: slot, ...(id && id !== s.launchSiteId ? { launchSiteId: id } : {}) }
    }),

  // --- landing points ---
  // Into the active slot; a named lunar site that is already in another slot just makes that slot active
  setLandingPoint: (point) =>
    set((s) => {
      const existing = point?.siteId ? s.landingPoints.findIndex((p) => p?.siteId === point.siteId) : -1
      if (existing !== -1) return { activeLandingSlot: existing }
      return { landingPoints: s.landingPoints.map((old, i) => (i === s.activeLandingSlot ? point : old)) }
    }),
  // Into one given slot, whichever is active (the Lunar Sky map always sets the primary landing, A)
  setLandingPointAt: (slot, point) =>
    set((s) => ({ landingPoints: s.landingPoints.map((old, i) => (i === slot ? point : old)) })),
  addLandingSlot: () =>
    set((s) =>
      s.landingPoints.length >= MAX_LANDING_POINTS
        ? {}
        : { landingPoints: [...s.landingPoints, null], activeLandingSlot: s.landingPoints.length },
    ),
  removeLandingSlot: (slot) =>
    set((s) => {
      const { slots, active } = withoutSlot(s.landingPoints, s.activeLandingSlot, slot)
      return { landingPoints: slots, activeLandingSlot: active }
    }),
  setActiveLandingSlot: (slot) => set({ activeLandingSlot: slot }),

  setRocket: (id) => set({ rocketId: id }),
  setLaunchTime: (t) => set({ launchTimeMs: t }),
  setPickingLanding: (on) => set({ pickingLanding: on }),
  setResultsOpen: (open) => set({ resultsOpen: open }),
  setDrawerOpen: (open) => set({ drawerOpen: open }),
  // the mission panel's "Clear": no launch sites, no landing points, the launch site window closed
  // (rocket, fuel policy and the clock stay as they are)
  clearMission: () =>
    set({
      missionSites: [null],
      activeSiteSlot: 0,
      landingPoints: [null],
      activeLandingSlot: 0,
      pickingLanding: false,
      launchSiteId: null,
    }),
}))
