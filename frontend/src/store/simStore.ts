import { create } from 'zustand'

type SimState = {
  simTimeMs: number
  isPlaying: boolean
  timeScale: number // simulated seconds per real second
  selectedBodyId: string | null
  planetSize: number // how many times bigger planets are drawn. The choices are SIZE_OPTIONS in SolarSystem/scale.ts
  departureSiteId: string | null
  landingSiteId: string | null
  setSimTime: (t: number) => void
  advance: (realDeltaSec: number) => void
  togglePlay: () => void
  setTimeScale: (s: number) => void
  selectBody: (id: string | null) => void
  setPlanetSize: (size: number) => void
  setDepartureSite: (id: string | null) => void
  setLandingSite: (id: string | null) => void
}

export const useSimStore = create<SimState>()((set, get) => ({
  simTimeMs: Date.UTC(1969, 6, 16, 13, 32), // Apollo 11 launch
  isPlaying: false,
  timeScale: 43_200, // 12 h per second, the slowest speed
  selectedBodyId: null,
  planetSize: 250, // the standard size
  departureSiteId: null,
  landingSiteId: null,
  setSimTime: (t) => set({ simTimeMs: t }),
  advance: (dt) => {
    const { isPlaying, simTimeMs, timeScale } = get()
    if (isPlaying) set({ simTimeMs: simTimeMs + dt * 1000 * timeScale })
  },
  togglePlay: () => set((s) => ({ isPlaying: !s.isPlaying })),
  setTimeScale: (s) => set({ timeScale: s }),
  selectBody: (id) => set({ selectedBodyId: id }),
  setPlanetSize: (size) => set({ planetSize: size }),
  setDepartureSite: (id) => set({ departureSiteId: id }),
  setLandingSite: (id) => set({ landingSiteId: id }),
}))
