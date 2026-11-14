import { useEffect, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  AdditiveBlending,
  BackSide,
  Fog,
  Material,
  Mesh,
  Object3D,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector3,
} from 'three'
import { tracker, useLaunchStore } from './launchStore'
import { TRENCH } from './profiles'

type Controls = { enabled: boolean; target: Vector3; update: () => void }

const ease = (b: number) => b * b * (3 - 2 * b)
const DEG = 180 / Math.PI
const DOWN = new Vector3(0, -1, 0)
const ray = new Raycaster()

/** Terrain given as a height function over a rectangle centred on the origin (see Terrain). */
type Heightfield = { heightAt: (x: number, z: number) => number; size: [number, number] }

/**
 * What can hide the rocket: buildings and ground as meshes, hills as height functions.
 * Instanced meshes (trees, lattice beams, fences) are left out: they are see-through or small, and
 * far too many to raycast. So are big detailed meshes (ocean, sky), launch smoke and flames.
 */
function occluders(scene: Scene) {
  const meshes: Object3D[] = []
  const fields: Heightfield[] = []
  scene.traverse((o) => {
    const mesh = o as Mesh & { isInstancedMesh?: boolean }
    if (!mesh.isMesh || mesh.isInstancedMesh || !o.visible || o.userData.launchFx) return
    if (o.userData.heightAt) return void fields.push(o.userData as Heightfield)
    const m = mesh.material as Material
    if (Array.isArray(m) || m.blending === AdditiveBlending || m.side === BackSide || m.transparent)
      return
    const g = mesh.geometry
    if ((g.index?.count ?? g.attributes.position?.count ?? 0) > 15000) return
    meshes.push(o)
  })
  return { meshes, fields }
}

/** Height of the hills at (x, z), or -Infinity off every heightfield. */
function groundAt(fields: Heightfield[], x: number, z: number) {
  let y = -Infinity
  for (const f of fields)
    if (Math.abs(x) <= f.size[0] / 2 && Math.abs(z) <= f.size[1] / 2)
      y = Math.max(y, f.heightAt(x, z))
  return y
}

/**
 * How much of the view from `a` toward `b` is free of buildings and hills, 0..1: a fan of rays up
 * to `spread` radians to each side, so poles and masts anywhere in the middle of the shot count
 * (near ones too), not just ones exactly on the line; the straight line counts three times.
 * Rays stop `margin` short of the end.
 */
function clearView(
  objects: { meshes: Object3D[]; fields: Heightfield[] },
  a: Vector3,
  b: Vector3,
  spread: number,
  margin: number,
) {
  const look = new Vector3().subVectors(b, a)
  const across = new Vector3(-look.z, 0, look.x).normalize()
  const reach = look.length()
  let clear = 0
  const offsets = [0, 0.5, -0.5, 1, -1]
  for (const k of offsets) {
    const end = new Vector3().copy(b).addScaledVector(across, Math.tan(k * spread) * reach)
    const to = end.sub(a)
    const dist = to.length()
    to.normalize()
    let blocked = false
    const steps = Math.ceil(dist)
    for (let i = 1; i < steps && !blocked; i++) {
      const t = (i / steps) * (dist - margin)
      blocked = a.y + to.y * t < groundAt(objects.fields, a.x + to.x * t, a.z + to.z * t)
    }
    if (!blocked) {
      ray.set(a, to)
      ray.far = dist - margin
      blocked = ray.intersectObjects(objects.meshes, false).length > 0
    }
    // the straight line to the rocket matters most, the edges of the shot less
    if (!blocked) clear += k === 0 ? 3 : 1
  }
  return clear / (offsets.length + 2)
}

/** Place the tracking camera may take, around the pad: angle from the flight direction, and side. */
type Candidate = { deg: number; side: 1 | -1 }
const CANDIDATES: Candidate[] = [90, 70, 110, 50, 130, 30, 150].flatMap((deg) => [
  { deg, side: 1 as const },
  { deg, side: -1 as const },
])

/**
 * Launch camera. While a launch is tracked it flies to a spot on the ground beside the pad and
 * follows the rocket like a long-lens tracking camera, zooming in as it climbs, with a little ground
 * shake at liftoff. Afterwards it flies back to where the user was and hands control back.
 * It also pushes the fog back so the distant rocket is not swallowed by the haze.
 */
