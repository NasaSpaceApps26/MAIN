import { create } from 'zustand'
import type { LaunchSiteId } from '../features/launchSites/sites'

type SimState = {
  simTimeMs: number
  isPlaying: boolean
  timeScale: number // simulated seconds per real second
  selectedBodyId: string | null
  departureSiteId: string | null
  landingSiteId: string | null
  launchSiteId: LaunchSiteId | null // launch site whose 3D model window is open
  setSimTime: (t: number) => void
  advance: (realDeltaSec: number) => void
  togglePlay: () => void
  setTimeScale: (s: number) => void
  selectBody: (id: string | null) => void
  setDepartureSite: (id: string | null) => void
  setLandingSite: (id: string | null) => void
  openLaunchSite: (id: LaunchSiteId | null) => void
}

export const useSimStore = create<SimState>()((set, get) => ({
  simTimeMs: Date.UTC(1969, 6, 16, 13, 32), // Apollo 11 launch
  isPlaying: false,
  timeScale: 3600,
  selectedBodyId: null,
  departureSiteId: null,
  landingSiteId: null,
  launchSiteId: null,
  setSimTime: (t) => set({ simTimeMs: t }),
  advance: (dt) => {
    const { isPlaying, simTimeMs, timeScale } = get()
    if (isPlaying) set({ simTimeMs: simTimeMs + dt * 1000 * timeScale })
  },
  togglePlay: () => set((s) => ({ isPlaying: !s.isPlaying })),
  setTimeScale: (s) => set({ timeScale: s }),
  selectBody: (id) => set({ selectedBodyId: id }),
  setDepartureSite: (id) => set({ departureSiteId: id }),
  setLandingSite: (id) => set({ landingSiteId: id }),
  openLaunchSite: (id) => set({ launchSiteId: id }),
}))
