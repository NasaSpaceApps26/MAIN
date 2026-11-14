import { useTexture } from '@react-three/drei'
import { SRGBColorSpace, type Texture } from 'three'
import type { Shape } from './scale'

// Enough segments that the outline stays round even when the body fills the screen
const WIDTH_SEGMENTS = 128
const HEIGHT_SEGMENTS = 64

// Runs once when the NASA image has loaded, before it is sent to the graphics card
function prepareTexture(texture: Texture) {
  texture.colorSpace = SRGBColorSpace // NASA images are sRGB; without this colors look washed out
  texture.needsUpdate = true
}

type PlainProps = { shape: Shape; color: string; glows: boolean }

/** The body in one flat color: Earth and the Moon for now, and every body while its texture loads */
export function PlainSurface({ shape, color, glows }: PlainProps) {
  return (
    <mesh scale={shape}>
      <sphereGeometry args={[1, WIDTH_SEGMENTS, HEIGHT_SEGMENTS]} />
      {glows ? <meshBasicMaterial color={color} /> : <meshStandardMaterial color={color} />}
    </mesh>
  )
}

type TexturedProps = { id: string; shape: Shape; glows: boolean }

/** The body with its NASA map from public/textures/<id>.png wrapped around it */
export function TexturedSurface({ id, shape, glows }: TexturedProps) {
  const map = useTexture(`/textures/${id}.png`, prepareTexture)
  return (
    <mesh scale={shape}>
      <sphereGeometry args={[1, WIDTH_SEGMENTS, HEIGHT_SEGMENTS]} />
      {/* The Sun makes its own light, so it ignores lighting. Planets react to the Sun's light. */}
      {glows ? <meshBasicMaterial map={map} /> : <meshStandardMaterial map={map} />}
    </mesh>
  )
}