class CameraDirector {
  private mode: 'free' | 'in' | 'out' = 'free'
  private blend = 0
  private readonly savedPos = new Vector3()
  private readonly savedTarget = new Vector3()
  private savedFov = 40
  private readonly fromPos = new Vector3()
  private readonly fromLook = new Vector3()
  private fromFov = 40
  private readonly station = new Vector3()
  private readonly look = new Vector3() // where the camera looked last frame
  private readonly smooth = new Vector3() // smoothed rocket position
  private pick: {
    objects: ReturnType<typeof occluders>
    next: number
    best: number
    userSide: number
  } | null = null
  private fog: Fog | null = null
  private fogNear = 0
  private fogFar = 0

  /** Another site was opened: drop the launch camera at once (the viewer resets the view itself). */
  drop(camera: PerspectiveCamera, controls: Controls | null) {
    if (this.mode !== 'free') {
      camera.fov = this.savedFov
      camera.updateProjectionMatrix()
      if (controls) controls.enabled = true
      this.mode = 'free'
    }
    this.pick = null
    this.fog = null
  }

  update(
    rawDt: number,
    camera: PerspectiveCamera,
    controls: Controls | null,
    scene: Scene,
    follow: boolean,
  ) {
    const dt = Math.min(rawDt, 0.05)
    const want = tracker.active && follow
    this.updateFog(dt, camera, scene, want)
    if (want && this.mode !== 'in') {
      if (this.mode === 'free') {
        this.savedPos.copy(camera.position)
        this.savedTarget.copy(controls?.target ?? tracker.base)
        this.savedFov = camera.fov
        this.look.copy(this.savedTarget)
      }
      this.fromPos.copy(camera.position)
      this.fromLook.copy(this.look)
      this.fromFov = camera.fov
      this.startPick(camera, scene)
      this.smooth.copy(tracker.focus)
      this.mode = 'in'
      this.blend = 0
      if (controls) controls.enabled = false
    } else if (!want && this.mode === 'in') {
      this.fromPos.copy(camera.position)
      this.fromLook.copy(this.look)
      this.fromFov = camera.fov
      this.mode = 'out'
      // at the end of the animation cut straight back (the rocket is gone); otherwise fly back
      this.blend = tracker.cut ? 1 : 0
    }

    if (this.mode === 'in') {
      // look for a good spot first (a few candidates per frame), then fly there
      if (this.pick) this.stepPick(camera)
      else this.blend = Math.min(1, this.blend + dt / 1.4)
      const e = ease(this.blend)
      this.smooth.lerp(tracker.focus, 1 - Math.exp(-dt * 20))
      camera.position.lerpVectors(this.fromPos, this.station, e)
      this.look.lerpVectors(this.fromLook, this.smooth, e)
      // long lens: keep about three rocket lengths in view however far it is
      const dist = camera.position.distanceTo(this.smooth)
      const fov = Math.min(45, Math.max(4, 2 * Math.atan((tracker.height * 1.5) / dist) * DEG))
      camera.fov = this.fromFov + (fov - this.fromFov) * e
      if (tracker.shake > 0) {
        const a = tracker.shake * 0.06
        camera.position.x += (Math.random() - 0.5) * a
        camera.position.y += (Math.random() - 0.5) * a
        camera.position.z += (Math.random() - 0.5) * a
      }
      camera.lookAt(this.look)
      camera.updateProjectionMatrix()
    } else if (this.mode === 'out') {
      this.blend = Math.min(1, this.blend + dt / 1.6)
      const e = ease(this.blend)
      camera.position.lerpVectors(this.fromPos, this.savedPos, e)
      this.look.lerpVectors(this.fromLook, this.savedTarget, e)
      camera.fov = this.fromFov + (this.savedFov - this.fromFov) * e
      camera.lookAt(this.look)
      camera.updateProjectionMatrix()
      if (this.blend >= 1) {
        if (controls) {
          controls.target.copy(this.savedTarget)
          controls.enabled = true
          controls.update()
        }
        this.mode = 'free'
      }
    }
  }

