import { Canvas } from '@react-three/fiber'
import { OrbitControls, Stars } from '@react-three/drei'
import { useBodies } from '../../api/hooks'
import { CelestialBody } from './CelestialBody'
import { ClockDriver } from './ClockDriver'
import { Lights } from './Lights'

export function SolarSystem() {
  const { data: bodies } = useBodies()
  return (
    <Canvas camera={{ position: [0, 20, 60], fov: 50, near: 0.01, far: 1e6 }}>
      <ClockDriver />
      <Lights />
      <Stars radius={5000} depth={100} count={5000} factor={4} fade />
      {bodies?.map((b, i) => (
        <CelestialBody key={b.id} body={b} position={[i * 8, 0, 0]} />
      ))}
      <OrbitControls makeDefault />
    </Canvas>
  )
}
