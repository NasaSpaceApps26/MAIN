/**
 * Mission clock speeds (simulated seconds per real second), the same in the top bar and in Lunar Sky.
 * A computed flight runs at whichever of these is picked: nothing changes the speed on its own.
 */
export const CLOCK_SPEEDS = [
  { value: 1_800, label: '30 min/s' },
  { value: 3_600, label: '1 h/s' },
  { value: 43_200, label: '12 h/s' },
  { value: 172_800, label: '2 d/s' },
]
