import { useSimStore } from '../../store/simStore'

/**
 * Shadows on: the Sun (a point light at the centre) lights one side of every body, the other
 * side is night (a faint ambient light keeps it from being pitch black).
 * Shadows off: no Sun light, only an even ambient light, as bright as the sunlit side.
 * (three.js divides ambient light by π, so 2 here matches the Sun's 2 face-on.)
 */
export function Lights() {
  const shadows = useSimStore((s) => s.shadows)
  return (
    <>
      <ambientLight intensity={shadows ? 0.05 : 2} />
      <pointLight position={[0, 0, 0]} intensity={shadows ? 2 : 0} decay={0} />
    </>
  )
}
