import { useEffect } from 'react'
import { startFlightClock, useMissionStore } from '../../mission/missionStore'
import type { LaunchPad } from '../sites'
import { useLaunchStore } from './launchStore'

/** Wait this long after the window opens before the countdown, so the model is drawn first. */
const AUTO_LAUNCH_DELAY_MS = 600

/**
 * No launch controls over the 3D model: as soon as the mission panel has computed the flight, the
 * rocket on the site's first pad counts down and lifts off, and at the same moment the computed
 * flight starts on the mission clock in the solar system (LaunchTimeSync runs the clock with the
 * countdown and hands it back afterwards).
 */
export function useAutoLaunch(pads: readonly LaunchPad[]) {
  const pending = useMissionStore((s) => s.launchPending)
  const pad = pads[0]?.id
  useEffect(() => {
    if (!pending || !pad) return
    const timer = setTimeout(() => {
      if (!useMissionStore.getState().takeLaunch()) return
      startFlightClock()
      useLaunchStore.getState().launch(pad)
    }, AUTO_LAUNCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [pending, pad])
}
