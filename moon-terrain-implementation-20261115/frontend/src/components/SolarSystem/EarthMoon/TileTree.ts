import { MOON_RADIUS_M, moonPosition, terrainMinimum, terrainRelief } from './moonTerrain'
import {
  Frustum,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
  Sphere,
  Texture,
  Vector3,
  type BufferGeometry,
  type Group,
  type PerspectiveCamera,
} from 'three'
import { latLonToLocal } from '../sitePosition'
import { buildTileGeometry, setImageArea } from './tileMesh'
import {
  BASE_MAP_WIDTH,
  clampToCap,
  drawnBounds,
  metresPerPixel,
  tileBounds,
  tileGrid,
  tileUrl,
  toLatLon,
  type TileBounds,
  type TileSource,
} from './tileSources'



const SPLIT_AT = 1.05
const MERGE_AT = 0.82
const MAX_PARALLEL = 6
const MAX_MEGAPIXELS = 16
const RETRY_AFTER_MS = 3000
const BOOTSTRAP_LEVELS = 3
const PREFETCH_PARALLEL = 2
const PREFETCH_REQUESTS = 12
const CANCEL_AFTER_MS = 1500
const MIN_ROOT_PX = 64

type Tile = {
  z: number
  row: number
  col: number
  parent?: Tile
  full: TileBounds
  drawn: TileBounds

  center: Vector3
  boundRadius: number
  angularRadius: number
  longSide: number
  shortSide: number
  children?: Tile[]
  split: boolean
  state: 'empty' | 'loading' | 'ready' | 'failed' | 'noData'
  failedAt: number
  prefetch?: boolean
  abort?: AbortController
  texture?: Texture
  mesh?: Mesh<BufferGeometry, MeshStandardMaterial>
  showing?: Tile
  lastUsed: number
  wantedAt: number
  wantedFrame: number
  drawnFrame: number
}

type Wanted = { tile: Tile; priority: number; distance: number }

export class TileTree {

  below: { level: number; metresPerPixel: number } | undefined

  private readonly source: TileSource
  private readonly flattening: number
  private readonly group: Group
  private readonly anisotropy: number
  private readonly maxKept: number
  private readonly firstDownloadedLevel: number
  private readonly roots: Tile[] = []
  private readonly kept = new Set<Tile>()
  private readonly loading = new Set<Tile>()
  private wanted = new Map<Tile, Wanted>()
  private leaves: Tile[] = []
  private frame = 0
  private disposed = false

  private readonly cameraLocal = new Vector3()
  private horizonAngle = 0
  private pxPerRadian = 0
  private worldScale = 1
  private readonly frustum = new Frustum()
  private readonly matrix = new Matrix4()
  private readonly sphere = new Sphere()