  /**
   * Where to put the tracking camera: beside the pad, roughly side-on to the flight path so the
   * climb and pitch-over show, above the ground and roofs, with a clear line of sight to the rocket
   * and the sky it will climb into. Candidates around the pad are scored by raycasting, spread over
   * a few frames so the launch does not stutter.
   */
  private startPick(camera: PerspectiveCamera, scene: Scene) {
    const side = new Vector3(-tracker.heading.z, 0, tracker.heading.x)
    const userSide =
      Math.sign(side.dot(new Vector3().subVectors(camera.position, tracker.base))) || 1
    this.pick = { objects: occluders(scene), next: 0, best: -Infinity, userSide }
    ray.camera = camera
  }

  private stepPick(camera: PerspectiveCamera) {
    const pick = this.pick!
    const H = tracker.height
    const base = tracker.base
    const h = tracker.heading
    const side = new Vector3(-h.z, 0, h.x)
    const D = H * 2.4 + 9
    ray.camera = camera
    for (let n = 0; n < 2 && pick.next < CANDIDATES.length; n++) {
      const { deg, side: s } = CANDIDATES[pick.next++]
      const a = (deg * Math.PI) / 180
      const dir = new Vector3()
        .addScaledVector(h, Math.cos(a))
        .addScaledVector(side, s * Math.sin(a))
      const pos = new Vector3().copy(base).addScaledVector(dir, D)
      // stand well above whatever is below (hills, roofs)
      ray.set(new Vector3(pos.x, base.y + 80, pos.z), DOWN)
      ray.far = 200
      const roof = ray.intersectObjects(pick.objects.meshes, false)[0]?.point.y ?? -Infinity
      pos.y = Math.max(
        base.y + H * 0.45 + 3,
        roof + 3,
        groundAt(pick.objects.fields, pos.x, pos.z) + 3,
      )

      // can it see the rocket and the sky it climbs into?
      let clear = 0
      for (const k of [0.5, 1, 2, 4])
        clear += clearView(
          pick.objects,
          pos,
          new Vector3(base.x, base.y + H * k, base.z),
          0.25,
          2.5,
        )
      // prefer: clear view, side-on, the user's side, low, and not where the trench blows the cloud
      const score =
        clear * 10 -
        Math.abs(deg - 90) / 20 +
        (s === pick.userSide ? 1.5 : 0) -
        (pos.y - base.y) * 0.05 -
        Math.max(0, dir.x * TRENCH[0] + dir.z * TRENCH[1]) * 6
      if (score > pick.best) {
        pick.best = score
        this.station.copy(pos)
      }
    }
    if (pick.next >= CANDIDATES.length) this.pick = null
  }

  /**
   * While the camera follows a rocket, stretch the fog so the distant rocket stays visible; ease it
   * back afterwards. Without the tracking camera the rocket simply fades into the haze.
   */
  private updateFog(dt: number, camera: PerspectiveCamera, scene: Scene, following: boolean) {
    const fog = scene.fog as Fog | null
    if (fog && following) {
      if (this.fog !== fog) {
        this.fog = fog
        this.fogNear = fog.near
        this.fogFar = fog.far
      }
      const dist = camera.position.distanceTo(tracker.focus)
      fog.near = Math.max(this.fogNear, dist * 0.9)
      fog.far = Math.max(this.fogFar, dist * 2.2)
    } else if (this.fog) {
      if (this.fog === fog) {
        const k = 1 - Math.exp(-dt * 1.5)
        fog.near += (this.fogNear - fog.near) * k
        fog.far += (this.fogFar - fog.far) * k
        if (Math.abs(fog.far - this.fogFar) > 1) return
        fog.near = this.fogNear
        fog.far = this.fogFar
      }
      this.fog = null
    }
  }
}

/** Runs the launch camera inside the model's canvas. */
export function LaunchDirector({ viewKey }: { viewKey: string }) {
  const get = useThree((s) => s.get)
  const [director] = useState(() => new CameraDirector())
  useEffect(() => {
    const { camera, controls } = get()
    director.drop(camera as PerspectiveCamera, controls as unknown as Controls | null)
  }, [viewKey, get, director])
  useFrame(({ camera, controls, scene }, dt) =>
    director.update(
      dt,
      camera as PerspectiveCamera,
      controls as unknown as Controls | null,
      scene,
      useLaunchStore.getState().follow,
    ),
  )
  return null
}
