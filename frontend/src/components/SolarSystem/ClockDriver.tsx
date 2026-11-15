import { useFrame } from '@react-three/fiber'
import { useSimStore } from '../../store/simStore'
import { FRAME_ORDER } from './frameOrder'

export function ClockDriver() {
  // first in every frame: everything after it sees the new time (see frameOrder.ts)
  useFrame((_, delta) => useSimStore.getState().advance(delta), FRAME_ORDER.clock)
  return null
}
