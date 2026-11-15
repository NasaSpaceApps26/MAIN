/**
 * Mission clock speeds (simulated seconds per real second), the same in the top bar and in Lunar Sky.
 * During a computed flight the speed follows the flight phase and may be none of these ("auto").
 */
export const CLOCK_SPEEDS = [
  { value: 3_600, label: '1 h/s' },
  { value: 43_200, label: '12 h/s' },
  { value: 86_400, label: '1 d/s' },
  { value: 259_200, label: '3 d/s' },
]
