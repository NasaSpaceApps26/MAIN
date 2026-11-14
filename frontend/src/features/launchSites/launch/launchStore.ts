import { create } from 'zustand'
import { Vector3 } from 'three'

export type LaunchPhase = 'idle' | 'countdown' | 'flight' | 'done'

type LaunchState = {
  padId: string | null // pad whose rocket is launching (or has launched)
  run: number // bumped on every launch, so each one starts fresh
  phase: LaunchPhase
  clock: number // whole seconds from liftoff, negative during the countdown
  event: string // latest flight event, e.g. "Stage separation"
  follow: boolean // tracking camera on
  launch: (padId: string) => void
  reset: () => void
  setFollow: (follow: boolean) => void
  report: (s: { phase: LaunchPhase; clock: number; event: string }) => void
}

/** State of the launch shown in the launch site window (one launch at a time). */
export const useLaunchStore = create<LaunchState>()((set) => ({
  padId: null,
  run: 0,
  phase: 'idle',
  clock: 0,
  event: '',
  follow: true,
  launch: (padId) =>
    set((s) => ({ padId, run: s.run + 1, phase: 'countdown', clock: 0, event: '' })),
  reset: () => set({ padId: null, phase: 'idle', clock: 0, event: '' }),
  setFollow: (follow) => set({ follow }),
  report: (r) => set(r),
}))

/**
 * Where the tracked rocket is right now, written every frame by the flight and read by the camera.
 * Plain mutable object (not React state) so it costs nothing per frame.
 */
export const tracker = {
  active: false, // a tracked rocket is on the pad or in the air
  owner: null as object | null,
  base: new Vector3(), // where it stood on the pad
  focus: new Vector3(), // middle of what is still flying
  heading: new Vector3(1, 0, 0), // downrange, on the ground
  height: 8, // rocket height, for framing
  shake: 0, // 0..1, ground shake near the pad
  cut: false, // the launch animation ended: cut straight back to the overview instead of flying back
}
