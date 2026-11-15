import { useMemo } from 'react'
import { useTexture } from '@react-three/drei'
import { DoubleSide, RingGeometry, SRGBColorSpace, Vector3, type Texture } from 'three'

/** Saturn's equatorial radius (km), the unit the ring radii below are measured in. */
const SATURN_EQUATORIAL_KM = 60_268

/**
 * Where the texture starts and ends, km from Saturn's centre. Read off the image: the Cassini
 * division (117 500 km) and the outer edge of the A ring (136 775 km) fall at 67% and 94% of its
 * width, which puts its ends at ~69 000 km (inside the C ring) and ~141 000 km (the F ring).
 */
const INNER_KM = 69_000
const OUTER_KM = 141_000

function prepareTexture(texture: Texture) {
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 8 // stays sharp when the rings are seen nearly edge-on
  texture.needsUpdate = true
}

/**
 * Saturn's rings, from public/textures/saturn_rings.png (one row, inner edge on the left).
 * Rendered inside Saturn's `spin` group, so they lie in its equator and tilt with it.
 * `equatorialRadius` is Saturn's drawn radius, so the rings grow with the ×250 / ×500 / ×1000 picker.
 */
export function SaturnRings({ equatorialRadius }: { equatorialRadius: number }) {
  const map = useTexture('/textures/saturn_rings.png', prepareTexture)
  const geometry = useMemo(() => {
    const inner = INNER_KM / SATURN_EQUATORIAL_KM
    const outer = OUTER_KM / SATURN_EQUATORIAL_KM
    const g = new RingGeometry(inner, outer, 256, 1)
    // RingGeometry maps the texture flat across the disc; the image is a strip from the inner to
    // the outer edge, so u = how far out a vertex is.
    const pos = g.attributes.position
    const uv = g.attributes.uv
    const p = new Vector3()
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i)
      uv.setXY(i, (p.length() - inner) / (outer - inner), 0.5)
    }
    return g
  }, [])

  return (
    // the ring lies in x/y; turn it into the equator plane (x/z, +Y = Saturn's north pole)
    <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} scale={equatorialRadius}>
      <meshStandardMaterial map={map} side={DoubleSide} transparent alphaTest={0.02} depthWrite={false} />
    </mesh>
  )
}
