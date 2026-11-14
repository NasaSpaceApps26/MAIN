import { useFrame } from '@react-three/fiber'
import { useSimStore } from '../../store/simStore'

export function ClockDriver() {
  useFrame((_, delta) => useSimStore.getState().advance(delta))
  return null
}
