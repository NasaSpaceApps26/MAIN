import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import {
  PerspectiveCamera, SRGBColorSpace, TextureLoader,
  type BufferGeometry, type Group, type Texture,
} from 'three'
import { moonReliefScale, type Shape } from '../scale'
import { useSimStore } from '../../../store/simStore'
import { buildBandGeometry, buildCapGeometry } from './globeMesh'
import { surfaceBelowCamera } from './surfaceStatus'
import { TileTree } from './TileTree'
import { baseMapUrl, BODY_SOURCES, CAP_LAT, capUrl } from './tileSources'
import { loadMoonTerrain, useMoonTerrain } from './moonTerrain'

type Props = { bodyId: 'earth' | 'moon'; shape: Shape; flattening: number; color: string }
export function TiledSurface({ bodyId, shape, flattening, color }: Props) {
  const lunar = bodyId === 'moon'
  const terrain = useMoonTerrain(lunar)
  const ready = !lunar || terrain.phase === 'ready'
  const displace = lunar && ready
  // Terrain stretch for the current size button. When it changes, the Moon's meshes are rebuilt.
  const relief = useSimStore((s) => (lunar ? moonReliefScale(s.planetSize) : 1))
  const sources = BODY_SOURCES[bodyId]
  const tilesGroup = useRef<Group>(null)
  const trees = useRef<TileTree[]>([])
  const gl = useThree((s) => s.gl)
  const anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy())
  const base = useMapTexture(baseMapUrl(sources[0]), anisotropy)
  const north = useMapTexture(capUrl(sources[0], 'north'), anisotropy)
  const south = useMapTexture(capUrl(sources[0], 'south'), anisotropy)
  const globe = useMemo(() => ({
    fallback: buildBandGeometry(flattening, 90, displace),
    band: buildBandGeometry(flattening, CAP_LAT, displace),
    north: buildCapGeometry(flattening, CAP_LAT, 'north', displace),
    south: buildCapGeometry(flattening, CAP_LAT, 'south', displace),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `relief` is read inside the builders
  }), [flattening, displace, relief])
  useEffect(() => () => {
    globe.fallback.dispose()
    globe.band.dispose()
    globe.north.dispose()
    globe.south.dispose()
  }, [globe])
  useEffect(() => {
    const group = tilesGroup.current
    if (!group || !ready) return
    const created = sources.map((source) => new TileTree(source, flattening, group, anisotropy))
    trees.current = created
    return () => {
      created.forEach((tree) => tree.dispose())
      trees.current = []
      surfaceBelowCamera[bodyId] = undefined
    }
  }, [sources, flattening, anisotropy, ready, bodyId, relief])
  useFrame(({ camera, size }) => {
    if (!(camera instanceof PerspectiveCamera)) return
    for (const tree of trees.current) tree.update(camera, size.height * gl.getPixelRatio())
    let below: TileTree['below']
    for (const tree of trees.current) {
      if (tree.below && (!below || tree.below.metresPerPixel < below.metresPerPixel)) below = tree.below
    }
    surfaceBelowCamera[bodyId] = below
  })
  return <>
    {/* The backup globe: built from the LOWEST terrain around each vertex (globeMesh.ts), so it already
        stays under the tiles; the tiny extra gap (~90 m) only avoids flicker where they touch.
        It used to be sunk by 0.3% × relief (26-37 km), which made the polar caps and every loaded tile
        stand out of it like plateaus. Earth has no terrain: its flat tiles sag more between
        vertices than the globe does, so it keeps the old 0.3% gap. */}
    <group scale={shape[0] * (lunar ? 1 - 0.00005 : 0.997)}>
      {north && south ? <>
        <Part geometry={globe.band} map={base} color={color} />
        <Part geometry={globe.north} map={north} color={color} />
        <Part geometry={globe.south} map={south} color={color} />
      </> : <Part geometry={globe.fallback} map={base} color={color} />}
    </group>
    <group ref={tilesGroup} scale={shape[0]} />
    {lunar && !ready && <Html center zIndexRange={[2, 2]}>
      <div style={{ background: '#071329', color: 'white', padding: 10, whiteSpace: 'nowrap', fontSize: 12 }}>
        {terrain.phase === 'error' ? <>
          Elevation unavailable. <button onClick={() => void loadMoonTerrain()}>Retry</button>
          <div>{terrain.error}</div>
        </> : terrain.progress > 0
          ? `Loading lunar terrain: ${Math.round(terrain.progress * 100)}%`
          : 'Preparing lunar terrain — first download may take a while…'}
      </div>
    </Html>}
  </>
}
function Part({ geometry, map, color }: { geometry: BufferGeometry; map: Texture | null; color: string }) {
  return <mesh geometry={geometry}>
    <meshStandardMaterial key={map ? 'map' : 'plain'} map={map} color={map ? 'white' : color} />
  </mesh>
}
function useMapTexture(url: string, anisotropy: number) {
  const [loaded, setLoaded] = useState<{ url: string; texture: Texture } | null>(null)
  useEffect(() => {
    let cancelled = false
    let map: Texture | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let retries = 0
    const download = () => {
      if (cancelled) return
      new TextureLoader().loadAsync(url).then((texture) => {
        if (cancelled) { texture.dispose(); return }
        texture.colorSpace = SRGBColorSpace
        texture.anisotropy = anisotropy
        map = texture
        setLoaded({ url, texture })
      }, (error: unknown) => {
        if (cancelled) return
        if (retries++ < 3) timer = setTimeout(download, retries * 5000)
        else console.warn('Map loading failed', url, error)
      })
    }
    download()
    return () => { cancelled = true; if (timer) clearTimeout(timer); map?.dispose() }
  }, [url, anisotropy])
  return loaded?.url === url ? loaded.texture : null
}
