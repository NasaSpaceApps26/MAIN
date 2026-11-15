import type { MoonPoint } from '../components/SolarSystem/EarthMoon/moonTerrain'
import { create } from 'zustand'

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

type SimState = {
  simTimeMs: number
  isPlaying: boolean
  timeScale: number // simulated seconds per real second
  pickedMoonPoint: MoonPoint | null
  setMoonPoint: (point: MoonPoint | null) => void
  selectedBodyId: string | null
  planetSize: number // how many times bigger planets are drawn. The choices are SIZE_OPTIONS in SolarSystem/scale.ts
  shadows: boolean // false: every body is lit evenly, no night side
  departureSiteId: string | null
  landingSiteId: string | null
  readout: SurfaceReadout | null
  setSimTime: (t: number) => void
  advance: (realDeltaSec: number) => void
  togglePlay: () => void
  setTimeScale: (s: number) => void
  selectBody: (id: string | null) => void
  setPlanetSize: (size: number) => void
  setShadows: (on: boolean) => void
  setDepartureSite: (id: string | null) => void
  setLandingSite: (id: string | null) => void
  setReadout: (readout: SurfaceReadout | null) => void
}

export const useSimStore = create<SimState>()((set, get) => ({
  simTimeMs: Date.UTC(1969, 6, 16, 13, 32), // Apollo 11 launch
  isPlaying: false,
  timeScale: 43_200, // 12 h per second, the slowest speed
  pickedMoonPoint: null,
  setMoonPoint: (point) => set({ pickedMoonPoint: point }),
  selectedBodyId: null,
  planetSize: 250, // the standard size
  shadows: true,
  departureSiteId: null,
  landingSiteId: null,
  readout: null,
  setSimTime: (t) => set({ simTimeMs: t }),
  advance: (dt) => {
    const { isPlaying, simTimeMs, timeScale } = get()
    if (isPlaying) set({ simTimeMs: simTimeMs + dt * 1000 * timeScale })
  },
  togglePlay: () => set((s) => ({ isPlaying: !s.isPlaying })),
  setTimeScale: (s) => set({ timeScale: s }),
  selectBody: (id) => set({ selectedBodyId: id }),
  setPlanetSize: (size) => set({ planetSize: size }),
  setShadows: (on) => set({ shadows: on }),
  setDepartureSite: (id) => set({ departureSiteId: id }),
  setLandingSite: (id) => set({ landingSiteId: id }),
  setReadout: (readout) => set({ readout }),
}))