  constructor(source: TileSource, flattening: number, group: Group, anisotropy: number) {
    this.source = source
    this.flattening = flattening
    this.group = group
    this.anisotropy = anisotropy
    this.maxKept = Math.floor((MAX_MEGAPIXELS * 1e6) / source.tilePx ** 2)
    this.firstDownloadedLevel = source.minLevel + (source.baseMapCoversMinLevel ? 1 : 0)
    const { cols, rows } = tileGrid(source, source.minLevel)
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const tile = this.makeTile(source.minLevel, row, col)
        if (tile) this.roots.push(tile)
      }
    }
  }

  update(camera: PerspectiveCamera, viewportHeight: number) {
    if (this.disposed) return
    this.frame++

    this.group.updateWorldMatrix(true, false)
    camera.updateMatrixWorld()
    camera.getWorldPosition(this.cameraLocal)
    this.group.worldToLocal(this.cameraLocal)

    this.horizonAngle = Math.acos(Math.min(1, (this.source.id === 'earth' ? 1 : 1 + terrainMinimum() / MOON_RADIUS_M) / this.cameraLocal.length()))

    this.pxPerRadian = viewportHeight / (2 * Math.tan(((camera.fov / 2) * Math.PI) / 180))
    this.worldScale = this.group.matrixWorld.getMaxScaleOnAxis()
    this.frustum.setFromProjectionMatrix(
      this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    )

    this.leaves = []
    this.wanted = new Map()
    for (const root of this.roots) this.select(root)
    for (const leaf of this.leaves) this.show(leaf)
    for (const tile of this.kept) {
      if (tile.mesh && tile.drawnFrame !== this.frame) tile.mesh.visible = false
    }
    this.prefetchAhead()
    this.findBelowCamera()

    this.cancelUnneeded()
    this.startDownloads()
    this.freeOldTiles()
  }

  dispose() {
    this.disposed = true
    for (const tile of [...this.loading]) tile.abort?.abort()
    for (const tile of [...this.kept]) this.unload(tile)
  }

  private select(tile: Tile) {
    if (!this.isVisible(tile)) return
    tile.lastUsed = this.frame

    const tooBlurry =
      tile.state !== 'noData' && tile.z < this.source.maxLevel && this.isTooBlurry(tile)
    const children = tooBlurry ? this.childrenOf(tile) : []
    tile.split = children.length > 0
    if (tile.split) {
      for (const child of children) this.select(child)
      return
    }
    this.leaves.push(tile)
  }

  private findBelowCamera() {
    let closest: Tile | undefined
    let closestAngle = Infinity
    for (const leaf of this.leaves) {
      const angle = leaf.center.angleTo(this.cameraLocal)
      if (angle < closestAngle) {
        closest = leaf
        closestAngle = angle
      }
    }
    this.below = undefined
    if (!closest || closestAngle > closest.angularRadius) return
    const shown = closest.drawnFrame === this.frame ? closest.showing : undefined
    if (shown) {
      this.below = { level: shown.z, metresPerPixel: metresPerPixel(this.source, shown.z) }
    } else if (this.source.baseMapCoversMinLevel) {

      const metres = (2 * Math.PI * this.source.radiusM) / BASE_MAP_WIDTH
      this.below = { level: this.source.minLevel, metresPerPixel: metres }
    }
  }

  private show(tile: Tile) {
    if (tile.z === this.source.minLevel) {
      if (this.source.baseMapCoversMinLevel) return
      if (this.sizeOnScreen(tile) < MIN_ROOT_PX) return
    }

    const image = tile.state === 'ready' ? tile : this.loadedAncestor(tile)
    if (tile.state !== 'ready') this.want(tile, image)
    if (!image?.texture) return
    image.lastUsed = this.frame

    if (!tile.mesh) {
      const geometry = buildTileGeometry(this.source, tile.drawn, this.flattening)
      tile.mesh = new Mesh(geometry, new MeshStandardMaterial())
      this.group.add(tile.mesh)
      this.kept.add(tile)
    }
    if (tile.showing !== image) {
      setImageArea(tile.mesh.geometry, image.full)
      tile.mesh.material.map = image.texture
      tile.mesh.material.needsUpdate = true
      tile.showing = image
    }
    tile.mesh.visible = true
    tile.drawnFrame = this.frame
  }

  private want(tile: Tile, loadedAncestor: Tile | undefined) {
    if (tile.state === 'noData') {
      for (let ancestor = tile.parent; ancestor; ancestor = ancestor.parent) {
        if (ancestor.state === 'noData') continue
        this.ask(ancestor, 0)
        break
      }
      return
    }

    if (!loadedAncestor) {
      const quickLevel = Math.max(
        this.firstDownloadedLevel,
        tile.z - BOOTSTRAP_LEVELS,
      )
      const quick = this.ancestorAt(tile, Math.min(tile.z, quickLevel))
      if (quick.state !== 'noData') {
        this.ask(quick, 0)
      } else {
        for (let ancestor = quick.parent; ancestor; ancestor = ancestor.parent) {
          if (ancestor.state === 'noData') continue
          this.ask(ancestor, 0)
          break
        }
      }
    }

    // An existing fallback is sufficient: go straight to final detail.
    this.ask(tile, loadedAncestor ? 0 : 1)
  }

  private prefetchAhead() {
    const centers = this.leaves
      .filter((tile) =>
        tile.state === 'ready' &&
        tile.z < this.source.maxLevel &&
        this.sizeOnScreen(tile) >= this.source.tilePx * 0.6,
      )
      .sort((a, b) =>
        this.cameraLocal.distanceToSquared(a.center) -
        this.cameraLocal.distanceToSquared(b.center),
      )
      .slice(0, 2)

    const candidates: { tile: Tile; depth: number; distance: number }[] = []
    for (const center of centers) {
      for (const child of this.childrenOf(center)) {
        if (!this.isVisible(child)) continue
        candidates.push({
          tile: child, depth: 1,
          distance: this.cameraLocal.distanceToSquared(child.center),
        })
        if (child.z >= this.source.maxLevel || child.state === 'noData') continue
        for (const grandchild of this.childrenOf(child)) {
          if (!this.isVisible(grandchild)) continue
          candidates.push({
            tile: grandchild, depth: 2,
            distance: this.cameraLocal.distanceToSquared(grandchild.center),
          })
        }
      }
    }

    candidates.sort((a, b) => a.depth - b.depth || a.distance - b.distance)
    let requested = 0
    for (const { tile, depth } of candidates) {
      if (tile.state === 'ready') {
        tile.lastUsed = this.frame
        continue
      }
      if (tile.state === 'noData') continue
      if (requested >= PREFETCH_REQUESTS) break
      this.ask(tile, depth + 2)
      requested++
    }
  }

  private ask(tile: Tile, priority: number) {
    if (priority < 3) tile.prefetch = false
    tile.wantedAt = performance.now()
    tile.wantedFrame = this.frame
    tile.lastUsed = this.frame
    if (tile.state === 'loading' || tile.state === 'ready' || tile.state === 'noData') return
    if (tile.state === 'failed' && performance.now() - tile.failedAt < RETRY_AFTER_MS) return
    const existing = this.wanted.get(tile)
    if (existing) {
      existing.priority = Math.min(existing.priority, priority)
    } else {
      const distance = this.cameraLocal.distanceTo(tile.center)
      this.wanted.set(tile, { tile, priority, distance })
    }
  }

  private startDownloads() {
    const list = [...this.wanted.values()].sort(
      (a, b) => a.priority - b.priority || a.distance - b.distance,
    )
    const visibleWaiting = list.some((wanted) => wanted.priority < 3)

    // Newly needed images take the slots occupied by speculative downloads.
    if (visibleWaiting) {
      for (const tile of this.loading) {
        if (tile.prefetch) tile.abort?.abort()
      }
    }

    let speculative = [...this.loading].filter((tile) => tile.prefetch).length
    for (const { tile, priority } of list) {
      if (this.loading.size >= MAX_PARALLEL) break
      const prefetch = priority >= 3
      if (prefetch && (visibleWaiting || speculative >= PREFETCH_PARALLEL)) continue
      this.download(tile, prefetch)
      if (prefetch) speculative++
    }
  }

  private cancelUnneeded() {
    for (const tile of this.loading) {
      if (performance.now() - tile.wantedAt > CANCEL_AFTER_MS) tile.abort?.abort()
    }
  }

  private download(tile: Tile, prefetch = false) {
    tile.prefetch = prefetch
    const controller = new AbortController()
    tile.state = 'loading'
    tile.abort = controller
    this.loading.add(tile)
    fetch(tileUrl(this.source, tile.z, tile.row, tile.col), { signal: controller.signal })
      .then(async (response) => {
        if (response.status === 404) {
          tile.state = 'noData'
          return
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`)

        const bitmap = await createImageBitmap(await response.blob(), { imageOrientation: 'flipY' })
        if (this.disposed || controller.signal.aborted) {
          bitmap.close()
          tile.state = 'empty'
          return
        }
        const texture = new Texture(bitmap)
        texture.flipY = false
        texture.colorSpace = SRGBColorSpace
        texture.anisotropy = this.anisotropy
        texture.needsUpdate = true
        tile.texture = texture
        tile.state = 'ready'
        tile.lastUsed = this.frame
        this.kept.add(tile)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          tile.state = 'empty'
          return
        }
        console.warn(`Tile ${this.source.id} ${tile.z}/${tile.row}/${tile.col} failed`, error)
        tile.state = 'failed'
        tile.failedAt = performance.now()
      })
      .finally(() => {
        this.loading.delete(tile)
        tile.abort = undefined
        tile.prefetch = false
      })
  }

  private freeOldTiles() {
    const extra = this.kept.size - this.maxKept
    if (extra <= 0) return
    const oldest = [...this.kept]
      .filter((tile) => tile.lastUsed !== this.frame)
      .sort((a, b) => a.lastUsed - b.lastUsed)
      .slice(0, extra)
    for (const tile of oldest) this.unload(tile)
  }

  private unload(tile: Tile) {
    tile.abort?.abort()
    if (tile.mesh) {
      this.group.remove(tile.mesh)
      tile.mesh.geometry.dispose()
      tile.mesh.material.dispose()
      tile.mesh = undefined
      tile.showing = undefined
    }
    if (tile.texture) {
      const bitmap = tile.texture.image as ImageBitmap
      tile.texture.dispose()
      bitmap.close()
      tile.texture = undefined
    }
    if (tile.state === 'ready') tile.state = 'empty'
    this.kept.delete(tile)

    for (const other of this.kept) if (other.showing === tile) other.showing = undefined
  }

  private isVisible(tile: Tile) {

    const angle = tile.center.angleTo(this.cameraLocal)
    if (angle > this.horizonAngle + tile.angularRadius + 0.01) return false

    this.sphere.center.copy(tile.center).applyMatrix4(this.group.matrixWorld)
    this.sphere.radius = tile.boundRadius * this.worldScale
    return this.frustum.intersectsSphere(this.sphere)
  }

  private sizeOnScreen(tile: Tile) {
    return (tile.longSide / this.cameraLocal.distanceTo(tile.center)) * this.pxPerRadian
  }

  private isTooBlurry(tile: Tile) {
    const sizePx = this.sizeOnScreen(tile)
    if (sizePx < this.source.tilePx * (tile.split ? MERGE_AT : SPLIT_AT)) return false

    return sizePx * (tile.shortSide / tile.longSide) >= this.source.tilePx
  }

  private loadedAncestor(tile: Tile) {
    for (let t = tile.parent; t; t = t.parent) if (t.state === 'ready') return t
    return undefined
  }

  private ancestorAt(tile: Tile, z: number) {
    let t = tile
    while (t.z > z && t.parent) t = t.parent
    return t
  }

  private childrenOf(tile: Tile) {
    if (!tile.children) {
      const z = tile.z + 1
      const { row, col } = tile
      const candidates = [
        this.makeTile(z, row * 2, col * 2, tile),
        this.makeTile(z, row * 2, col * 2 + 1, tile),
        this.makeTile(z, row * 2 + 1, col * 2, tile),
        this.makeTile(z, row * 2 + 1, col * 2 + 1, tile),
      ]
      tile.children = candidates.filter((child) => child !== undefined)
    }
    return tile.children
  }

  private makeTile(z: number, row: number, col: number, parent?: Tile): Tile | undefined {
    const full = tileBounds(this.source, z, row, col)
    const drawn = drawnBounds(this.source, full)
    if (!drawn) return undefined

    const points: Vector3[] = []
    for (const fy of [0, 0.5, 1]) {
      for (const fx of [0, 0.5, 1]) {
        const [x, y] = clampToCap(
          this.source,
          drawn.left + fx * (drawn.right - drawn.left),
          drawn.bottom + fy * (drawn.top - drawn.bottom),
        )
        const [lat, lon] = toLatLon(this.source, x, y)
        points.push(new Vector3(...(this.source.id === 'earth' ? latLonToLocal(lat, lon, 1, this.flattening) : moonPosition(lat, lon))))
      }
    }
    const center = points[4]
    let boundRadius = 0
    let angularRadius = 0
    for (const p of points) {
      boundRadius = Math.max(boundRadius, p.distanceTo(center))
      angularRadius = Math.max(angularRadius, p.angleTo(center))
    }
    const across = points[3].distanceTo(points[5])
    const upDown = points[1].distanceTo(points[7])
    if (this.source.id !== 'earth') boundRadius += Math.min(terrainRelief(), Math.max(across, upDown) * 0.5)
    return {
      z,
      row,
      col,
      parent,
      full,
      drawn,
      center,
      boundRadius,
      angularRadius,
      longSide: Math.max(across, upDown),
      shortSide: Math.max(Math.min(across, upDown), 1e-12),
      split: false,
      state: 'empty',
      failedAt: 0,
      lastUsed: -1,
      wantedAt: 0,
      wantedFrame: -1,
      drawnFrame: -1,
    }
  }
}

